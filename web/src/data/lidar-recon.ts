// -----------------------------------------------------------------------------
// Reconstruction du toit en pans JOINTIFS (maquette 3D + dessin sur l'ortho).
//
// L'ancienne vectorisation traçait chaque pan indépendamment depuis ses
// cellules dédupliquées puis dilatées/lissées : les frontières entre pans ne
// coïncidaient jamais (trous, chevauchements — captures briac), et le contour
// débordait du domaine du pan (altitudes extrapolées -> pointes en 3D).
//
// Ici, on PARTITIONNE l'emprise du bâtiment :
//   1. chaque cellule de la grille (0,5 m) intérieure à l'emprise reçoit le
//      pan dont les points LiDAR y sont majoritaires (graines), puis les
//      cellules vides (cheminées, trous d'échantillonnage, bordures) sont
//      remplies de proche en proche -> partition SANS TROU par construction ;
//   2. le contour de chaque région est tracé (traceOutline), puis simplifié
//      par FRONTIÈRE PARTAGÉE : les sommets de jonction (≥ 3 régions) sont
//      protégés, chaque tronçon entre deux jonctions est simplifié UNE fois
//      (cache canonique) et réutilisé tel quel par les deux pans riverains ->
//      les pans restent exactement jointifs après lissage ;
//   3. l'altitude d'un sommet = moyenne des plans des pans qui s'y touchent
//      (au faîtage, les plans s'y croisent : même z des deux côtés).
//
// Module pur (aucune dépendance) : testé par lidar-recon.test.ts.
// -----------------------------------------------------------------------------
import { CELL, dpOpen, pointInRing, ringArea, type Plane, type Ring } from './lidar-core'

const OUTSIDE = -1
const DP_EPS_CELLS = 0.9 // ~0,45 m : gomme l'escalier, garde les vrais angles

export interface ReconPanInput {
  plane: Plane
  /** Points LiDAR du pan par cellule (clé "cx:cy" à CELL m). */
  counts: Map<string, number>
}

export interface ReconPan {
  /** Contour fermé (premier = dernier) en mètres L93. */
  contour: [number, number][]
  /** Altitude ABSOLUE de chaque sommet (moyenne des plans riverains). */
  alts: number[]
}

// --- 1. Étiquetage de la grille --------------------------------------------------

function labelGrid(pans: ReconPanInput[], ring: Ring): Map<string, number> {
  // Domaine : cellules dont le centre est dans l'emprise, UNION des cellules à
  // points (débords réels mesurés hors emprise murale).
  const domain = new Set<string>()
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const cx0 = Math.floor(Math.min(...xs) / CELL)
  const cx1 = Math.floor(Math.max(...xs) / CELL)
  const cy0 = Math.floor(Math.min(...ys) / CELL)
  const cy1 = Math.floor(Math.max(...ys) / CELL)
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      if (pointInRing((cx + 0.5) * CELL, (cy + 0.5) * CELL, ring)) domain.add(`${cx}:${cy}`)
    }
  }
  for (const p of pans) for (const k of p.counts.keys()) domain.add(k)

  // Graines : pan majoritaire (en points) par cellule.
  const labels = new Map<string, number>()
  for (const k of domain) {
    let best = OUTSIDE
    let bestN = 0
    for (let i = 0; i < pans.length; i++) {
      const n = pans[i].counts.get(k) ?? 0
      if (n > bestN) {
        bestN = n
        best = i
      }
    }
    if (best !== OUTSIDE) labels.set(k, best)
  }

  // Remplissage : une cellule vide adopte l'étiquette majoritaire de ses
  // 8 voisines étiquetées. Itéré par vagues (déterministe : les nouvelles
  // étiquettes d'une vague ne comptent que pour la suivante).
  let empty = [...domain].filter((k) => !labels.has(k)).sort()
  while (empty.length) {
    const assign = new Map<string, number>()
    for (const k of empty) {
      const [cx, cy] = k.split(':').map(Number)
      const votes = new Map<number, number>()
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue
          const l = labels.get(`${cx + dx}:${cy + dy}`)
          if (l !== undefined) votes.set(l, (votes.get(l) ?? 0) + 1)
        }
      }
      let best = OUTSIDE
      let bestN = 0
      for (const [l, n] of votes) {
        if (n > bestN || (n === bestN && l < best)) {
          bestN = n
          best = l
        }
      }
      if (best !== OUTSIDE) assign.set(k, best)
    }
    if (!assign.size) break // îlot inaccessible : abandonné (hors emprise réelle)
    for (const [k, l] of assign) labels.set(k, l)
    empty = empty.filter((k) => !labels.has(k))
  }
  return labels
}

// --- 2. Sommets de jonction ------------------------------------------------------

/** Étiquettes (pans + OUTSIDE) des ≤ 4 cellules autour de chaque coin de grille. */
function cornerLabels(labels: Map<string, number>): Map<string, Set<number>> {
  const corners = new Map<string, Set<number>>()
  const touch = (x: number, y: number, l: number) => {
    const k = `${x}:${y}`
    const s = corners.get(k) ?? new Set<number>()
    s.add(l)
    corners.set(k, s)
  }
  for (const [k, l] of labels) {
    const [cx, cy] = k.split(':').map(Number)
    for (const [x, y] of [
      [cx, cy],
      [cx + 1, cy],
      [cx + 1, cy + 1],
      [cx, cy + 1],
    ]) {
      touch(x, y, l)
    }
  }
  // Coins bordant une cellule non étiquetée = frontière extérieure.
  for (const [k, s] of corners) {
    const [x, y] = k.split(':').map(Number)
    for (const [cx, cy] of [
      [x - 1, y - 1],
      [x, y - 1],
      [x - 1, y],
      [x, y],
    ]) {
      if (!labels.has(`${cx}:${cy}`)) {
        s.add(OUTSIDE)
        break
      }
    }
  }
  return corners
}

// --- 3. Contour de région, simplifié par frontière partagée ----------------------

// Traçage du contour d'une région (arêtes orientées intérieur à gauche, plus
// grande boucle) — même algorithme que lidar-core.traceOutline mais en rendant
// la boucle SANS lissage (le lissage jointif se fait par tronçon ensuite).
function traceRegion(cells: Set<string>): [number, number][] | null {
  const edges = new Map<string, { to: [number, number]; used: boolean }[]>()
  const has = (x: number, y: number) => cells.has(`${x}:${y}`)
  const addEdge = (fx: number, fy: number, tx: number, ty: number) => {
    const k = `${fx}:${fy}`
    const list = edges.get(k) ?? []
    list.push({ to: [tx, ty], used: false })
    edges.set(k, list)
  }
  for (const k of cells) {
    const [x, y] = k.split(':').map(Number)
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y)
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y)
  }
  let best: [number, number][] | null = null
  let bestArea = 0
  for (const [startKey, startList] of edges) {
    for (const startEdge of startList) {
      if (startEdge.used) continue
      const ring: [number, number][] = []
      let [cx, cy] = startKey.split(':').map(Number)
      let edge = startEdge
      let guard = 0
      while (!edge.used && guard++ < 100000) {
        edge.used = true
        ring.push([cx, cy])
        const [nx, ny] = edge.to
        const dirX = nx - cx
        const dirY = ny - cy
        const candidates = edges.get(`${nx}:${ny}`)?.filter((e) => !e.used) ?? []
        if (!candidates.length) break
        candidates.sort((a, b) => {
          const cross = (e: { to: [number, number] }) =>
            dirX * (e.to[1] - ny) - dirY * (e.to[0] - nx)
          const dot = (e: { to: [number, number] }) =>
            dirX * (e.to[0] - nx) + dirY * (e.to[1] - ny)
          return cross(b) - cross(a) || dot(b) - dot(a)
        })
        cx = nx
        cy = ny
        edge = candidates[0]
      }
      if (ring.length < 4) continue
      let area = 0
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        area += x1 * y2 - x2 * y1
      }
      area = area / 2
      if (area > bestArea) {
        bestArea = area
        best = ring
      }
    }
  }
  return best
}

// Simplification d'un tronçon avec cache CANONIQUE : les deux pans riverains
// d'une frontière possèdent le même tronçon (inversé) — en le simplifiant sous
// une forme canonique unique, chacun récupère exactement les mêmes sommets.
function makeChainSimplifier() {
  const cache = new Map<string, [number, number][]>()
  return (chain: [number, number][]): [number, number][] => {
    const fwdKey = chain.map(([x, y]) => `${x},${y}`).join(';')
    const revKey = [...chain]
      .reverse()
      .map(([x, y]) => `${x},${y}`)
      .join(';')
    const canonical = fwdKey <= revKey
    const key = canonical ? fwdKey : revKey
    let simplified = cache.get(key)
    if (!simplified) {
      simplified = dpOpen(canonical ? chain : [...chain].reverse(), DP_EPS_CELLS)
      cache.set(key, simplified)
    }
    return canonical ? simplified : [...simplified].reverse()
  }
}

// --- Orchestration ---------------------------------------------------------------

/**
 * Reconstruit les pans jointifs. Rend `null` en cas d'échec global ; un pan
 * peut individuellement rendre `null` (région vide ou incohérente) — l'appelant
 * garde alors son ancien contour (repli).
 */
export function reconstructRoof(pans: ReconPanInput[], ring: Ring): (ReconPan | null)[] | null {
  if (!pans.length) return null
  const labels = labelGrid(pans, ring)
  if (!labels.size) return null
  const corners = cornerLabels(labels)
  const simplifyChain = makeChainSimplifier()

  // Régions par pan.
  const regions: Set<string>[] = pans.map(() => new Set<string>())
  for (const [k, l] of labels) regions[l]?.add(k)

  const out: (ReconPan | null)[] = []
  for (let i = 0; i < pans.length; i++) {
    const cells = regions[i]
    if (!cells.size) {
      out.push(null)
      continue
    }
    const raw = traceRegion(cells)
    if (!raw || raw.length < 4) {
      out.push(null)
      continue
    }
    // Sommets protégés : jonction de ≥ 3 étiquettes (2 pans + extérieur, ou
    // 3 pans) — ils appartiennent à plusieurs frontières et ne bougent pas.
    const isJunction = (v: [number, number]) => (corners.get(`${v[0]}:${v[1]}`)?.size ?? 0) >= 3
    const junctionIdx = raw.map((v, idx) => (isJunction(v) ? idx : -1)).filter((x) => x >= 0)

    let simplified: [number, number][]
    if (junctionIdx.length === 0) {
      // Région sans jonction (toit mono-pan) : anneau fermé simplifié seul.
      const closed = [...raw, raw[0]]
      const dp = dpOpen(closed, DP_EPS_CELLS)
      simplified = dp.slice(0, -1)
    } else {
      // Tourner l'anneau pour démarrer sur une jonction, découper en tronçons
      // entre jonctions, simplifier chaque tronçon (cache partagé).
      const start = junctionIdx[0]
      const rotated = [...raw.slice(start), ...raw.slice(0, start)]
      const cuts = rotated
        .map((v, idx) => (isJunction(v) ? idx : -1))
        .filter((x) => x >= 0)
      simplified = []
      for (let c = 0; c < cuts.length; c++) {
        const a = cuts[c]
        const b = cuts[(c + 1) % cuts.length]
        const chain =
          c === cuts.length - 1
            ? [...rotated.slice(a), rotated[0]]
            : rotated.slice(a, b + 1)
        const s = simplifyChain(chain)
        // Le dernier sommet du tronçon = premier du suivant : on l'omet.
        for (let v = 0; v < s.length - 1; v++) simplified.push(s[v])
      }
    }
    if (simplified.length < 3) {
      out.push(null)
      continue
    }

    // Coin -> altitude : moyenne des plans des pans touchant ce coin (au
    // faîtage les plans s'y croisent -> même z des deux côtés, par symétrie).
    const contour: [number, number][] = []
    const alts: number[] = []
    for (const [gx, gy] of simplified) {
      const x = gx * CELL
      const y = gy * CELL
      const touching = [...(corners.get(`${gx}:${gy}`) ?? [])].filter((l) => l !== OUTSIDE)
      const planes = touching.length ? touching : [i]
      let z = 0
      for (const l of planes) {
        const [a, b, c] = pans[l].plane
        z += a * x + b * y + c
      }
      contour.push([x, y])
      alts.push(z / planes.length)
    }
    contour.push(contour[0])
    alts.push(alts[0])

    // Garde de cohérence : le polygone doit couvrir ~ la surface de sa région.
    const polyArea = ringArea(contour)
    const cellArea = cells.size * CELL * CELL
    if (polyArea < 0.55 * cellArea || polyArea > 1.8 * cellArea) {
      out.push(null)
      continue
    }
    out.push({ contour, alts })
  }
  return out
}
