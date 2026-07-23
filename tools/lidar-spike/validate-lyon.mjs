// ---------------------------------------------------------------------------
// Validation croisée — cadastre solaire du Grand Lyon (vérité terrain
// indépendante : surfaces de pans calculées par la Métropole) vs notre
// mesure LiDAR HD. On sélectionne des maisons individuelles à toit pentu
// dans une commune pavillonnaire, et on compare les totaux par bâtiment.
// Usage : node validate-lyon.mjs [commune] [nbMaisons]
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process'

const COMMUNE = process.argv[2] ?? 'Mions'
const N_HOUSES = Number(process.argv[3] ?? 8)

const filter = encodeURIComponent(`commune='${COMMUNE}' AND dest_bati='LOGEMENT'`)
const url =
  'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?service=WFS&version=2.0.0' +
  '&request=GetFeature&typename=metropole-de-lyon:nrj_energie.cadastre_solaire' +
  `&count=1500&outputFormat=application/json&srsName=CRS:84&CQL_FILTER=${filter}`

const r = await fetch(url)
if (!r.ok) throw new Error(`WFS Lyon ${r.status}`)
const feats = (await r.json()).features ?? []
console.log(`${feats.length} pans récupérés (${COMMUNE}, logements)`)

// Groupement par bâtiment (buildingid = parcelle cadastrale + bâtiment)
const buildings = new Map()
for (const f of feats) {
  const id = f.properties.buildingid
  if (!buildings.has(id)) buildings.set(id, [])
  buildings.get(id).push(f)
}

// Sélection : maisons individuelles plausibles — 2 à 6 pans, tous pentus,
// pans significatifs (≥ 8 m²), total 80-300 m². (Les toits terrasse et les
// micro-pans compliquent l'appariement : on valide d'abord le cas nominal.)
const candidates = []
for (const [id, pans] of buildings) {
  if (pans.length < 2 || pans.length > 6) continue
  if (!pans.every((p) => p.properties.typetoit === 'Toit pentu')) continue
  if (!pans.every((p) => p.properties.surface >= 8)) continue
  const total = pans.reduce((s, p) => s + p.properties.surface, 0)
  if (total < 80 || total > 300) continue
  // centroïde du plus grand pan = point sûr à l'intérieur du toit
  const main = pans.reduce((a, b) => (a.properties.surface > b.properties.surface ? a : b))
  const ring = main.geometry.coordinates[0]
  let cx = 0
  let cy = 0
  for (const [x, y] of ring.slice(0, -1)) {
    cx += x
    cy += y
  }
  cx /= ring.length - 1
  cy /= ring.length - 1
  candidates.push({ id, pans: pans.length, total, lon: cx, lat: cy })
}
console.log(`${candidates.length} maisons candidates — test sur ${N_HOUSES}\n`)

const results = []
for (const c of candidates.slice(0, N_HOUSES)) {
  // ménage le rate-limit IGN entre deux maisons
  await new Promise((res) => setTimeout(res, 1500))
  let out = ''
  try {
    out = execFileSync('node', ['spike.mjs', String(c.lon), String(c.lat)], {
      encoding: 'utf8',
      timeout: 120000,
    })
  } catch (e) {
    console.log(`${c.id} : échec spike (${String(e.message).slice(0, 80)})`)
    continue
  }
  const mesure = Number(/SURFACE TOITURE MESURÉE : (\d+)/.exec(out)?.[1])
  const emprise = Number(/emprise au sol\s+: (\d+)/.exec(out)?.[1])
  const estim = Number(/estimation actuelle\s+: ~(\d+)/.exec(out)?.[1])
  if (!mesure) {
    console.log(`${c.id} : sortie illisible / pas de points`)
    continue
  }
  const deltaLidar = ((mesure - c.total) / c.total) * 100
  const deltaEstim = ((estim - c.total) / c.total) * 100
  results.push({ ...c, mesure, emprise, estim, deltaLidar, deltaEstim })
  console.log(
    `${c.id.padEnd(12)} | Lyon ${c.total.toFixed(0).padStart(4)} m² (${c.pans} pans) | ` +
      `LiDAR ${String(mesure).padStart(4)} m² (${deltaLidar >= 0 ? '+' : ''}${deltaLidar.toFixed(1)} %) | ` +
      `estim. app ${String(estim).padStart(4)} m² (${deltaEstim >= 0 ? '+' : ''}${deltaEstim.toFixed(1)} %) | emprise ${emprise} m²`,
  )
}

if (results.length) {
  const absL = results.map((x) => Math.abs(x.deltaLidar)).sort((a, b) => a - b)
  const absE = results.map((x) => Math.abs(x.deltaEstim)).sort((a, b) => a - b)
  const med = (a) => a[Math.floor(a.length / 2)]
  console.log(
    `\nÉcart absolu médian vs cadastre solaire Lyon — LiDAR : ${med(absL).toFixed(1)} % | estimation actuelle : ${med(absE).toFixed(1)} %`,
  )
  console.log('(le cadastre solaire lyonnais est lui-même un modèle : écart ≠ erreur pure de notre mesure)')
}
