// ---------------------------------------------------------------------------
// Gate G1 — suite de tests élargie (SOP docs/sop-mesure-toiture-lidar.md).
// Scénarios vicieux contre le cadastre solaire du Grand Lyon :
//   control   : pavillons pentus classiques (référence)
//   terrasse  : toits plats résidentiels (surface Lyon ≈ vérité directe)
//   mitoyen   : bâtiments accolés (adjacence détectée par bbox des pans)
// + corrélation « végétation » : le taux de points classe 5 dans la bbox
//   explique-t-il les écarts ? (arbres au-dessus du toit)
// Critères G1 : zéro crash, < 6 s et < 10 Mo par maison, médiane par
// scénario ≤ 20 % vs Lyon (bruit de millésime 2012 compris).
// Usage : node g1-suite.mjs
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPans(commune) {
  const filter = encodeURIComponent(`commune='${commune}' AND dest_bati='LOGEMENT'`)
  const url =
    'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?service=WFS&version=2.0.0' +
    '&request=GetFeature&typename=metropole-de-lyon:nrj_energie.cadastre_solaire' +
    `&count=2000&outputFormat=application/json&srsName=CRS:84&CQL_FILTER=${filter}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`WFS Lyon ${r.status}`)
  return (await r.json()).features ?? []
}

function groupByBuilding(feats) {
  const buildings = new Map()
  for (const f of feats) {
    const id = f.properties.buildingid
    if (!buildings.has(id)) buildings.set(id, [])
    buildings.get(id).push(f)
  }
  return buildings
}

function bboxOf(pans) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
  for (const p of pans) {
    for (const [x, y] of p.geometry.coordinates[0]) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x)
      miny = Math.min(miny, y); maxy = Math.max(maxy, y)
    }
  }
  return { minx, miny, maxx, maxy }
}

function centroidOfMain(pans) {
  const main = pans.reduce((a, b) => (a.properties.surface > b.properties.surface ? a : b))
  const ring = main.geometry.coordinates[0]
  let cx = 0, cy = 0
  for (const [x, y] of ring.slice(0, -1)) { cx += x; cy += y }
  return [cx / (ring.length - 1), cy / (ring.length - 1)]
}

const total = (pans) => pans.reduce((s, p) => s + p.properties.surface, 0)

// ~0.9 m en degrés à cette latitude (adjacence de bbox)
const TOUCH = 0.9 / 78000

function selectScenario(buildings, scenario, n) {
  const out = []
  const boxes = scenario === 'mitoyen'
    ? [...buildings.entries()].map(([id, pans]) => ({ id, box: bboxOf(pans) }))
    : null
  for (const [id, pans] of buildings) {
    const t = total(pans)
    if (scenario === 'control') {
      if (pans.length < 2 || pans.length > 6) continue
      if (!pans.every((p) => p.properties.typetoit === 'Toit pentu' && p.properties.surface >= 8)) continue
      if (t < 80 || t > 300) continue
    } else if (scenario === 'terrasse') {
      if (pans.length > 4) continue
      if (!pans.every((p) => p.properties.typetoit === 'Toit terrasse')) continue
      if (t < 50 || t > 250) continue
    } else if (scenario === 'mitoyen') {
      if (t < 50 || t > 300) continue
      if (!pans.every((p) => p.properties.surface >= 6)) continue
      const box = bboxOf(pans)
      const touching = boxes.some(({ id: oid, box: ob }) => {
        if (oid === id) return false
        return (
          box.minx - TOUCH < ob.maxx && box.maxx + TOUCH > ob.minx &&
          box.miny - TOUCH < ob.maxy && box.maxy + TOUCH > ob.miny
        )
      })
      if (!touching) continue
    }
    const [lon, lat] = centroidOfMain(pans)
    out.push({ id, lyon: t, pans: pans.length, lon, lat })
    if (out.length >= n) break
  }
  return out
}

async function runHouse(c) {
  await sleep(1500)
  const t0 = Date.now()
  let out
  try {
    out = execFileSync('node', ['spike.mjs', String(c.lon), String(c.lat)], {
      encoding: 'utf8',
      timeout: 120000,
    })
  } catch (e) {
    return { ...c, crash: String(e.message).split('\n')[0].slice(0, 90) }
  }
  const num = (re) => Number(re.exec(out)?.[1])
  const verdict = /VERDICT: (\w+)/.exec(out)?.[1]
  if (verdict === 'no_data') return { ...c, verdict }
  const mesure = num(/SURFACE TOITURE MESURÉE : (\d+)/)
  if (!mesure) return { ...c, crash: 'sortie illisible' }
  const cls = /Points dans la bbox par classe : (\{[^}]*\})/.exec(out)?.[1]
  const counts = cls ? JSON.parse(cls) : {}
  return {
    ...c,
    verdict,
    mesure,
    principal: num(/dont toit principal\s+: (\d+)/),
    estim: num(/estimation actuelle\s+: ~(\d+)/),
    ko: num(/(\d+) Ko téléchargés/),
    sec: (Date.now() - t0) / 1000,
    vegRatio: (counts['5'] ?? 0) / Math.max(1, counts['6'] ?? 0),
    delta: ((mesure - c.lyon) / c.lyon) * 100,
  }
}

const SCENARIOS = [
  { name: 'control', commune: 'Mions', n: 5 },
  { name: 'terrasse', commune: 'Villeurbanne', n: 5 },
  { name: 'mitoyen', commune: 'Oullins', n: 6 },
  { name: 'control-bis', base: 'control', commune: 'Tassin-la-Demi-Lune', n: 5 },
]

let crashes = 0
let guarded = 0
const all = []
for (const sc of SCENARIOS) {
  const feats = await fetchPans(sc.commune)
  const buildings = groupByBuilding(feats)
  const sel = selectScenario(buildings, sc.base ?? sc.name, sc.n)
  console.log(`\n=== ${sc.name} (${sc.commune}) — ${sel.length} maisons`)
  const deltas = []
  for (const c of sel) {
    const r = await runHouse(c)
    if (r.crash) {
      crashes++
      console.log(`  ${r.id.padEnd(14)} | 💥 ${r.crash}`)
      continue
    }
    if (r.verdict !== 'ok') {
      guarded++
      console.log(
        `  ${r.id.padEnd(14)} | Lyon ${String(r.lyon.toFixed(0)).padStart(4)} m² | ` +
          `🛡️ ${r.verdict}${r.mesure ? ` (aurait dit ${r.mesure} m²)` : ''} → repli estimation`,
      )
      continue
    }
    all.push(r)
    deltas.push(Math.abs(r.delta))
    console.log(
      `  ${r.id.padEnd(14)} | Lyon ${String(r.lyon.toFixed(0)).padStart(4)} m² | ` +
        `LiDAR ${String(r.mesure).padStart(4)} m² (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)} %) | ` +
        `princ. ${String(r.principal).padStart(4)} | veg ${(r.vegRatio * 100).toFixed(0)} % | ` +
        `${r.sec.toFixed(1)} s · ${(r.ko / 1024).toFixed(1)} Mo`,
    )
  }
  if (deltas.length) {
    deltas.sort((a, b) => a - b)
    console.log(`  → écart absolu médian : ${deltas[Math.floor(deltas.length / 2)].toFixed(1)} %`)
  }
}

// Corrélation végétation ↔ écart (toutes maisons confondues)
if (all.length > 4) {
  const highVeg = all.filter((r) => r.vegRatio > 0.3)
  const lowVeg = all.filter((r) => r.vegRatio <= 0.3)
  const med = (arr) => {
    const s = arr.map((r) => Math.abs(r.delta)).sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : NaN
  }
  console.log(
    `\nVégétation : écart médian ${med(highVeg).toFixed(1)} % (veg > 30 %, n=${highVeg.length}) vs ` +
      `${med(lowVeg).toFixed(1)} % (veg ≤ 30 %, n=${lowVeg.length})`,
  )
}
const slow = all.filter((r) => r.sec > 6 || r.ko > 10240)
console.log(
  `\nCrashs : ${crashes} | garde-fous déclenchés (no_data/faible confiance) : ${guarded} | ` +
    `hors budget perfs (> 6 s ou > 10 Mo) : ${slow.length}/${all.length}`,
)
