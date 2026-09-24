// Sonde RÉSEAU de la mesure LiDAR (sans navigateur, sans compte, ~20-40 s).
// Vérifie le CONTRAT des services externes dont dépend data/lidar.ts, sur une
// maison de référence (18 rue du Retalaire, Lesneven) :
//   1. WFS BD TOPO bâtiment        5. COPC : Range 206 + CORS + en-tête lisible
//   2. WFS métadonnées LiDAR HD     6. COPC : un nœud de points DÉCODÉ (copc 0.0.8)
//   3. WMS-R MNH (x-bil)           7. Taux de requêtes COPC bloquées (sans réponse)
//   4. RNB + BAN-PLUS parcelle
// Pourquoi : le banc vitest rejoue des nuages HORS LIGNE, il ne voit aucune
// panne IGN. Les deux pannes de 09/2026 (couche WFS retirée le 18/09, serveur
// COPC muet le 24/09) auraient été vues ici en une commande.
// Usage : cd tools/lidar-spike && node canary.mjs   (exit 1 = contrat cassé)
import { Copc } from 'copc'
import proj4 from 'proj4'

const REF = { lon: -4.32772, lat: 48.56851, nom: '18 rue du Retalaire, Lesneven' }
const HEADERS_TIMEOUT_MS = 5000
proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2154', [lon, lat])

const results = []
let broken = false
function report(ok, name, detail, { warnOnly = false } = {}) {
  const tag = ok ? 'OK  ' : warnOnly ? 'WARN' : 'KO  '
  if (!ok && !warnOnly) broken = true
  results.push(`${tag} ${name}${detail ? ` : ${detail}` : ''}`)
  console.log(results.at(-1))
}

/** fetch borné sur les en-têtes (un blocage serveur = pas d'en-têtes). */
async function get(url, init = {}, timeout = HEADERS_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  const t0 = Date.now()
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    clearTimeout(t)
    const buf = new Uint8Array(await r.arrayBuffer())
    return { r, buf, ms: Date.now() - t0 }
  } finally {
    clearTimeout(t)
  }
}
/** Même chose avec 3 essais : ce que fait l'app (data/net.ts). */
async function getRetry(url, init = {}, timeout = HEADERS_TIMEOUT_MS) {
  let last
  for (let i = 0; i < 3; i++) {
    try {
      const res = await get(url, init, timeout)
      if (res.r.status !== 429 && res.r.status < 500) return { ...res, attempts: i + 1 }
      last = new Error(`HTTP ${res.r.status}`)
    } catch (e) {
      last = e
    }
  }
  throw last
}
const wfs = (params) =>
  `https://data.geopf.fr/wfs/ows?${new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    outputFormat: 'application/json',
    ...params,
  })}`
const json = (buf) => JSON.parse(new TextDecoder().decode(buf))

console.log(`Sonde LiDAR : ${REF.nom}\n`)
const d = 0.0003
const bbox84 = `${REF.lon - d},${REF.lat - d},${REF.lon + d},${REF.lat + d},CRS:84`

// 1. BD TOPO ------------------------------------------------------------------
let bat = null
try {
  const { buf, ms } = await getRetry(
    wfs({ TYPENAMES: 'BDTOPO_V3:batiment', COUNT: '10', SRSNAME: 'CRS:84', BBOX: bbox84 }),
  )
  const j = json(buf)
  bat = j.features?.find((f) => f.properties?.cleabs) ?? null
  report(Boolean(bat), 'WFS BDTOPO_V3:batiment', bat ? `${j.features.length} bâtiments, ${ms} ms` : 'aucun bâtiment (couche/filtre changé ?)')
} catch (e) {
  report(false, 'WFS BDTOPO_V3:batiment', e.message)
}

// 2. Métadonnées LiDAR HD -> URL du COPC ----------------------------------------
let copcUrl = null
try {
  const { buf, ms } = await getRetry(
    wfs({ TYPENAMES: 'IGNF_LIDAR-HD_METADONNEE:metadata', COUNT: '4', SRSNAME: 'CRS:84', BBOX: bbox84 }),
  )
  const text = new TextDecoder().decode(buf)
  if (/Unknown namespace|ExceptionReport/i.test(text)) throw new Error(text.slice(0, 160))
  const f = JSON.parse(text).features?.find((x) => typeof x.properties?.url_npl === 'string')
  copcUrl = f?.properties.url_npl ?? null
  let acq = null
  try {
    acq = JSON.parse(f?.properties.metadata ?? '{}').date_fin_acquisition ?? null
  } catch {
    /* non bloquant */
  }
  report(Boolean(copcUrl), 'WFS IGNF_LIDAR-HD_METADONNEE:metadata (url_npl)', copcUrl ? `${ms} ms, survol ${acq ?? '?'}` : 'champ url_npl absent')
  if (copcUrl) console.log(`     ${copcUrl}`)
} catch (e) {
  report(false, 'WFS IGNF_LIDAR-HD_METADONNEE:metadata', e.message)
}

// 3. MNH (éclaireur, non bloquant dans l'app) -----------------------------------
try {
  const [x, y] = toL93(REF.lon, REF.lat)
  const w = 40
  const url = `https://data.geopf.fr/wms-r/wms?${new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93',
    STYLES: '',
    CRS: 'EPSG:2154',
    BBOX: `${x - 10},${y - 10},${x + 10},${y + 10}`,
    WIDTH: String(w),
    HEIGHT: String(w),
    FORMAT: 'image/x-bil;bits=32',
  })}`
  const { buf, ms } = await getRetry(url)
  report(buf.byteLength === w * w * 4, 'WMS-R MNH (x-bil)', `${buf.byteLength} o (attendu ${w * w * 4}), ${ms} ms`, { warnOnly: true })
} catch (e) {
  report(false, 'WMS-R MNH (x-bil)', e.message, { warnOnly: true })
}

// 4. RNB + BAN-PLUS (découpage des bandes, non bloquants dans l'app) ------------
if (bat) {
  const rnb = String(bat.properties.identifiants_rnb ?? '').split('/')[0]
  if (rnb) {
    try {
      const { r, buf, ms } = await getRetry(`https://rnb-api.beta.gouv.fr/api/alpha/buildings/${rnb}/`)
      report(r.ok && Boolean(json(buf).shape), 'API RNB (shape)', `${r.status}, ${ms} ms`, { warnOnly: true })
    } catch (e) {
      report(false, 'API RNB', e.message, { warnOnly: true })
    }
  }
  try {
    const { buf, ms } = await getRetry(
      wfs({ TYPENAMES: 'BAN-PLUS:lien_bati_parcelle', COUNT: '5', CQL_FILTER: `id_bat IN ('${bat.properties.cleabs}')` }),
      {},
      12_000, // lent mais vivant (5-8 s), comme dans l'app
    )
    const n = json(buf).features?.length ?? 0
    report(n > 0, 'WFS BAN-PLUS:lien_bati_parcelle', `${n} lien(s), ${ms} ms`, { warnOnly: true })
  } catch (e) {
    report(false, 'WFS BAN-PLUS:lien_bati_parcelle', e.message, { warnOnly: true })
  }
}

// 5-7. COPC ----------------------------------------------------------------------
if (copcUrl) {
  try {
    const { r, buf } = await getRetry(copcUrl, {
      headers: { Range: 'bytes=0-4095', Origin: 'https://appprospection.onrender.com' },
    })
    const magic = new TextDecoder().decode(buf.slice(0, 4))
    const cors = r.headers.get('access-control-allow-origin')
    report(r.status === 206 && magic === 'LASF', 'COPC Range 206 + en-tête LAS', `${r.status}, magic ${magic}`)
    report(cors === '*' || cors === 'https://appprospection.onrender.com', 'COPC CORS', `allow-origin ${cors}`)
  } catch (e) {
    report(false, 'COPC Range', e.message)
  }

  // Décodage réel d'un nœud : le COPC est lisible par la version figée.
  let stalls = 0
  let calls = 0
  const getter = async (begin, end) => {
    for (let i = 0; i < 3; i++) {
      calls++
      try {
        const { r, buf } = await get(copcUrl, { headers: { Range: `bytes=${begin}-${end - 1}` } })
        if (r.status === 206) return buf
        if (r.status !== 429) throw new Error(`HTTP ${r.status}`)
      } catch (e) {
        if (e.name !== 'AbortError') throw e
        stalls++
      }
    }
    throw new Error('3 essais sans réponse')
  }
  try {
    const t0 = Date.now()
    const copc = await Copc.create(getter)
    const { nodes } = await Copc.loadHierarchyPage(getter, copc.info.rootHierarchyPage)
    const [x, y] = toL93(REF.lon, REF.lat)
    const cube = copc.info.cube
    // Nœud le plus profond de la page racine qui contient la maison.
    const key = Object.keys(nodes)
      .filter((k) => nodes[k]?.pointCount)
      .filter((k) => {
        const [dd, i, j] = k.split('-').map(Number)
        const size = (cube[3] - cube[0]) / 2 ** dd
        return x >= cube[0] + i * size && x < cube[0] + (i + 1) * size && y >= cube[1] + j * size && y < cube[1] + (j + 1) * size
      })
      .sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]))[0]
    const view = await Copc.loadPointDataView(getter, copc, nodes[key])
    const gc = view.getter('Classification')
    let bati = 0
    for (let i = 0; i < view.pointCount; i++) if (gc(i) === 6) bati++
    report(bati > 0, 'COPC nœud décodé (copc 0.0.8)', `nœud ${key}, ${view.pointCount} points dont ${bati} bâtiment, ${Date.now() - t0} ms`)
  } catch (e) {
    report(false, 'COPC nœud décodé', e.message)
  }

  // Taux de blocage : 12 lectures de 300 Ko, 4 en parallèle (comme l'app).
  let s = 0
  let n = 0
  const one = async () => {
    const begin = Math.floor(Math.random() * 90_000_000)
    n++
    try {
      await get(copcUrl, { headers: { Range: `bytes=${begin}-${begin + 300_000}` } })
    } catch {
      s++
    }
  }
  for (let round = 0; round < 3; round++) await Promise.all([one(), one(), one(), one()])
  const pct = Math.round((100 * (s + stalls)) / (n + calls))
  report(pct < 10, 'COPC requêtes sans réponse (> 5 s)', `${s + stalls}/${n + calls} (${pct} %) : l'app re-tente, mais au-delà de ~30 % la mesure ralentit fortement`, { warnOnly: true })
}

console.log(`\n${broken ? '✘ CONTRAT CASSÉ : la mesure échouera dans l’app' : '✔ Contrat IGN respecté'}`)
process.exit(broken ? 1 : 0)
