// -----------------------------------------------------------------------------
// Reconstruction du toit en pans JOINTIFS et RECTILIGNES (maquette 3D + ortho).
//
// v3 (retours captures briac : bords « fondus », murs rainurés, jonction
// maison/annexe écrasée) : le polygone BD TOPO devient la source de vérité de
// la silhouette — la grille ne sert plus qu'à décider quel pan possède quoi.
//   1. l'emprise est décalée du débord de toit (offsetRing, joints en onglet) ;
//   2. la partition (étiquetage des cellules par votes des points LiDAR +
//      remplissage) est calculée DANS ce polygone décalé ;
//   3. frontières EXTÉRIEURES : remplacées par l'arc du polygone décalé entre
//      leurs deux jonctions (projection déterministe) -> gouttières droites,
//      angles vrais ;
//   4. frontières INTÉRIEURES : segment exact jonction -> jonction quand la
//      déviation est faible (un faîtage est une droite) ; si les deux plans
//      diffèrent de > 40 cm le long de la frontière, c'est une MARCHE
//      (annexe plus basse) : chaque pan garde sa propre altitude, le viewer
//      dessine la face verticale ;
//   5. altitude d'un sommet : plan du pan sur les bords extérieurs, moyenne
//      des plans SOUDÉS aux faîtages/arêtiers (même z des deux côtés).
//
// Module pur (aucune dépendance) : testé par lidar-recon.test.ts.
// Limite assumée : un pan « île » entièrement contenu dans un autre (lucarne)
// garde un contour DP simple et peut chevaucher son hôte.
// -----------------------------------------------------------------------------
import {
  CELL,
  distToRing,
  dpOpen,
  pointInRing,
  ringArea,
  simplify,
  type Plane,
  type Ring,
} from './lidar-core'

const OUTSIDE = -1
const STEP_TOL_M = 0.4 // au-delà : décroché de niveau, pas un faîtage
const STRAIGHT_TOL_CELLS = 1.6 // ~0,8 m : une frontière quasi droite DEVIENT droite
const MITER_LIMIT = 3 // clamp des pointes d'onglet (angles très aigus)
const TINY_CELLS = 24 // < 6 m² : région absorbée par son voisin
const THIN_CORE_RATIO = 0.2 // « écharde » : presque aucune cellule intérieure
const SNAP_CORNER_M = 0.9 // jonction aimantée sur un sommet du polygone

export interface ReconPanInput {
  plane: Plane
  /** Points LiDAR du pan par cellule (clé "cx:cy" à CELL m). */
  counts: Map<string, number>
}

export interface ReconPan {
  /** Contour fermé (premier = dernier) en mètres L93. */
  contour: [number, number][]
  /** Altitude ABSOLUE de chaque sommet (plans soudés aux frontières). */
  alts: number[]
}

export interface ReconResult {
  pans: (ReconPan | null)[]
  /** Paires de pans SOUDÉS (faîtage/arêtier continu — même toit physique). */
  welds: [number, number][]
  /** Échardes absorbées : [pan absorbé, pan absorbeur] (même toit physique). */
  absorbed: [number, number][]
}

/**
 * « La maison » : composante connexe du plus grand pan incliné à travers les
 * frontières SOUDÉES (un décroché de niveau — extension, annexe, garage —
 * n'est pas soudé et coupe donc la composante). Les échardes absorbées
 * rejoignent leur absorbeur.
 *
 * Règle MÉTIER : les pans PLATS ne rejoignent jamais le corps et ne servent
 * pas de pont, même géométriquement continus (un toit incliné qui descend au
 * niveau d'une dalle de garage s'y « soude » sans marche — Rosa Floch — mais
 * pour le couvreur c'est une annexe). Exception : toit entièrement plat.
 */
export function mainBodyPans(
  m2: number[],
  isFlat: boolean[],
  welds: [number, number][],
  absorbed: [number, number][],
): Set<number> {
  const anyPitched = isFlat.some((f, i) => !f && m2[i] > 0)
  const blocked = (i: number) => anyPitched && isFlat[i]
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  for (const [a, b] of welds) link(a, b)
  for (const [a, b] of absorbed) link(a, b)
  let seed = -1
  for (let i = 0; i < m2.length; i++) {
    if (!blocked(i) && (seed < 0 || m2[i] > m2[seed])) seed = i
  }
  if (seed < 0) return new Set()
  const body = new Set<number>([seed])
  const stack = [seed]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of adj.get(cur) ?? []) {
      if (!body.has(n) && !blocked(n)) {
        body.add(n)
        stack.push(n)
      }
    }
  }
  return body
}

// --- Décalage du polygone d'emprise (débord de toit) ----------------------------

function signedArea(ring: Ring): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return a / 2
}

function perimeter(ring: Ring): number {
  let p = 0
  for (let i = 0; i < ring.length - 1; i++) {
    p += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
  }
  return p
}

/**
 * Décale un polygone simple vers l'EXTÉRIEUR de `d` mètres (joints en onglet,
 * biseau au-delà du MITER_LIMIT). Rend null si le résultat est incohérent
 * (auto-intersection probable) — l'appelant replie sur l'anneau d'origine.
 */
export function offsetRing(ring: Ring, d: number): Ring | null {
  const open = ring.slice(0, -1)
  const n = open.length
  if (n < 3) return null
  // CCW : intérieur à gauche des arêtes orientées -> extérieur = normale droite
  // (dy, -dx). CW : l'inverse.
  const sign = signedArea(ring) > 0 ? 1 : -1
  const out: Ring = []
  for (let i = 0; i < n; i++) {
    const p0 = open[(i - 1 + n) % n]
    const p1 = open[i]
    const p2 = open[(i + 1) % n]
    const l0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const l1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if (l0 < 1e-9 || l1 < 1e-9) continue
    const d0: [number, number] = [(p1[0] - p0[0]) / l0, (p1[1] - p0[1]) / l0]
    const d1: [number, number] = [(p2[0] - p1[0]) / l1, (p2[1] - p1[1]) / l1]
    const n0: [number, number] = [sign * d0[1], -sign * d0[0]]
    const n1: [number, number] = [sign * d1[1], -sign * d1[0]]
    const a: [number, number] = [p0[0] + n0[0] * d, p0[1] + n0[1] * d]
    const b: [number, number] = [p1[0] + n1[0] * d, p1[1] + n1[1] * d]
    const cross = d0[0] * d1[1] - d0[1] * d1[0]
    if (Math.abs(cross) < 1e-9) {
      // arêtes colinéaires : simple translation du sommet
      out.push([p1[0] + n0[0] * d, p1[1] + n0[1] * d])
      continue
    }
    const t = ((b[0] - a[0]) * d1[1] - (b[1] - a[1]) * d1[0]) / cross
    const pt: [number, number] = [a[0] + d0[0] * t, a[1] + d0[1] * t]
    if (Math.hypot(pt[0] - p1[0], pt[1] - p1[1]) > MITER_LIMIT * d) {
      // angle très aigu : biseau (deux sommets) plutôt qu'une pointe
      out.push([p1[0] + n0[0] * d, p1[1] + n0[1] * d])
      out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d])
    } else {
      out.push(pt)
    }
  }
  if (out.length < 3) return null
  out.push([out[0][0], out[0][1]])
  // Garde : l'aire doit croître d'environ périmètre × d (+ coins).
  const a0 = ringArea(ring)
  const a1 = ringArea(out)
  const p = perimeter(ring)
  if (a1 < a0 || a1 > a0 + p * d * 1.6 + 16 * d * d) return null
  return out
}

// --- Projection sur le périmètre du polygone -------------------------------------

interface RingWalk {
  ring: Ring
  /** Abscisse curviligne cumulée de chaque sommet. */
  cum: number[]
  total: number
}

function makeWalk(ring: Ring): RingWalk {
  const cum = [0]
  for (let i = 0; i < ring.length - 1; i++) {
    cum.push(cum[i] + Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]))
  }
  return { ring, cum, total: cum[cum.length - 1] }
}

function projectToWalk(w: RingWalk, px: number, py: number): { t: number; pt: [number, number] } {
  let best = Infinity
  let bestT = 0
  let bestPt: [number, number] = w.ring[0]
  for (let i = 0; i < w.ring.length - 1; i++) {
    const [x1, y1] = w.ring[i]
    const [x2, y2] = w.ring[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-12) continue
    const u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
    const qx = x1 + u * dx
    const qy = y1 + u * dy
    const dist = Math.hypot(px - qx, py - qy)
    if (dist < best - 1e-9) {
      best = dist
      bestT = w.cum[i] + u * Math.sqrt(len2)
      bestPt = [qx, qy]
    }
  }
  return { t: bestT, pt: bestPt }
}

/** Points du périmètre entre t0 et t1 en AVANÇANT (sens du ring), bornes incluses. */
function walkForward(w: RingWalk, t0: number, t1: number): [number, number][] {
  const pts: [number, number][] = []
  const at = (t: number): [number, number] => {
    // t déjà dans [0, total]
    for (let i = 0; i < w.cum.length - 1; i++) {
      if (t <= w.cum[i + 1] + 1e-9) {
        const seg = w.cum[i + 1] - w.cum[i]
        const u = seg > 1e-12 ? (t - w.cum[i]) / seg : 0
        return [
          w.ring[i][0] + u * (w.ring[i + 1][0] - w.ring[i][0]),
          w.ring[i][1] + u * (w.ring[i + 1][1] - w.ring[i][1]),
        ]
      }
    }
    return w.ring[w.ring.length - 1]
  }
  pts.push(at(t0))
  const span = t1 >= t0 ? t1 - t0 : w.total - t0 + t1
  // Sommets du polygone strictement entre t0 et t0+span : on déplie chaque
  // abscisse (c et c+total) puis on trie — pas d'état, pas de wrap raté.
  const between: number[] = []
  for (let i = 0; i < w.cum.length - 1; i++) {
    for (const cand of [w.cum[i], w.cum[i] + w.total]) {
      if (cand > t0 + 1e-6 && cand < t0 + span - 1e-6) between.push(cand)
    }
  }
  between.sort((a, b) => a - b)
  for (const t of between) pts.push(at(t % w.total))
  pts.push(at((t0 + span) % w.total))
  // dédoublonnage des points quasi confondus
  const clean: [number, number][] = []
  for (const p of pts) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push(p)
  }
  return clean
}

/** Arc du périmètre entre deux points, côté le plus proche d'un point témoin. */
function boundaryArc(
  w: RingWalk,
  from: [number, number],
  to: [number, number],
  witness: [number, number],
): [number, number][] {
  const a = projectToWalk(w, from[0], from[1])
  const b = projectToWalk(w, to[0], to[1])
  const fwd = walkForward(w, a.t, b.t)
  const bwd = walkForward(w, b.t, a.t).reverse()
  const mid = (pts: [number, number][]): [number, number] => pts[Math.floor(pts.length / 2)]
  const df = Math.hypot(mid(fwd)[0] - witness[0], mid(fwd)[1] - witness[1])
  const db = Math.hypot(mid(bwd)[0] - witness[0], mid(bwd)[1] - witness[1])
  return df <= db ? fwd : bwd
}

// --- Partition de la grille ------------------------------------------------------

function labelGrid(pans: ReconPanInput[], domainRing: Ring): Map<string, number> {
  const domain = new Set<string>()
  const xs = domainRing.map((p) => p[0])
  const ys = domainRing.map((p) => p[1])
  const cx0 = Math.floor(Math.min(...xs) / CELL)
  const cx1 = Math.floor(Math.max(...xs) / CELL)
  const cy0 = Math.floor(Math.min(...ys) / CELL)
  const cy1 = Math.floor(Math.max(...ys) / CELL)
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      if (pointInRing((cx + 0.5) * CELL, (cy + 0.5) * CELL, domainRing)) {
        domain.add(`${cx}:${cy}`)
      }
    }
  }

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

  // Remplissage par vagues (déterministe) : une cellule vide adopte
  // l'étiquette majoritaire de ses 8 voisines déjà étiquetées.
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
    if (!assign.size) break // îlot isolé du reste du domaine : abandonné
    for (const [k, l] of assign) labels.set(k, l)
    empty = empty.filter((k) => !labels.has(k))
  }
  return labels
}

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

// Traçage du contour d'une région (arêtes orientées intérieur à gauche, plus
// grande boucle), en coins de grille.
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

// --- Orchestration ---------------------------------------------------------------

interface Chain {
  /** Coins de grille bruts (bornes incluses = jonctions). */
  raw: [number, number][]
  /** Autre pan riverain, ou OUTSIDE (frontière extérieure). */
  partner: number
}

const planeZ = ([a, b, c]: Plane, x: number, y: number) => a * x + b * y + c

/**
 * Reconstruit les pans jointifs et rectilignes du toit, avec le graphe des
 * frontières soudées (corps principal vs annexes — mainBodyPans).
 * `wallRing` : emprise BD TOPO (mètres L93, fermée) ; `overhang` : débord (m).
 * Rend `null` en cas d'échec global ; un pan peut individuellement rendre
 * `null` (l'appelant replie sur l'ancienne vectorisation pour ce pan).
 */
export function reconstructRoof(
  pans: ReconPanInput[],
  wallRing: Ring,
  overhang: number,
  /** Sonde de diagnostic (tests/outillage) : trace soudures et chaînes. */
  debug?: (msg: string) => void,
): ReconResult | null {
  if (!pans.length) return null
  const outline = offsetRing(wallRing, overhang) ?? wallRing
  const walk = makeWalk(outline)
  const labels = labelGrid(pans, outline)
  if (!labels.size) return null

  const regions: Set<string>[] = pans.map(() => new Set<string>())
  for (const [k, l] of labels) regions[l]?.add(k)

  // Absorption des ÉCHARDES : une région minuscule, ou si étroite qu'une
  // érosion d'une cellule la fait disparaître (lamelles du RANSAC
  // sur-segmenté), est fusionnée dans le voisin au plus long contact — son
  // aire est alors dessinée par le voisin, ses m² restent dans la légende.
  const absorbed = new Set<number>()
  const absorbedPairs: [number, number][] = []
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < pans.length; i++) {
      if (absorbed.has(i) || !regions[i].size) continue
      const cells = regions[i]
      let core = 0
      for (const k of cells) {
        const [cx, cy] = k.split(':').map(Number)
        let full = true
        for (let dx = -1; dx <= 1 && full; dx++) {
          for (let dy = -1; dy <= 1 && full; dy++) {
            if (!cells.has(`${cx + dx}:${cy + dy}`)) full = false
          }
        }
        if (full) core++
      }
      if (cells.size >= TINY_CELLS && core >= THIN_CORE_RATIO * cells.size) continue
      const contact = new Map<number, number>()
      for (const k of cells) {
        const [cx, cy] = k.split(':').map(Number)
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          const l = labels.get(`${nx}:${ny}`)
          if (l !== undefined && l !== i && !absorbed.has(l)) {
            contact.set(l, (contact.get(l) ?? 0) + 1)
          }
        }
      }
      let best = -1
      let bestN = 0
      for (const [l, n] of contact) {
        if (n > bestN || (n === bestN && l < best)) {
          bestN = n
          best = l
        }
      }
      if (best < 0) continue // région isolée : conservée telle quelle
      for (const k of cells) {
        labels.set(k, best)
        regions[best].add(k)
      }
      regions[i] = new Set()
      absorbed.add(i)
      absorbedPairs.push([i, best])
      changed = true
    }
  }

  const corners = cornerLabels(labels)

  // Soudure / marche par paire de pans : décidée sur TOUTE la frontière de
  // la paire (tous les coins portant les deux étiquettes — pas la première
  // chaîne rencontrée : un rognon de 3 coins près d'une jonction figeait un
  // verdict « marche » pour un faîtage de 11 m, Rosa Floch). Et au QUARTILE
  // BAS des écarts : les coins de grille zigzaguent à ±0,5 m du vrai faîtage
  // (sur un 46°, 35 cm d'écart latéral = 0,7 m d'écart vertical) — au vrai
  // faîtage une partie des coins tombe quasi dessus (écart ≈ 0), à une vraie
  // marche l'écart reste grand partout.
  const pairGaps = new Map<string, number[]>()
  for (const [k, s] of corners) {
    const ls = [...s].filter((l) => l !== OUTSIDE)
    if (ls.length < 2) continue
    const [gx, gy] = k.split(':').map(Number)
    const x = gx * CELL
    const y = gy * CELL
    for (let a = 0; a < ls.length; a++) {
      for (let b = a + 1; b < ls.length; b++) {
        const i = Math.min(ls[a], ls[b])
        const j = Math.max(ls[a], ls[b])
        const key = `${i}:${j}`
        const list = pairGaps.get(key) ?? []
        list.push(Math.abs(planeZ(pans[i].plane, x, y) - planeZ(pans[j].plane, x, y)))
        pairGaps.set(key, list)
      }
    }
  }
  const weldCache = new Map<string, boolean>()
  const isWelded = (i: number, j: number): boolean => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`
    const hit = weldCache.get(key)
    if (hit !== undefined) return hit
    const gaps = [...(pairGaps.get(key) ?? [])].sort((a, b) => a - b)
    const welded = gaps.length > 0 && gaps[Math.floor(gaps.length * 0.25)] <= STEP_TOL_M
    if (gaps.length) {
      debug?.(
        `weld ${key} : n=${gaps.length} p0=${gaps[0].toFixed(2)} p25=${gaps[Math.floor(gaps.length * 0.25)].toFixed(2)} p50=${gaps[Math.floor(gaps.length / 2)].toFixed(2)} -> ${welded}`,
      )
    }
    weldCache.set(key, welded)
    return welded
  }

  // Cache canonique des frontières intérieures : les deux pans riverains
  // récupèrent EXACTEMENT les mêmes sommets.
  const chainCache = new Map<string, [number, number][]>()
  const straighten = (raw: [number, number][]): [number, number][] => {
    const key0 = `${raw[0][0]}:${raw[0][1]}`
    const key1 = `${raw[raw.length - 1][0]}:${raw[raw.length - 1][1]}`
    const canonical = key0 <= key1
    const key = `${canonical ? key0 : key1}|${canonical ? key1 : key0}|${raw.length}`
    let s = chainCache.get(key)
    if (!s) {
      const line = canonical ? raw : [...raw].reverse()
      const [ax, ay] = line[0]
      const [bx, by] = line[line.length - 1]
      const len = Math.hypot(bx - ax, by - ay) || 1
      let worst = 0
      for (const [x, y] of line) {
        worst = Math.max(worst, Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len)
      }
      // Une frontière quasi droite EST une droite (faîtage/arêtier/noue) —
      // SAUF si la corde sort de la silhouette (emprise en L : un segment
      // peut couper à travers le coin rentrant) : on garde alors le tracé.
      let straightOk = worst <= STRAIGHT_TOL_CELLS
      if (straightOk) {
        for (const t of [0.25, 0.5, 0.75]) {
          const mx = (ax + (bx - ax) * t) * CELL
          const my = (ay + (by - ay) * t) * CELL
          if (!pointInRing(mx, my, outline) && distToRing(mx, my, outline) > 0.2) {
            straightOk = false
            break
          }
        }
      }
      s = straightOk ? [line[0], line[line.length - 1]] : dpOpen(line, 0.9)
      chainCache.set(key, s)
    }
    return canonical ? s : [...s].reverse()
  }

  const isJunction = (v: [number, number]) => (corners.get(`${v[0]}:${v[1]}`)?.size ?? 0) >= 3

  // Une jonction qui touche l'extérieur (fin de faîtage sur une rive…) est
  // ACCROCHÉE au polygone décalé : les chaînes intérieures et les arcs
  // extérieurs partagent alors exactement le même point, pour tous les pans.
  const snapCache = new Map<string, [number, number]>()
  const snap = (v: [number, number]): [number, number] => {
    const key = `${v[0]}:${v[1]}`
    const hit = snapCache.get(key)
    if (hit) return hit
    let pt: [number, number]
    if (corners.get(key)?.has(OUTSIDE)) {
      const px = v[0] * CELL
      const py = v[1] * CELL
      // Un SOMMET du polygone à portée aimante la jonction (fin de noue sur
      // le coin rentrant d'un L, fin de faîtage sur un angle de rive) —
      // sinon, projection sur l'arête la plus proche.
      let bestV: [number, number] | null = null
      let bestD = SNAP_CORNER_M
      for (const q of outline.slice(0, -1)) {
        const d = Math.hypot(q[0] - px, q[1] - py)
        if (d < bestD) {
          bestD = d
          bestV = q
        }
      }
      pt = bestV ?? projectToWalk(walk, px, py).pt
    } else {
      pt = [v[0] * CELL, v[1] * CELL]
    }
    snapCache.set(key, pt)
    return pt
  }

  const out: (ReconPan | null)[] = []
  // Frontières soudées observées pendant l'assemblage (paires dédupliquées).
  const weldPairs = new Set<string>()
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
    const junctionIdx = raw.map((v, idx) => (isJunction(v) ? idx : -1)).filter((x) => x >= 0)

    // Découpage en chaînes homogènes entre jonctions (partner constant).
    const chains: Chain[] = []
    if (junctionIdx.length === 0) {
      // Pas de jonction : soit pan unique (contour = polygone décalé entier),
      // soit île intérieure (contour DP fermé, limite assumée).
      const midLabels = corners.get(`${raw[0][0]}:${raw[0][1]}`)
      const others = [...(midLabels ?? [])].filter((l) => l !== i)
      if (others.length === 1 && others[0] === OUTSIDE) {
        chains.push({ raw: [...raw, raw[0]], partner: OUTSIDE })
      } else {
        // Île intérieure (lucarne) : anneau fermé simplifié tel quel — le
        // lissage d'anneau de lidar-core évite la corde dégénérée du DP.
        const dp = simplify([...raw, raw[0]], 0.9)
        chains.push({ raw: dp, partner: others[0] ?? OUTSIDE })
      }
    } else {
      const start = junctionIdx[0]
      const rotated = [...raw.slice(start), ...raw.slice(0, start)]
      const cuts = rotated.map((v, idx) => (isJunction(v) ? idx : -1)).filter((x) => x >= 0)
      for (let c = 0; c < cuts.length; c++) {
        const a = cuts[c]
        const b = cuts[(c + 1) % cuts.length]
        const rawChain =
          c === cuts.length - 1 ? [...rotated.slice(a), rotated[0]] : rotated.slice(a, b + 1)
        // Riverain : étiquettes au milieu de la chaîne, moins soi-même.
        const mid = rawChain[Math.floor(rawChain.length / 2)]
        const midLabels = [...(corners.get(`${mid[0]}:${mid[1]}`) ?? [])].filter(
          (l) => l !== i && l !== OUTSIDE,
        )
        const partner =
          midLabels.length === 1 && !corners.get(`${mid[0]}:${mid[1]}`)?.has(OUTSIDE)
            ? midLabels[0]
            : OUTSIDE
        debug?.(
          `pan ${i} chaîne ${rawChain.length} coins -> partner ${partner} (mid ${[...(corners.get(`${mid[0]}:${mid[1]}`) ?? [])].join('/')})`,
        )
        chains.push({ raw: rawChain, partner })
      }
    }

    // Assemblage : arcs du polygone décalé pour l'extérieur, segments/DP
    // partagés pour l'intérieur. On mémorise le riverain SOUDÉ par sommet.
    const contour: [number, number][] = []
    const weldedAt: Set<number>[] = []
    const pushVertex = (x: number, y: number, welded: Set<number>) => {
      const last = contour[contour.length - 1]
      if (last && Math.hypot(x - last[0], y - last[1]) < 1e-6) {
        // sommet de jonction déjà posé : fusion des riverains soudés
        for (const w of welded) weldedAt[weldedAt.length - 1].add(w)
        return
      }
      contour.push([x, y])
      weldedAt.push(new Set(welded))
    }
    for (const ch of chains) {
      if (ch.partner === OUTSIDE) {
        const from = snap(ch.raw[0])
        const to = snap(ch.raw[ch.raw.length - 1])
        const mid = ch.raw[Math.floor(ch.raw.length / 2)]
        const witness: [number, number] = [mid[0] * CELL, mid[1] * CELL]
        const isLoop = Math.hypot(to[0] - from[0], to[1] - from[1]) < 1e-6
        const arc = isLoop ? outline : boundaryArc(walk, from, to, witness)
        // Dernier point exclu : c'est la jonction de départ de la chaîne
        // suivante (ou le doublon de fermeture du polygone complet).
        for (let v = 0; v < arc.length - 1; v++) {
          pushVertex(arc[v][0], arc[v][1], new Set())
        }
      } else {
        const first = ch.raw[0]
        const last = ch.raw[ch.raw.length - 1]
        const isLoop = first[0] === last[0] && first[1] === last[1]
        // Boucle fermée (île) : déjà simplifiée, pas de redressement en corde.
        const s = isLoop ? ch.raw : straighten(ch.raw)
        const isW = isWelded(i, ch.partner)
        if (isW) {
          weldPairs.add(i < ch.partner ? `${i}:${ch.partner}` : `${ch.partner}:${i}`)
        }
        const welded = isW ? new Set([ch.partner]) : new Set<number>()
        for (let v = 0; v < s.length - 1; v++) {
          // Extrémités de chaîne : accrochées au polygone si elles touchent
          // l'extérieur (les sommets intermédiaires restent en grille).
          const pt =
            v === 0 ? snap(s[v]) : ([s[v][0] * CELL, s[v][1] * CELL] as [number, number])
          pushVertex(pt[0], pt[1], welded)
        }
      }
    }
    if (contour.length < 3) {
      out.push(null)
      continue
    }
    contour.push([contour[0][0], contour[0][1]])
    weldedAt.push(weldedAt[0])

    // Altitudes : plan du pan, moyenné avec les plans SOUDÉS en ce sommet.
    const alts = contour.map(([x, y], v) => {
      let z = planeZ(pans[i].plane, x, y)
      let n = 1
      for (const w of weldedAt[v]) {
        z += planeZ(pans[w].plane, x, y)
        n++
      }
      return z / n
    })

    // Garde de cohérence : le polygone doit couvrir ~ la surface de sa région.
    const polyArea = ringArea(contour)
    const cellArea = cells.size * CELL * CELL
    if (polyArea < 0.5 * cellArea || polyArea > 2.2 * cellArea) {
      out.push(null)
      continue
    }
    out.push({ contour, alts })
  }
  return {
    pans: out,
    welds: [...weldPairs].sort().map((k) => k.split(':').map(Number) as [number, number]),
    absorbed: absorbedPairs,
  }
}
