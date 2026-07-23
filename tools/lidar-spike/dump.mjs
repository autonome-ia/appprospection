// Capture le nuage de points d'un bâtiment (ring L93 + voisins + points
// classe 6) vers un JSON, pour rejouer le pipeline TS de l'app dans vitest.
// Usage : node dump.mjs <lon> <lat> <sortie.json>
import { writeFileSync } from 'node:fs'
import { Copc } from 'copc'
import proj4 from 'proj4'
import { pointInRing, distToRing } from './lib.mjs'

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2154', [lon, lat])
const fromL93 = (x, y) => proj4('EPSG:2154', 'EPSG:4326', [x, y])

const lon = Number(process.argv[2])
const lat = Number(process.argv[3])
const out = process.argv[4] ?? 'dump.json'
const BUFFER_M = 0.8

const wfs = async (filter, count = 10) => {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:batiment',
    COUNT: String(count),
    outputFormat: 'application/json',
    CQL_FILTER: filter,
  })
  return (await (await fetch(`https://data.geopf.fr/wfs/ows?${params}`)).json()).features ?? []
}
const ringOf = (f) => {
  const g = f.geometry
  const outer = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
  return outer.map(([x, y]) => toL93(x, y))
}

// Même logique que l'app : INTERSECTS, sinon le plus proche <= 10 m.
const hits = await wfs(`INTERSECTS(geometrie,POINT(${lat} ${lon}))`, 1)
const near = await wfs(`DWITHIN(geometrie,POINT(${lat} ${lon}),25,meters)`)
let main = hits[0] ?? null
if (!main) {
  const [px, py] = toL93(lon, lat)
  let bestD = 10
  for (const f of near) {
    const r = ringOf(f)
    const d = pointInRing(px, py, r) ? 0 : distToRing(px, py, r)
    if (d < bestD) {
      bestD = d
      main = f
    }
  }
}
if (!main) throw new Error('aucun bâtiment')
const ring = ringOf(main)
const neighbors = near.filter((f) => f.properties?.cleabs !== main.properties?.cleabs).map(ringOf)
console.log(`bâtiment ${main.properties?.cleabs}, ${neighbors.length} voisins`)

const xs = ring.map((p) => p[0])
const ys = ring.map((p) => p[1])
const bb = {
  minx: Math.min(...xs) - BUFFER_M,
  maxx: Math.max(...xs) + BUFFER_M,
  miny: Math.min(...ys) - BUFFER_M,
  maxy: Math.max(...ys) + BUFFER_M,
}
const [w, s] = fromL93(bb.minx, bb.miny)
const [e, n] = fromL93(bb.maxx, bb.maxy)
const dparams = new URLSearchParams({
  SERVICE: 'WFS',
  VERSION: '2.0.0',
  REQUEST: 'GetFeature',
  TYPENAMES: 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle',
  COUNT: '4',
  SRSNAME: 'CRS:84',
  BBOX: `${w},${s},${e},${n},CRS:84`,
  outputFormat: 'application/json',
})
const dalles = ((await (await fetch(`https://data.geopf.fr/wfs/ows?${dparams}`)).json()).features ?? []).map(
  (f) => f.properties.url,
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const makeGetter = (url) => async (begin, end) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
    if (r.ok || r.status === 206) return new Uint8Array(await r.arrayBuffer())
    if (r.status !== 429 || attempt >= 5) throw new Error(`Range ${r.status}`)
    await sleep(500 * 2 ** attempt)
  }
}
const nodeBounds = (cube, key) => {
  const [d, x, y] = key.split('-').map(Number)
  const size = (cube[3] - cube[0]) / 2 ** d
  return { minx: cube[0] + x * size, miny: cube[1] + y * size, maxx: cube[0] + (x + 1) * size, maxy: cube[1] + (y + 1) * size }
}

const pts = []
for (const url of dalles) {
  const get = makeGetter(url)
  const copc = await Copc.create(get)
  const cube = copc.info.cube
  const nodes = []
  async function walk(page) {
    const { nodes: pageNodes, pages } = await Copc.loadHierarchyPage(get, page)
    for (const [key, node] of Object.entries(pageNodes)) {
      if (!node?.pointCount) continue
      const nb = nodeBounds(cube, key)
      if (nb.maxx < bb.minx || nb.minx > bb.maxx || nb.maxy < bb.miny || nb.miny > bb.maxy) continue
      nodes.push(node)
    }
    for (const [key, subpage] of Object.entries(pages)) {
      if (!subpage) continue
      const nb = nodeBounds(cube, key)
      if (nb.maxx < bb.minx || nb.minx > bb.maxx || nb.maxy < bb.miny || nb.miny > bb.maxy) continue
      await walk(subpage)
    }
  }
  await walk(copc.info.rootHierarchyPage)
  for (const node of nodes) {
    const view = await Copc.loadPointDataView(get, copc, node)
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
      if (neighbors.some((nr) => pointInRing(x, y, nr))) continue
      pts.push([x, y, gz(i)])
    }
  }
}
writeFileSync(out, JSON.stringify({ ring, pts }))
console.log(`${pts.length} points -> ${out}`)
