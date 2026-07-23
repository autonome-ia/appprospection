// -----------------------------------------------------------------------------
// Mesure de la surface de toiture depuis le nuage de points LiDAR HD (IGN).
// Tout se passe dans le navigateur : découverte de la dalle (WFS), lecture
// streamée du fichier COPC (requêtes Range ciblées, ~2-3 Mo par maison),
// reconstruction des pans (RANSAC déterministe), surface = Σ aire/cos(pente).
// Résultat mis en cache DÉFINITIF sur le point (migration db/0008).
//
// Le cœur de calcul (RANSAC, grille, contours) est dans lidar-core.ts (pur,
// testé par lidar-core.test.ts) ; ce module orchestre : réseau IGN, projection,
// verdicts, caches. Algorithme validé : docs/sop-mesure-toiture-lidar.md
// (banc synthétique ±2 %, gates G0/G1 passés).
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
import {
  CELL,
  closeCells,
  distToRing,
  measureRoof,
  pointInRing,
  ringArea,
  simplify,
  traceOutline,
  type Plane,
  type Pt,
  type Ring,
} from './lidar-core'

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

const BUFFER_M = 0.8 // débords de toit au-delà du mur (collecte des points)
const OVERHANG_M = 0.5 // débord DESSINÉ : silhouette du toit au-delà des murs
const MIN_POINTS = 100 // en deçà : canopée totale ou maison post-survol
const MAX_EMPRISE_M2 = 350 // au-delà : bloc collectif fusionné par la BD TOPO
const MIN_COVERAGE = 0.55 // part de l'emprise vue par les pans

// Réseau mobile : sans délai maximal, un fetch qui pend laisse le badge
// « mesure du toit… » pulser indéfiniment ET coince la promesse dans le cache
// par coordonnées (plus aucun retry possible de la session). Chaque requête a
// son timeout, et la mesure entière un garde-fou -> verdict `error`
// (re-tentable, circuit existant).
const FETCH_TIMEOUT_MS = 20_000
const MEASURE_TIMEOUT_MS = 60_000

function fetchT(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

export type LidarStatut = 'ok' | 'faible_confiance' | 'grand_batiment' | 'no_data' | 'error'

export type { LidarPan, RoofData } from '../domain/house'
import type { LidarPan, RoofData } from '../domain/house'
import { reconstructRoof } from './lidar-recon'

export interface LidarResult {
  toit_lidar_statut: LidarStatut
  toit_lidar_m2: number | null
  toit_lidar_principal_m2: number | null
  toit_lidar_pans: RoofData | null
  toit_lidar_millesime: string | null
}

const roundLL = ([lng, lat]: [number, number]): [number, number] => [
  Math.round(lng * 1e6) / 1e6,
  Math.round(lat * 1e6) / 1e6,
]

/**
 * Contour lissé du pan en lng/lat (fermé), + centroïde pour l'étiquette,
 * + altitude ABSOLUE de chaque sommet sur le plan du pan (normalisée ensuite
 * en relatif par computeLidar — sert à la maquette 3D de la fiche).
 */
function panShape(
  cells: Set<string>,
  plane: Plane,
): { contour: [number, number][]; centre: [number, number]; alts: number[] } | null {
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
  const [a, b, c] = plane
  return {
    contour: smooth.map(([x, y]) => roundLL(fromL93(x, y))),
    centre: roundLL(fromL93(cx, cy)),
    alts: smooth.map(([x, y]) => a * x + b * y + c),
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
  const r = await fetchT(`https://data.geopf.fr/wfs/ows?${params.toString()}`)
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

// Tap hors de tout polygone (trottoir, jardin) : au-delà de cette distance,
// aucun bâtiment ne peut être raisonnablement désigné -> no_data plutôt que
// de mesurer (et afficher comme « sûre ») la toiture d'une autre maison.
const MAX_SNAP_M = 10

interface BuildingInfo {
  ring: Ring
  neighbors: Ring[]
  /** Hauteur BD TOPO (faîtage − sol) : la plus fiable pour la maquette. */
  hauteur: number | null
  /** Repli : gouttière − sol (bruité sur terrain en pente). */
  gouttiereSol: number | null
}

/** Bâtiment tapé + polygones des voisins accolés (mitoyens, à exclure). */
async function fetchBuildingAndNeighbors(lng: number, lat: number): Promise<BuildingInfo | null> {
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
  if (!main) {
    // L'ordre de DWITHIN est arbitraire (serveur WFS) : on choisit le bâtiment
    // le PLUS PROCHE du point, et seulement s'il est à portée de tap.
    const [px, py] = toL93(lng, lat)
    let bestD = MAX_SNAP_M
    for (const f of feats) {
      const r = featureRing(f)
      if (!r) continue
      const d = pointInRing(px, py, r) ? 0 : distToRing(px, py, r)
      if (d < bestD) {
        bestD = d
        main = f
      }
    }
  }
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
  const props = main.properties ?? {}
  const altToit =
    typeof props.altitude_minimale_toit === 'number' ? props.altitude_minimale_toit : null
  const altSol =
    typeof props.altitude_minimale_sol === 'number' ? props.altitude_minimale_sol : null
  return {
    ring,
    neighbors,
    hauteur: typeof props.hauteur === 'number' && props.hauteur > 0 ? props.hauteur : null,
    gouttiereSol: altToit != null && altSol != null && altToit > altSol ? altToit - altSol : null,
  }
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
  const r = await fetchT(`https://data.geopf.fr/wfs/ows?${params.toString()}`)
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
      const r = await fetchT(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
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
  // Maison à cheval sur 2 dalles d'acquisitions différentes : afficher le
  // survol le plus récent (dates ISO, tri lexicographique suffisant).
  const millesime =
    dalles
      .map((d) => d.acquisition)
      .filter((a): a is string => a !== null)
      .sort()
      .at(-1) ?? null

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
  const emprise = ringArea(building.ring)
  if (emprise > MAX_EMPRISE_M2) {
    // Polygone BD TOPO = bloc collectif entier : la fiche n'affiche rien pour
    // ce verdict, inutile de télécharger 2-3 Mo pour mesurer tout le bloc.
    return {
      toit_lidar_statut: 'grand_batiment',
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
  const m = measureRoof(pts, building.ring)
  const statut: LidarStatut = m.coverage < MIN_COVERAGE ? 'faible_confiance' : 'ok'

  // Reconstruction JOINTIVE et rectiligne (silhouette = emprise décalée du
  // débord) ; repli pan par pan sur l'ancienne vectorisation (enveloppe
  // morphologique) si une région est dégénérée.
  const recon = reconstructRoof(
    m.pans.map((p) => ({ plane: p.plane, counts: p.counts })),
    building.ring,
    OVERHANG_M,
  )
  const shapes = m.pans.map((p, i) => {
    const r = recon?.[i]
    if (r) {
      let cx = 0
      let cy = 0
      for (const [x, y] of r.contour.slice(0, -1)) {
        cx += x
        cy += y
      }
      const n = r.contour.length - 1
      return {
        contour: r.contour.map(([x, y]) => roundLL(fromL93(x, y))),
        centre: roundLL(fromL93(cx / n, cy / n)),
        alts: r.alts,
      }
    }
    return panShape(p.freshCells, p.plane)
  })
  // Altitudes relatives à la gouttière la plus basse du toit (0 = point le
  // plus bas dessiné) : petits nombres dans le jsonb, et la maquette pose ses
  // murs sous ce zéro.
  const zMin = Math.min(...shapes.flatMap((s) => s?.alts ?? []))
  const pans: LidarPan[] = m.pans.map((p, i) => {
    const shape = shapes[i]
    return {
      type: p.type,
      pente_deg: Math.round(p.slopeDeg),
      azimut_deg: Math.round(p.azimutDeg),
      m2: Math.round(p.realDedup),
      ...(shape
        ? {
            contour: shape.contour,
            centre: shape.centre,
            alts: shape.alts.map((z) => Math.round((z - zMin) * 10) / 10),
          }
        : {}),
    }
  })
  // Hauteur de gouttière pour les murs de la maquette : hauteur BD TOPO
  // (faîtage − sol, la plus fiable) MOINS le comble MESURÉ au LiDAR. Repli :
  // gouttière − sol (bruité sur terrain en pente — les « maisons donjons »).
  // Bornée à une plage réaliste de pavillon.
  const comble = Math.max(0, ...pans.flatMap((p) => p.alts ?? []))
  const murRaw =
    building.hauteur != null && comble > 0 ? building.hauteur - comble : building.gouttiereSol
  const murM =
    murRaw != null ? Math.round(Math.min(6, Math.max(1.8, murRaw)) * 10) / 10 : null
  return {
    toit_lidar_statut: statut,
    toit_lidar_m2: Math.round(m.total),
    toit_lidar_principal_m2: Math.round(m.totalPrincipal),
    toit_lidar_pans: {
      mur_m: murM,
      // Emprise murale : silhouette des murs de la maquette (le toit déborde).
      emprise: building.ring.map(([x, y]) => roundLL(fromL93(x, y))),
      pans,
    },
    toit_lidar_millesime: millesime,
  }
}

async function computeSafe(lng: number, lat: number): Promise<LidarResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Mesure LiDAR : délai dépassé (${MEASURE_TIMEOUT_MS / 1000} s)`)),
        MEASURE_TIMEOUT_MS,
      )
    })
    return await Promise.race([computeLidar(lng, lat), deadline])
  } catch (e) {
    console.error('Mesure LiDAR :', e)
    return {
      toit_lidar_statut: 'error',
      toit_lidar_m2: null,
      toit_lidar_principal_m2: null,
      toit_lidar_pans: null,
      toit_lidar_millesime: null,
    }
  } finally {
    clearTimeout(timer)
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

// Écriture en vol par point : la pose déclenche la mesure (data/points.ts) ET
// la fiche qui s'ouvre dans la foulée la redéclenche — le calcul est déjà
// dédupliqué par coordonnées, ceci évite la DOUBLE écriture en base (et son
// double événement realtime).
const pointInFlight = new Map<string, Promise<LidarResult>>()

/**
 * Mesure la toiture du point et met le résultat en cache définitif sur la
 * ligne `points` — via le RPC `cache_point_lidar` (migration db/0009), qui
 * autorise le cache sur les points des collègues (la policy d'update générale
 * reste réservée à l'auteur/manager). Repli sur l'update direct tant que la
 * migration n'est pas exécutée. En cas d'erreur réseau, le statut `error` est
 * enregistré : la prochaine ouverture de la fiche re-tentera.
 */
export function measurePointRoof(pointId: string, lng: number, lat: number): Promise<LidarResult> {
  const hit = pointInFlight.get(pointId)
  if (hit) return hit
  const p = (async () => {
    const result = await fetchHouseLidar(lng, lat)
    if (supabase) {
      const { error } = await supabase.rpc('cache_point_lidar', {
        p_point_id: pointId,
        p_m2: result.toit_lidar_m2,
        p_principal_m2: result.toit_lidar_principal_m2,
        p_pans: result.toit_lidar_pans,
        p_statut: result.toit_lidar_statut,
        p_millesime: result.toit_lidar_millesime,
        p_version: LIDAR_VERSION,
      })
      if (error) {
        const { error: e2 } = await supabase
          .from('points')
          .update({ ...result, toit_lidar_version: LIDAR_VERSION })
          .eq('id', pointId)
        if (e2) console.error('Cache mesure LiDAR :', e2.message)
      }
    }
    return result
  })()
  pointInFlight.set(pointId, p)
  void p.finally(() => pointInFlight.delete(pointId))
  return p
}
