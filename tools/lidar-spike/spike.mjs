// ---------------------------------------------------------------------------
// Spike Phase 0 — Mesure de toiture depuis le LiDAR HD IGN (SOP
// docs/sop-mesure-toiture-lidar.md). Script jetable, hors app.
//
// Usage : node spike.mjs [lon] [lat]
//   défaut : maison test de Lesneven (29).
//
// Pipeline : WFS BD TOPO (polygone bâtiment + estimation actuelle)
//   → WFS tableau d'assemblage LiDAR HD (URL de la dalle COPC)
//   → lecture streamée (Range) des nœuds COPC intersectant le bâtiment
//   → points classe 6 dans le polygone bufferisé (débords de toit)
//   → RANSAC itératif de plans (z = ax + by + c)
//   → aire par pan = grille d'occupation 0,5 m / cos(pente)
// ---------------------------------------------------------------------------
import { Copc } from 'copc'
import proj4 from 'proj4'
import { measureRoof, pointInRing, distToRing } from './lib.mjs'

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2154', [lon, lat])

const [lon, lat] = [
  Number(process.argv[2] ?? -4.327291),
  Number(process.argv[3] ?? 48.568813),
]
const BUFFER_M = 0.8 // débords de toit au-delà du mur (réduit : 1,2 m gonflait
// la mesure des petites maisons via les points de façade — cf. SOP, Mions)

// --- 1. Bâtiment (BD TOPO) --------------------------------------------------
async function fetchBuilding() {
  async function query(filter) {
    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: 'BDTOPO_V3:batiment',
      COUNT: '1',
      outputFormat: 'application/json',
      CQL_FILTER: filter,
    })
    const r = await fetch(`https://data.geopf.fr/wfs/ows?${params}`)
    if (!r.ok) throw new Error(`WFS batiment ${r.status}`)
    return (await r.json()).features?.[0]
  }
  // point exact, sinon bâtiment le plus proche (30 m) — les coords BAN d'une
  // rue tombent sur la chaussée.
  const f =
    (await query(`INTERSECTS(geometrie,POINT(${lat} ${lon}))`)) ??
    (await query(`DWITHIN(geometrie,POINT(${lat} ${lon}),30,meters)`))
  if (!f) throw new Error('Aucun bâtiment BD TOPO à ces coordonnées')
  const g = f.geometry
  const outer =
    g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
  const ring = outer.map(([x, y]) => toL93(x, y))
  return { ring, props: f.properties ?? {} }
}

// Bâtiments voisins accolés (mitoyens, garages du voisin) : leurs points ne
// doivent pas entrer dans notre mesure via le tampon de débord.
async function fetchNeighbors(cleabs) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:batiment',
    COUNT: '10',
    outputFormat: 'application/json',
    CQL_FILTER: `DWITHIN(geometrie,POINT(${lat} ${lon}),25,meters)`,
  })
  const r = await fetch(`https://data.geopf.fr/wfs/ows?${params}`)
  if (!r.ok) return []
  const feats = (await r.json()).features ?? []
  return feats
    .filter((f) => f.properties?.cleabs !== cleabs)
    .map((f) => {
      const g = f.geometry
      const outer = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
      return outer.map(([x, y]) => toL93(x, y))
    })
}

// Estimation actuelle de l'app (emprise / cos(pente)) pour comparaison.
function currentEstimate(ring, p) {
  let area = 0
  let perimeter = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    area += x1 * y2 - x2 * y1
    perimeter += Math.hypot(x2 - x1, y2 - y1)
  }
  area = Math.abs(area) / 2
  let factor = 1.18
  const zMin = p.altitude_minimale_toit
  const zMax = p.altitude_maximale_toit
  if (typeof zMin === 'number' && typeof zMax === 'number' && zMax > zMin) {
    const half = perimeter / 2
    const disc = half * half - 4 * area
    if (disc > 0) {
      const width = (half - Math.sqrt(disc)) / 2
      if (width > 2) {
        const pente = Math.atan((zMax - zMin) / (width / 2))
        const c = Math.min(Math.max(pente, (15 * Math.PI) / 180), (55 * Math.PI) / 180)
        factor = 1 / Math.cos(c)
      }
    }
  }
  return { emprise: area, estimation: area * factor }
}

// --- 2. Dalles LiDAR HD ---------------------------------------------------------
// Une maison peut être à cheval sur 2 dalles (frontière au km) : on cherche
// toutes les dalles intersectant la bbox du BÂTIMENT (pas le point cliqué).
async function fetchDalles(bbL93) {
  const inv = (x, y) => proj4('EPSG:2154', 'EPSG:4326', [x, y])
  const [w, s] = inv(bbL93.minx, bbL93.miny)
  const [e, n] = inv(bbL93.maxx, bbL93.maxy)
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
  const r = await fetch(`https://data.geopf.fr/wfs/ows?${params}`)
  if (!r.ok) throw new Error(`WFS dalle ${r.status}`)
  const feats = (await r.json()).features ?? []
  if (!feats.length) throw new Error('Aucune dalle LiDAR HD ici')
  return feats.map((f) => ({
    url: f.properties.url,
    acquisition: JSON.parse(f.properties.metadata ?? '{}').date_fin_acquisition,
  }))
}

// --- 3. Lecture COPC streamée -------------------------------------------------
// Le service IGN limite le débit (429 constaté quand on parallélise sans
// retenue) : concurrence plafonnée + retries avec backoff exponentiel.
let bytesFetched = 0
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function makeGetter(url) {
  return async (begin, end) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      if (r.ok || r.status === 206) {
        const buf = new Uint8Array(await r.arrayBuffer())
        bytesFetched += buf.length
        return buf
      }
      if (r.status !== 429 || attempt >= 5) throw new Error(`Range ${r.status}`)
      await sleep(500 * 2 ** attempt)
    }
  }
}

/** Exécute des tâches async avec au plus `limit` en parallèle. */
async function pAll(thunks, limit = 4) {
  const results = new Array(thunks.length)
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

function nodeBounds(cube, key) {
  const [d, x, y, z] = key.split('-').map(Number)
  const size = (cube[3] - cube[0]) / 2 ** d
  return {
    minx: cube[0] + x * size,
    miny: cube[1] + y * size,
    minz: cube[2] + z * size,
    maxx: cube[0] + (x + 1) * size,
    maxy: cube[1] + (y + 1) * size,
    maxz: cube[2] + (z + 1) * size,
  }
}

// --- main -----------------------------------------------------------------------
const t0 = Date.now()
const { ring, props } = await fetchBuilding()
const neighbors = await fetchNeighbors(props.cleabs)
const { emprise, estimation } = currentEstimate(ring, props)
console.log(`Bâtiment BD TOPO : emprise ${emprise.toFixed(0)} m², hauteur ${props.hauteur ?? '?'} m, toit ${props.materiaux_de_la_toiture ?? '?'}`)
console.log(`Estimation ACTUELLE de l'app : ~${Math.round(estimation / 5) * 5} m²`)

// bbox du bâtiment bufferisée
const xs = ring.map((p) => p[0])
const ys = ring.map((p) => p[1])
const bb = {
  minx: Math.min(...xs) - BUFFER_M,
  maxx: Math.max(...xs) + BUFFER_M,
  miny: Math.min(...ys) - BUFFER_M,
  maxy: Math.max(...ys) + BUFFER_M,
}

const dalles = await fetchDalles(bb)
console.log(`Dalles : ${dalles.map((d) => `${d.url.split('/').pop()} (${d.acquisition})`).join(' + ')}`)

// extraction des points classe 6 dans le polygone bufferisé, toutes dalles
const pts = []
const classCounts = {}
for (const { url } of dalles) {
  const get = makeGetter(url)
  const copc = await Copc.create(get)
  const cube = copc.info.cube

  // parcours de la hiérarchie COPC (pages imbriquées comprises)
  const allNodes = []
  async function walk(page) {
    const { nodes, pages } = await Copc.loadHierarchyPage(get, page)
    for (const [key, node] of Object.entries(nodes)) {
      if (!node || !node.pointCount) continue
      const nb = nodeBounds(cube, key)
      if (nb.maxx < bb.minx || nb.minx > bb.maxx || nb.maxy < bb.miny || nb.miny > bb.maxy) continue
      allNodes.push({ key, node })
    }
    for (const [key, subpage] of Object.entries(pages)) {
      if (!subpage) continue
      const nb = nodeBounds(cube, key)
      if (nb.maxx < bb.minx || nb.minx > bb.maxx || nb.maxy < bb.miny || nb.miny > bb.maxy) continue
      await walk(subpage)
    }
  }
  await walk(copc.info.rootHierarchyPage)
  console.log(`  nœuds COPC utiles dans ${url.split('/').pop()} : ${allNodes.length}`)

  // Lecture parallèle des nœuds, plafonnée (le service IGN renvoie 429 sinon).
  const views = await pAll(
    allNodes.map(({ node }) => () => Copc.loadPointDataView(get, copc, node)),
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
      const cls = gc(i)
      classCounts[cls] = (classCounts[cls] ?? 0) + 1
      if (cls !== 6) continue
      if (!pointInRing(x, y, ring) && distToRing(x, y, ring) > BUFFER_M) continue
      // point du toit du voisin accolé ? (mitoyens : exclu, sans tampon)
      let neighbor = false
      for (const nring of neighbors) {
        if (pointInRing(x, y, nring)) {
          neighbor = true
          break
        }
      }
      if (!neighbor) pts.push([x, y, gz(i)])
    }
  }
}
console.log(`Points dans la bbox par classe : ${JSON.stringify(classCounts)}`)
console.log(`Points TOIT retenus (classe 6, polygone +${BUFFER_M} m) : ${pts.length} (${(pts.length / emprise).toFixed(1)} pts/m²)`)
if (pts.length < 100) {
  console.log('⚠️ Trop peu de points — abandon.')
  process.exit(1)
}

const { pans, leftover, total, totalPrincipal, density } = measureRoof(pts, ring)
console.log(`Densité locale : ${density.toFixed(1)} pts/m²`)
console.log('\nPans détectés :')
for (const m of pans) {
  console.log(
    `  [${m.type.padEnd(10)}] pente ${m.slopeDeg.toFixed(1).padStart(5)}° | azimut ${m.azimutDeg.toFixed(0).padStart(3)}° | ` +
      `réel ${m.realDedup.toFixed(1).padStart(6)} m² | ${m.n} pts`,
  )
}
console.log(`  (points non affectés à un pan : ${leftover})`)
console.log(`\n=== SURFACE TOITURE MESURÉE : ${total.toFixed(0)} m² ===`)
console.log(`    dont toit principal       : ${totalPrincipal.toFixed(0)} m²`)
console.log(`    vs estimation actuelle    : ~${Math.round(estimation / 5) * 5} m²`)
console.log(`    vs emprise au sol         : ${emprise.toFixed(0)} m²`)
console.log(`\n${(bytesFetched / 1024).toFixed(0)} Ko téléchargés · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
