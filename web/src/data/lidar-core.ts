// -----------------------------------------------------------------------------
// Cœur PUR de la mesure de toiture LiDAR : géométrie 2D, RANSAC déterministe,
// fusion des pans, grille d'occupation, traçage de contours. Aucune dépendance
// (ni réseau, ni proj4, ni Supabase) : ce module est testé directement par
// `lidar-core.test.ts` (banc synthétique + contours — les MÊMES cas que le
// spike historique tools/lidar-spike, mais sur le code réellement shippé).
// L'orchestration (WFS, COPC, cache) vit dans data/lidar.ts.
// -----------------------------------------------------------------------------

export const RANSAC_VERT_TOL = 0.15
export const MAX_PANS = 12
export const MIN_PAN_M2 = 3
export const MAX_SLOPE_DEG = 65
export const CELL = 0.5
export const FLAT_SLOPE_DEG = 7

export type Pt = [number, number, number]
export type Ring = [number, number][]

// --- Géométrie 2D --------------------------------------------------------------
export function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function distToRing(px: number, py: number, ring: Ring): number {
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)))
  }
  return best
}
export function ringArea(ring: Ring): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(a) / 2
}

// --- Plans z = ax + by + c ------------------------------------------------------
type Plane = [number, number, number]

function fitPlane3(p1: Pt, p2: Pt, p3: Pt): Plane | null {
  const det = (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  if (Math.abs(det) < 1e-6) return null
  const a = ((p1[2] - p3[2]) * (p2[1] - p3[1]) - (p2[2] - p3[2]) * (p1[1] - p3[1])) / det
  const b = ((p1[0] - p3[0]) * (p2[2] - p3[2]) - (p2[0] - p3[0]) * (p1[2] - p3[2])) / det
  return [a, b, p3[2] - a * p3[0] - b * p3[1]]
}
function refinePlane(pts: Pt[], idx: number[]): Plane | null {
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0
  const n = idx.length
  for (const i of idx) {
    const [x, y, z] = pts[i]
    sx += x; sy += y; sz += z
    sxx += x * x; syy += y * y; sxy += x * y
    sxz += x * z; syz += y * z
  }
  const mx = sx / n, my = sy / n, mz = sz / n
  const cxx = sxx / n - mx * mx
  const cyy = syy / n - my * my
  const cxy = sxy / n - mx * my
  const cxz = sxz / n - mx * mz
  const cyz = syz / n - my * mz
  const det = cxx * cyy - cxy * cxy
  if (Math.abs(det) < 1e-9) return null
  const a = (cxz * cyy - cyz * cxy) / det
  const b = (cyz * cxx - cxz * cxy) / det
  return [a, b, mz - a * mx - b * my]
}

const maxTan = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)

// RNG déterministe (LCG) : mêmes points -> même mesure, indispensable pour un
// cache en base cohérent entre les clients.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function localDensity(pts: Pt[]): number {
  const cells = new Set<string>()
  for (const [x, y] of pts) cells.add(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`)
  return cells.size ? pts.length / (cells.size * CELL * CELL) : 0
}

interface RawPan {
  plane: Plane
  inliers: number[]
}

function segmentPans(pts: Pt[]): { pans: RawPan[]; density: number } {
  const rng = makeRng(42)
  const density = localDensity(pts)
  const minInliers = Math.max(20, Math.round(2.5 * density))
  let remaining = pts.map((_, i) => i)
  const pans: RawPan[] = []
  while (remaining.length >= minInliers && pans.length < MAX_PANS) {
    let best: RawPan | null = null
    for (let iter = 0; iter < 400; iter++) {
      const s0 = remaining[(rng() * remaining.length) | 0]
      const s1 = remaining[(rng() * remaining.length) | 0]
      const s2 = remaining[(rng() * remaining.length) | 0]
      const plane = fitPlane3(pts[s0], pts[s1], pts[s2])
      if (!plane || Math.hypot(plane[0], plane[1]) > maxTan) continue
      const [a, b, c] = plane
      const inliers: number[] = []
      for (const i of remaining) {
        const [x, y, z] = pts[i]
        if (Math.abs(z - (a * x + b * y + c)) < RANSAC_VERT_TOL) inliers.push(i)
      }
      if (!best || inliers.length > best.inliers.length) best = { plane, inliers }
    }
    if (!best || best.inliers.length < minInliers) break
    const refined = refinePlane(pts, best.inliers)
    if (refined && Math.hypot(refined[0], refined[1]) <= maxTan) {
      const [a, b, c] = refined
      const inliers = remaining.filter(
        (i) => Math.abs(pts[i][2] - (a * pts[i][0] + b * pts[i][1] + c)) < RANSAC_VERT_TOL,
      )
      if (inliers.length >= minInliers) best = { plane: refined, inliers }
    }
    pans.push(best)
    const taken = new Set(best.inliers)
    remaining = remaining.filter((i) => !taken.has(i))
  }
  mergePans(pts, pans)
  return { pans, density }
}

// Fusion des pans sur-segmentés : plans quasi parallèles (< 5°) et quasi
// confondus (< 0,35 m au centroïde) = même pan physique.
function mergePans(pts: Pt[], pans: RawPan[]): void {
  const normal = ([a, b]: Plane): [number, number, number] => {
    const n = Math.hypot(a, b, 1)
    return [-a / n, -b / n, 1 / n]
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < pans.length && !merged; i++) {
      for (let j = i + 1; j < pans.length && !merged; j++) {
        const ni = normal(pans[i].plane)
        const nj = normal(pans[j].plane)
        if (ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2] < Math.cos((5 * Math.PI) / 180)) continue
        let cx = 0, cy = 0, cz = 0
        for (const k of pans[j].inliers) {
          cx += pts[k][0]; cy += pts[k][1]; cz += pts[k][2]
        }
        const n = pans[j].inliers.length
        cx /= n; cy /= n; cz /= n
        const [a, b, c] = pans[i].plane
        if (Math.abs(cz - (a * cx + b * cy + c)) > 0.35) continue
        pans[i].inliers = pans[i].inliers.concat(pans[j].inliers)
        pans[i].plane = refinePlane(pts, pans[i].inliers) ?? pans[i].plane
        pans.splice(j, 1)
        merged = true
      }
    }
  }
}

// --- Contour d'un pan (dessin sur l'ortho) --------------------------------------
// Cellules du pan -> frontière de l'union des carrés (traçage d'arêtes
// orientées, intérieur à gauche) -> plus grande boucle -> lissage.

// Fermeture morphologique large (dilatation puis érosion, rayon en cellules) :
// soude les cellules éparses d'un pan en une nappe pleine. Les toits d'ardoise
// sombre renvoient mal le laser → cellules trouées → sans cela, le contour ne
// traçait que le plus gros îlot (lanières mensongères, captures briac).
export function closeCells(cells: Set<string>, radius: number): Set<string> {
  let dil = new Set(cells)
  for (let r = 0; r < radius; r++) {
    const next = new Set(dil)
    for (const k of dil) {
      const [x, y] = k.split(':').map(Number)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) next.add(`${x + dx}:${y + dy}`)
      }
    }
    dil = next
  }
  for (let r = 0; r < radius; r++) {
    const next = new Set<string>()
    for (const k of dil) {
      const [x, y] = k.split(':').map(Number)
      let full = true
      for (let dx = -1; dx <= 1 && full; dx++) {
        for (let dy = -1; dy <= 1 && full; dy++) {
          if (!dil.has(`${x + dx}:${y + dy}`)) full = false
        }
      }
      if (full) next.add(k)
    }
    dil = next
  }
  return dil
}

export function traceOutline(
  cells: Set<string>,
): { ring: [number, number][]; area: number } | null {
  // Arêtes orientées (intérieur à gauche) dont le côté opposé est vide. Un
  // sommet peut porter PLUSIEURS départs (pincement en diagonale) : on chaîne
  // en choisissant le virage le plus à gauche par rapport à l'arête entrante.
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
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y) // bas
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1) // droite
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1) // haut
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y) // gauche
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
        // virage le plus à gauche : cross décroissant, puis dot décroissant
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
      area = area / 2 // signée : les trous (horaires) sont négatifs
      if (area > bestArea) {
        bestArea = area
        best = ring
      }
    }
  }
  return best ? { ring: best, area: bestArea } : null
}

// Douglas-Peucker sur une polyligne OUVERTE.
function dpOpen(line: [number, number][], eps: number): [number, number][] {
  if (line.length <= 2) return line
  const keep = new Array<boolean>(line.length).fill(false)
  keep[0] = true
  keep[line.length - 1] = true
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = line[a]
    const [bx, by] = line[b]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let worst = -1
    let worstD = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - line[i][1]) - (ax - line[i][0]) * (by - ay)) / len
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      stack.push([a, worst], [worst, b])
    }
  }
  return line.filter((_, i) => keep[i])
}

// Simplification d'un ANNEAU fermé : DP direct s'effondre (corde dégénérée
// premier = dernier point) — on coupe l'anneau au point le plus éloigné du
// départ et on simplifie les deux moitiés ouvertes.
export function simplify(ring: [number, number][], eps: number): [number, number][] {
  if (ring.length <= 5) return ring
  const open = ring.slice(0, -1)
  let far = 1
  let farD = -1
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = dpOpen(open.slice(0, far + 1), eps)
  const b = dpOpen(open.slice(far).concat([open[0]]), eps)
  return a.concat(b.slice(1))
}

// --- Mesure ----------------------------------------------------------------------

export interface PanMetrics {
  type: 'principal' | 'secondaire' | 'plat'
  slopeDeg: number
  azimutDeg: number
  /** Surface réelle du pan (m²), cellules dédupliquées entre pans. */
  realDedup: number
  /** Cellules propres au pan (servent au dessin de son contour). */
  freshCells: Set<string>
}

export interface RoofMeasure {
  pans: PanMetrics[]
  total: number
  totalPrincipal: number
  coverage: number
}

export function measureRoof(pts: Pt[], ring: Ring): RoofMeasure {
  const { pans, density } = segmentPans(pts)
  // Seuil de densité pour les cellules HORS emprise murale : un vrai débord
  // de toit est aussi dense que le toit, les tranches de façade découpées par
  // le RANSAC ne laissent que des lignes clairsemées le long des murs.
  const outsideMin = Math.min(6, Math.max(2, Math.round(0.4 * density * CELL * CELL)))
  const used = new Set<string>()
  const metrics: Omit<PanMetrics, 'type'>[] = []
  for (const pan of pans) {
    const [a, b] = pan.plane
    const slope = Math.atan(Math.hypot(a, b))
    const counts = new Map<string, number>()
    for (const i of pan.inliers) {
      const k = `${Math.floor(pts[i][0] / CELL)}:${Math.floor(pts[i][1] / CELL)}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const cells = new Set<string>()
    for (const [k, n] of counts) {
      if (n >= outsideMin) {
        cells.add(k)
        continue
      }
      const [cx, cy] = k.split(':').map(Number)
      if (pointInRing((cx + 0.5) * CELL, (cy + 0.5) * CELL, ring)) cells.add(k)
    }
    // Fermeture morphologique : une cellule vide entourée d'occupées est un
    // trou d'échantillonnage, pas un vrai trou de toit.
    const added: string[] = []
    for (const k of cells) {
      const [cx, cy] = k.split(':').map(Number)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue
          const nk = `${cx + dx}:${cy + dy}`
          if (cells.has(nk)) continue
          let occ = 0
          for (let ex = -1; ex <= 1; ex++) {
            for (let ey = -1; ey <= 1; ey++) {
              if (!ex && !ey) continue
              if (cells.has(`${cx + dx + ex}:${cy + dy + ey}`)) occ++
            }
          }
          if (occ >= 5) added.push(nk)
        }
      }
    }
    for (const k of added) cells.add(k)
    if (cells.size * CELL * CELL < MIN_PAN_M2) continue
    // Déduplication entre pans : deux plans superposés en XY (multi-niveaux)
    // ne comptent la même surface au sol qu'une fois. Les cellules propres au
    // pan servent aussi à dessiner son contour (pans sans chevauchement).
    const freshCells = new Set<string>()
    for (const c of cells) {
      if (!used.has(c)) {
        used.add(c)
        freshCells.add(c)
      }
    }
    metrics.push({
      slopeDeg: (slope * 180) / Math.PI,
      // Azimut BOUSSOLE de l'exposition du pan (0 = nord, 90 = est, 180 = sud).
      // La plus grande pente descend selon (-a, -b) en (x = est, y = nord) :
      // azimut = atan2(est, nord). (Une convention mathématique « angle depuis
      // l'est » a été stockée jusqu'à la v4 de l'algo.)
      azimutDeg: ((Math.atan2(-a, -b) * 180) / Math.PI + 360) % 360,
      realDedup: (freshCells.size * CELL * CELL) / Math.cos(slope),
      freshCells,
    })
  }
  // Typage des pans : plat / principal (plus grand pan incliné ± 8°) / secondaire.
  const pitched = metrics.filter((m) => m.slopeDeg >= FLAT_SLOPE_DEG)
  const mainSlope = pitched.length
    ? pitched.reduce((x, y) => (x.realDedup > y.realDedup ? x : y)).slopeDeg
    : null
  let total = 0
  let totalPrincipal = 0
  const out: PanMetrics[] = []
  for (const m of metrics) {
    const type: PanMetrics['type'] =
      m.slopeDeg < FLAT_SLOPE_DEG
        ? 'plat'
        : mainSlope != null && Math.abs(m.slopeDeg - mainSlope) <= 8
          ? 'principal'
          : 'secondaire'
    total += m.realDedup
    if (type === 'principal') totalPrincipal += m.realDedup
    out.push({ ...m, type })
  }
  return {
    pans: out,
    total,
    totalPrincipal,
    coverage: (used.size * CELL * CELL) / ringArea(ring),
  }
}
