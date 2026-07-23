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

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2154', [lon, lat])

const [lon, lat] = [
  Number(process.argv[2] ?? -4.327291),
  Number(process.argv[3] ?? 48.568813),
]
const BUFFER_M = 1.2 // débords de toit au-delà du mur
const RANSAC_VERT_TOL = 0.15 // tolérance verticale d'appartenance à un plan (m)
const MAX_PANS = 10
const MIN_PAN_M2 = 3 // aire projetée minimale d'un pan retenu
const MAX_SLOPE_DEG = 65 // au-delà : mur / artefact, pas un pan de toit
const CELL = 0.5 // grille d'occupation (m)

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
let bytesFetched = 0
function makeGetter(url) {
  return async (begin, end) => {
    const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
    if (!r.ok && r.status !== 206) throw new Error(`Range ${r.status}`)
    const buf = new Uint8Array(await r.arrayBuffer())
    bytesFetched += buf.length
    return buf
  }
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

// --- Géométrie 2D ---------------------------------------------------------------
function pointInRing(px, py, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}
function distToRing(px, py, ring) {
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

// --- 4. RANSAC de plans z = ax + by + c -----------------------------------------
function fitPlane3(p1, p2, p3) {
  // résout le système pour a, b, c
  const [x1, y1, z1] = p1
  const [x2, y2, z2] = p2
  const [x3, y3, z3] = p3
  const det = (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  if (Math.abs(det) < 1e-6) return null
  const a = ((z1 - z3) * (y2 - y3) - (z2 - z3) * (y1 - y3)) / det
  const b = ((x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3)) / det
  const c = z3 - a * x3 - b * y3
  return [a, b, c]
}
function refinePlane(pts, idx) {
  // moindres carrés z = ax + by + c sur les inliers
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

function segmentPans(pts) {
  let remaining = pts.map((_, i) => i)
  const pans = []
  while (remaining.length >= 40 && pans.length < MAX_PANS) {
    let best = null
    for (let iter = 0; iter < 400; iter++) {
      const s = [0, 0, 0].map(() => remaining[(Math.random() * remaining.length) | 0])
      const plane = fitPlane3(pts[s[0]], pts[s[1]], pts[s[2]])
      if (!plane) continue
      const [a, b, c] = plane
      if (Math.hypot(a, b) > Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)) continue
      const inliers = []
      for (const i of remaining) {
        const [x, y, z] = pts[i]
        if (Math.abs(z - (a * x + b * y + c)) < RANSAC_VERT_TOL) inliers.push(i)
      }
      if (!best || inliers.length > best.inliers.length) best = { plane, inliers }
    }
    if (!best || best.inliers.length < 40) break
    // raffinage + re-collecte des inliers sur le plan raffiné
    const refined = refinePlane(pts, best.inliers) ?? best.plane
    const [a, b, c] = refined
    if (Math.hypot(a, b) <= Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)) {
      const inliers = remaining.filter(
        (i) => Math.abs(pts[i][2] - (a * pts[i][0] + b * pts[i][1] + c)) < RANSAC_VERT_TOL,
      )
      if (inliers.length >= 40) best = { plane: refined, inliers }
    }
    pans.push(best)
    const taken = new Set(best.inliers)
    remaining = remaining.filter((i) => !taken.has(i))
  }
  return { pans, leftover: remaining.length }
}

function panMetrics(pts, pan) {
  const [a, b] = pan.plane
  const slope = Math.atan(Math.hypot(a, b))
  const cells = new Set()
  for (const i of pan.inliers) {
    cells.add(`${Math.floor(pts[i][0] / CELL)}:${Math.floor(pts[i][1] / CELL)}`)
  }
  const projected = cells.size * CELL * CELL
  return {
    slopeDeg: (slope * 180) / Math.PI,
    azimutDeg: ((Math.atan2(-b, -a) * 180) / Math.PI + 360) % 360, // exposition de la pente
    projected,
    real: projected / Math.cos(slope),
    n: pan.inliers.length,
  }
}

// --- main -----------------------------------------------------------------------
const t0 = Date.now()
const { ring, props } = await fetchBuilding()
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

  for (const { node } of allNodes) {
    const view = await Copc.loadPointDataView(get, copc, node)
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
      if (pointInRing(x, y, ring) || distToRing(x, y, ring) <= BUFFER_M) {
        pts.push([x, y, gz(i)])
      }
    }
  }
}
console.log(`Points dans la bbox par classe : ${JSON.stringify(classCounts)}`)
console.log(`Points TOIT retenus (classe 6, polygone +${BUFFER_M} m) : ${pts.length} (${(pts.length / emprise).toFixed(1)} pts/m²)`)
if (pts.length < 100) {
  console.log('⚠️ Trop peu de points — abandon.')
  process.exit(1)
}

const { pans, leftover } = segmentPans(pts)
let total = 0
console.log('\nPans détectés :')
for (const pan of pans) {
  const m = panMetrics(pts, pan)
  if (m.projected < MIN_PAN_M2) continue
  total += m.real
  console.log(
    `  pente ${m.slopeDeg.toFixed(1).padStart(5)}° | azimut ${m.azimutDeg.toFixed(0).padStart(3)}° | ` +
      `proj ${m.projected.toFixed(1).padStart(6)} m² | réel ${m.real.toFixed(1).padStart(6)} m² | ${m.n} pts`,
  )
}
console.log(`  (points non affectés à un pan : ${leftover})`)
console.log(`\n=== SURFACE TOITURE MESURÉE : ${total.toFixed(0)} m² ===`)
console.log(`    vs estimation actuelle    : ~${Math.round(estimation / 5) * 5} m²`)
console.log(`    vs emprise au sol         : ${emprise.toFixed(0)} m²`)
console.log(`\n${(bytesFetched / 1024).toFixed(0)} Ko téléchargés · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
