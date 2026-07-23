// -----------------------------------------------------------------------------
// Mesure de la surface de toiture depuis le nuage de points LiDAR HD (IGN).
// Tout se passe dans le navigateur : découverte de la dalle (WFS), lecture
// streamée du fichier COPC (requêtes Range ciblées, ~2-3 Mo par maison),
// reconstruction des pans (RANSAC déterministe), surface = Σ aire/cos(pente).
// Résultat mis en cache DÉFINITIF sur le point (migration db/0008).
//
// Algorithme validé hors app : docs/sop-mesure-toiture-lidar.md (banc
// synthétique ±2 %, gates G1 passés — mitoyens, toits plats, végétation).
// Module volontairement en chunk séparé (copc + laz-perf ≈ 1 Mo, chargé à la
// première mesure seulement), comme data/enrich.ts.
// -----------------------------------------------------------------------------
import proj4 from 'proj4'
import { Copc } from 'copc'
import { createLazPerf } from 'laz-perf'
// Le décodeur LAZ est du WebAssembly : Vite doit émettre le .wasm en asset et
// nous fournir son URL, sinon le glue Emscripten le chercherait à côté du
// chunk (introuvable en production).
import lazPerfWasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url'
import { supabase } from '../lib/supabase'

let lazPerfPromise: ReturnType<typeof createLazPerf> | undefined
function getLazPerf() {
  if (!lazPerfPromise) {
    lazPerfPromise = createLazPerf({ locateFile: () => lazPerfWasmUrl })
  }
  return lazPerfPromise
}

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon: number, lat: number): [number, number] =>
  proj4('EPSG:4326', 'EPSG:2154', [lon, lat]) as [number, number]
const fromL93 = (x: number, y: number): [number, number] =>
  proj4('EPSG:2154', 'EPSG:4326', [x, y]) as [number, number]

// Version de l'algorithme : déclarée dans domain/house.ts (module léger) pour
// que la fiche puisse décider d'un re-calcul sans charger ce chunk.
import { LIDAR_VERSION } from '../domain/house'

const BUFFER_M = 0.8 // débords de toit au-delà du mur
const RANSAC_VERT_TOL = 0.15
const MAX_PANS = 12
const MIN_PAN_M2 = 3
const MAX_SLOPE_DEG = 65
const CELL = 0.5
const FLAT_SLOPE_DEG = 7
const MIN_POINTS = 100 // en deçà : canopée totale ou maison post-survol
const MAX_EMPRISE_M2 = 350 // au-delà : bloc collectif fusionné par la BD TOPO
const MIN_COVERAGE = 0.55 // part de l'emprise vue par les pans

export type LidarStatut = 'ok' | 'faible_confiance' | 'grand_batiment' | 'no_data' | 'error'

export type { LidarPan } from '../domain/house'
import type { LidarPan } from '../domain/house'

export interface LidarResult {
  toit_lidar_statut: LidarStatut
  toit_lidar_m2: number | null
  toit_lidar_principal_m2: number | null
  toit_lidar_pans: LidarPan[] | null
  toit_lidar_millesime: string | null
}

type Pt = [number, number, number]
type Ring = [number, number][]

// --- Géométrie 2D --------------------------------------------------------------
function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function distToRing(px: number, py: number, ring: Ring): number {
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
function ringArea(ring: Ring): number {
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
function closeCells(cells: Set<string>, radius: number): Set<string> {
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

function traceOutline(cells: Set<string>): { ring: [number, number][]; area: number } | null {
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
function simplify(ring: [number, number][], eps: number): [number, number][] {
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

/** Contour lissé du pan en lng/lat (fermé), + centroïde pour l'étiquette. */
function panShape(
  cells: Set<string>,
): { contour: [number, number][]; centre: [number, number] } | null {
  // Enveloppe pleine (rayon 2 ≈ pontage des trous jusqu'à ~1 m) puis contour.
  const traced = traceOutline(closeCells(cells, 2))
  if (!traced || traced.ring.length < 4) return null
  // Garde de cohérence : si le polygone tracé couvre nettement moins que la
  // surface du pan (cellules trop éparses malgré la fermeture), un dessin
  // serait mensonger (pastille 86 m² sur une lanière) : on ne dessine pas.
  if (traced.area * CELL * CELL < 0.6 * cells.size * CELL * CELL) return null
  const raw = traced.ring
  // grille -> mètres L93, boucle fermée, puis lissage (les marches de 0,5 m
  // dévient d'au plus ~0,35 m de la diagonale qu'elles approximent).
  const meters = raw.map(([x, y]) => [x * CELL, y * CELL] as [number, number])
  meters.push(meters[0])
  // Lissage musclé (1 m) : des formes franches sans pointes ni crénelures —
  // retour captures briac. La surface affichée reste celle des cellules, le
  // contour n'est que de l'habillage.
  const smooth = simplify(meters, 1.0)
  if (smooth.length < 4) return null
  let cx = 0
  let cy = 0
  for (const [x, y] of smooth.slice(0, -1)) {
    cx += x
    cy += y
  }
  cx /= smooth.length - 1
  cy /= smooth.length - 1
  const round = ([lng, lat]: [number, number]): [number, number] => [
    Math.round(lng * 1e6) / 1e6,
    Math.round(lat * 1e6) / 1e6,
  ]
  return {
    contour: smooth.map(([x, y]) => round(fromL93(x, y))),
    centre: round(fromL93(cx, cy)),
  }
}

interface Measure {
  pans: LidarPan[]
  total: number
  totalPrincipal: number
  coverage: number
}

function measureRoof(pts: Pt[], ring: Ring): Measure {
  const { pans, density } = segmentPans(pts)
  // Seuil de densité pour les cellules HORS emprise murale : un vrai débord
  // de toit est aussi dense que le toit, les tranches de façade découpées par
  // le RANSAC ne laissent que des lignes clairsemées le long des murs.
  const outsideMin = Math.min(6, Math.max(2, Math.round(0.4 * density * CELL * CELL)))
  const used = new Set<string>()
  const metrics: {
    slopeDeg: number
    azimutDeg: number
    realDedup: number
    freshCells: Set<string>
  }[] = []
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
      azimutDeg: ((Math.atan2(-b, -a) * 180) / Math.PI + 360) % 360,
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
  const out: LidarPan[] = []
  for (const m of metrics) {
    const type: LidarPan['type'] =
      m.slopeDeg < FLAT_SLOPE_DEG
        ? 'plat'
        : mainSlope != null && Math.abs(m.slopeDeg - mainSlope) <= 8
          ? 'principal'
          : 'secondaire'
    total += m.realDedup
    if (type === 'principal') totalPrincipal += m.realDedup
    const shape = panShape(m.freshCells)
    out.push({
      type,
      pente_deg: Math.round(m.slopeDeg),
      azimut_deg: Math.round(m.azimutDeg),
      m2: Math.round(m.realDedup),
      ...(shape ?? {}),
    })
  }
  return {
    pans: out,
    total,
    totalPrincipal,
    coverage: (used.size * CELL * CELL) / ringArea(ring),
  }
}

// --- Données IGN ----------------------------------------------------------------
interface Bbox {
  minx: number
  miny: number
  maxx: number
  maxy: number
}

async function wfsBatiment(filter: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:batiment',
    COUNT: '10',
    outputFormat: 'application/json',
    CQL_FILTER: filter,
  })
  const r = await fetch(`https://data.geopf.fr/wfs/ows?${params.toString()}`)
  if (!r.ok) throw new Error(`WFS bâtiment ${r.status}`)
  return (await r.json()) as Record<string, unknown>
}

interface WfsFeature {
  properties?: Record<string, unknown>
  geometry?: { type: string; coordinates: unknown }
}

function featureRing(f: WfsFeature): Ring | null {
  const g = f.geometry
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
  const outer = (
    g.type === 'Polygon'
      ? (g.coordinates as number[][][])[0]
      : (g.coordinates as number[][][][])[0]?.[0]
  ) as number[][] | undefined
  if (!outer || outer.length < 4) return null
  return outer.map(([x, y]) => toL93(x, y))
}

/** Bâtiment tapé + polygones des voisins accolés (mitoyens, à exclure). */
async function fetchBuildingAndNeighbors(
  lng: number,
  lat: number,
): Promise<{ ring: Ring; neighbors: Ring[] } | null> {
  // ⚠ ordre lat lng (axe nord d'abord) — même convention que data/enrich.ts.
  const j =
    ((await wfsBatiment(`INTERSECTS(geometrie,POINT(${lat} ${lng}))`)) as {
      features?: WfsFeature[]
    }) ?? {}
  let main = j.features?.[0] ?? null
  const near = (await wfsBatiment(`DWITHIN(geometrie,POINT(${lat} ${lng}),25,meters)`)) as {
    features?: WfsFeature[]
  }
  const feats = near.features ?? []
  if (!main) main = feats[0] ?? null
  if (!main) return null
  const ring = featureRing(main)
  if (!ring) return null
  const mainId = main.properties?.cleabs
  const neighbors: Ring[] = []
  for (const f of feats) {
    if (f.properties?.cleabs === mainId) continue
    const r = featureRing(f)
    if (r) neighbors.push(r)
  }
  return { ring, neighbors }
}

async function fetchDalles(bb: Bbox): Promise<{ url: string; acquisition: string | null }[]> {
  const [w, s] = fromL93(bb.minx, bb.miny)
  const [e, n] = fromL93(bb.maxx, bb.maxy)
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle',
    COUNT: '4',
    SRSNAME: 'CRS:84',
    BBOX: `${w},${s},${e},${n},CRS:84`,
    outputFormat: 'application/json',
  })
  const r = await fetch(`https://data.geopf.fr/wfs/ows?${params.toString()}`)
  if (!r.ok) throw new Error(`WFS dalle LiDAR ${r.status}`)
  const j = (await r.json()) as {
    features?: { properties?: { url?: string; metadata?: string } }[]
  }
  return (j.features ?? [])
    .filter((f) => typeof f.properties?.url === 'string')
    .map((f) => {
      let acquisition: string | null = null
      try {
        const meta = JSON.parse(f.properties?.metadata ?? '{}') as Record<string, unknown>
        if (typeof meta.date_fin_acquisition === 'string') acquisition = meta.date_fin_acquisition
      } catch {
        /* métadonnées absentes : non bloquant */
      }
      return { url: f.properties!.url!, acquisition }
    })
}

// Le service IGN limite le débit : concurrence plafonnée + retries backoff.
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

function makeGetter(url: string): (begin: number, end: number) => Promise<Uint8Array> {
  return async (begin, end) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      if (r.ok || r.status === 206) return new Uint8Array(await r.arrayBuffer())
      if (r.status !== 429 || attempt >= 5) throw new Error(`LiDAR Range ${r.status}`)
      await sleep(500 * 2 ** attempt)
    }
  }
}

async function pAll<T>(thunks: (() => Promise<T>)[], limit = 4): Promise<T[]> {
  const results = new Array<T>(thunks.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, thunks.length) }, async () => {
      while (next < thunks.length) {
        const i = next++
        results[i] = await thunks[i]()
      }
    }),
  )
  return results
}

function nodeBounds(cube: number[], key: string): Bbox {
  const [d, x, y] = key.split('-').map(Number)
  const size = (cube[3] - cube[0]) / 2 ** d
  return {
    minx: cube[0] + x * size,
    miny: cube[1] + y * size,
    maxx: cube[0] + (x + 1) * size,
    maxy: cube[1] + (y + 1) * size,
  }
}
const intersects = (a: Bbox, b: Bbox) =>
  a.maxx >= b.minx && a.minx <= b.maxx && a.maxy >= b.miny && a.miny <= b.maxy

/** Points « bâtiment » (classe 6) dans le polygone bufferisé, toutes dalles. */
async function collectRoofPoints(
  ring: Ring,
  neighbors: Ring[],
): Promise<{ pts: Pt[]; millesime: string | null }> {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const bb: Bbox = {
    minx: Math.min(...xs) - BUFFER_M,
    maxx: Math.max(...xs) + BUFFER_M,
    miny: Math.min(...ys) - BUFFER_M,
    maxy: Math.max(...ys) + BUFFER_M,
  }
  const dalles = await fetchDalles(bb)
  if (!dalles.length) return { pts: [], millesime: null }
  const millesime = dalles[0].acquisition

  const pts: Pt[] = []
  for (const { url } of dalles) {
    const get = makeGetter(url)
    const copc = await Copc.create(get)
    const cube = copc.info.cube

    type NodeRef = Parameters<typeof Copc.loadPointDataView>[2]
    const nodes: NodeRef[] = []
    const walk = async (page: NonNullable<Parameters<typeof Copc.loadHierarchyPage>[1]>) => {
      const { nodes: pageNodes, pages } = await Copc.loadHierarchyPage(get, page)
      for (const [key, node] of Object.entries(pageNodes)) {
        if (!node?.pointCount) continue
        if (intersects(nodeBounds(cube, key), bb)) nodes.push(node)
      }
      for (const [key, subpage] of Object.entries(pages)) {
        if (!subpage) continue
        if (intersects(nodeBounds(cube, key), bb)) await walk(subpage)
      }
    }
    await walk(copc.info.rootHierarchyPage)

    const lazPerf = await getLazPerf()
    const views = await pAll(
      nodes.map((node) => () => Copc.loadPointDataView(get, copc, node, { lazPerf })),
      4,
    )
    for (const view of views) {
      const gx = view.getter('X')
      const gy = view.getter('Y')
      const gz = view.getter('Z')
      const gc = view.getter('Classification')
      for (let i = 0; i < view.pointCount; i++) {
        const x = gx(i)
        const y = gy(i)
        if (x < bb.minx || x > bb.maxx || y < bb.miny || y > bb.maxy) continue
        if (gc(i) !== 6) continue
        if (!pointInRing(x, y, ring) && distToRing(x, y, ring) > BUFFER_M) continue
        if (neighbors.some((nring) => pointInRing(x, y, nring))) continue
        pts.push([x, y, gz(i)])
      }
    }
  }
  return { pts, millesime }
}

// --- Orchestration ----------------------------------------------------------------

async function computeLidar(lng: number, lat: number): Promise<LidarResult> {
  const building = await fetchBuildingAndNeighbors(lng, lat)
  if (!building) {
    return {
      toit_lidar_statut: 'no_data',
      toit_lidar_m2: null,
      toit_lidar_principal_m2: null,
      toit_lidar_pans: null,
      toit_lidar_millesime: null,
    }
  }
  const { pts, millesime } = await collectRoofPoints(building.ring, building.neighbors)
  if (pts.length < MIN_POINTS) {
    // Canopée totale, maison construite après le survol, ou zone non couverte :
    // pas de mesure fiable possible, la fiche garde l'estimation actuelle.
    return {
      toit_lidar_statut: 'no_data',
      toit_lidar_m2: null,
      toit_lidar_principal_m2: null,
      toit_lidar_pans: null,
      toit_lidar_millesime: millesime,
    }
  }
  const emprise = ringArea(building.ring)
  const m = measureRoof(pts, building.ring)
  const statut: LidarStatut =
    emprise > MAX_EMPRISE_M2
      ? 'grand_batiment'
      : m.coverage < MIN_COVERAGE
        ? 'faible_confiance'
        : 'ok'
  return {
    toit_lidar_statut: statut,
    toit_lidar_m2: Math.round(m.total),
    toit_lidar_principal_m2: Math.round(m.totalPrincipal),
    toit_lidar_pans: m.pans,
    toit_lidar_millesime: millesime,
  }
}

async function computeSafe(lng: number, lat: number): Promise<LidarResult> {
  try {
    return await computeLidar(lng, lat)
  } catch (e) {
    console.error('Mesure LiDAR :', e)
    return {
      toit_lidar_statut: 'error',
      toit_lidar_m2: null,
      toit_lidar_principal_m2: null,
      toit_lidar_pans: null,
      toit_lidar_millesime: null,
    }
  }
}

// Cache mémoire par coordonnées (~1 m), comme la fiche enrichie : consulter
// une maison PUIS poser le point ne télécharge et ne calcule qu'une fois.
const coordCache = new Map<string, Promise<LidarResult>>()

/** Mesure de la toiture d'une maison consultée (sans point posé, sans écriture). */
export function fetchHouseLidar(lng: number, lat: number): Promise<LidarResult> {
  const key = `${lng.toFixed(5)},${lat.toFixed(5)}`
  const hit = coordCache.get(key)
  if (hit) return hit
  const p = computeSafe(lng, lat)
  coordCache.set(key, p)
  // Une erreur réseau doit pouvoir être retentée à la prochaine consultation.
  void p.then((r) => {
    if (r.toit_lidar_statut === 'error') coordCache.delete(key)
  })
  return p
}

/**
 * Mesure la toiture du point et met le résultat en cache définitif sur la
 * ligne `points` (best effort, comme l'enrichissement). En cas d'erreur
 * réseau, le statut `error` est enregistré : la prochaine ouverture de la
 * fiche re-tentera.
 */
export async function measurePointRoof(
  pointId: string,
  lng: number,
  lat: number,
): Promise<LidarResult> {
  const result = await fetchHouseLidar(lng, lat)
  if (supabase) {
    const { error } = await supabase
      .from('points')
      .update({ ...result, toit_lidar_version: LIDAR_VERSION })
      .eq('id', pointId)
    if (error) console.error('Cache mesure LiDAR :', error.message)
  }
  return result
}
