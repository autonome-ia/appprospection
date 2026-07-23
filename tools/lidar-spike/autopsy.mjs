// ---------------------------------------------------------------------------
// Autopsie : mesure TOUS les bâtiments autour d'un point (le point BAN d'une
// adresse tombe sur la chaussée — l'app mesure là où l'utilisateur tape, pas
// au point BAN). Permet de retrouver QUEL polygone a produit la valeur vue
// dans l'app, et de comparer chaque candidat à la facture du couvreur.
// Usage : node autopsy.mjs <lon> <lat> [rayon_m=30]
// ---------------------------------------------------------------------------
import { Copc } from 'copc'
import proj4 from 'proj4'
import { measureRoof, pointInRing, distToRing } from './lib.mjs'

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2154', [lon, lat])
const fromL93 = (x, y) => proj4('EPSG:2154', 'EPSG:4326', [x, y])

const lon = Number(process.argv[2])
const lat = Number(process.argv[3])
const radius = Number(process.argv[4] ?? 30)
const BUFFER_M = 0.8

const ringOf = (f) => {
  const g = f.geometry
  const outer = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
  return outer.map(([x, y]) => toL93(x, y))
}
const ringArea = (ring) => {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(a) / 2
}

// --- bâtiments candidats ------------------------------------------------------
const params = new URLSearchParams({
  SERVICE: 'WFS',
  VERSION: '2.0.0',
  REQUEST: 'GetFeature',
  TYPENAMES: 'BDTOPO_V3:batiment',
  COUNT: '20',
  outputFormat: 'application/json',
  CQL_FILTER: `DWITHIN(geometrie,POINT(${lat} ${lon}),${radius},meters)`,
})
const feats = (await (await fetch(`https://data.geopf.fr/wfs/ows?${params}`)).json()).features ?? []
console.log(`${feats.length} bâtiments à moins de ${radius} m\n`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function makeGetter(url) {
  return async (begin, end) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      if (r.ok || r.status === 206) return new Uint8Array(await r.arrayBuffer())
      if (r.status !== 429 || attempt >= 5) throw new Error(`Range ${r.status}`)
      await sleep(500 * 2 ** attempt)
    }
  }
}
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
  const [d, x, y] = key.split('-').map(Number)
  const size = (cube[3] - cube[0]) / 2 ** d
  return {
    minx: cube[0] + x * size,
    miny: cube[1] + y * size,
    maxx: cube[0] + (x + 1) * size,
    maxy: cube[1] + (y + 1) * size,
  }
}

async function collectPoints(ring, neighbors) {
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
    const views = await pAll(nodes.map((node) => () => Copc.loadPointDataView(get, copc, node)), 4)
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
        if (neighbors.some((nr) => pointInRing(x, y, nr))) continue
        pts.push([x, y, gz(i)])
      }
    }
  }
  return pts
}

const [px, py] = toL93(lon, lat)
for (const f of feats) {
  const ring = ringOf(f)
  const emprise = ringArea(ring)
  const dist = pointInRing(px, py, ring) ? 0 : distToRing(px, py, ring)
  const cleabs = f.properties?.cleabs
  const neighbors = feats.filter((o) => o.properties?.cleabs !== cleabs).map(ringOf)
  process.stdout.write(
    `— ${cleabs} | à ${dist.toFixed(0)} m | emprise ${emprise.toFixed(0)} m² | hauteur ${f.properties?.hauteur ?? '?'} m | usage ${f.properties?.usage_1 ?? '?'} : `,
  )
  try {
    const pts = await collectPoints(ring, neighbors)
    if (pts.length < 100) {
      console.log(`no_data (${pts.length} pts)`)
      continue
    }
    const { pans, total, totalPrincipal, coverage } = measureRoof(pts, ring)
    const panStr = pans
      .filter((m) => m.realDedup >= 1)
      .map((m) => `${m.type[0]}${m.realDedup.toFixed(0)}@${m.slopeDeg.toFixed(0)}°`)
      .join(' + ')
    console.log(
      `TOTAL ${total.toFixed(0)} m² (principal ${totalPrincipal.toFixed(0)}) | couv ${(coverage * 100).toFixed(0)} % | ${panStr}`,
    )
  } catch (e) {
    console.log(`erreur : ${e.message}`)
  }
  await sleep(1200)
}
