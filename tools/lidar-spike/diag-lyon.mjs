// Diagnostic d'un bâtiment du cadastre solaire Lyon : pente implicite de
// leurs pans (surface annoncée vs aire projetée de leurs polygones) et
// comparaison avec l'emprise BD TOPO. Usage : node diag-lyon.mjs <buildingid>
import proj4 from 'proj4'

proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const toL93 = ([x, y]) => proj4('EPSG:4326', 'EPSG:2154', [x, y])

const id = process.argv[2] ?? '69283ZH127'
const filter = encodeURIComponent(`buildingid='${id}'`)
const url =
  'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?service=WFS&version=2.0.0' +
  '&request=GetFeature&typename=metropole-de-lyon:nrj_energie.cadastre_solaire' +
  `&count=20&outputFormat=application/json&srsName=CRS:84&CQL_FILTER=${filter}`
const feats = (await (await fetch(url)).json()).features ?? []

function ringArea(ringL93) {
  let a = 0
  for (let i = 0; i < ringL93.length - 1; i++) {
    a += ringL93[i][0] * ringL93[i + 1][1] - ringL93[i + 1][0] * ringL93[i][1]
  }
  return Math.abs(a) / 2
}

let totalSurf = 0
let totalProj = 0
console.log(`Bâtiment ${id} — pans du cadastre solaire Lyon :`)
for (const f of feats) {
  const p = f.properties
  const proj = ringArea(f.geometry.coordinates[0].map(toL93))
  const ratio = p.surface / proj
  const slope = ratio >= 1 ? (Math.acos(1 / ratio) * 180) / Math.PI : NaN
  totalSurf += p.surface
  totalProj += proj
  console.log(
    `  ${p.surfid} | ${p.typetoit} | annoncé ${p.surface.toFixed(1).padStart(6)} m² | ` +
      `polygone projeté ${proj.toFixed(1).padStart(6)} m² | pente implicite ${isNaN(slope) ? ' — ' : slope.toFixed(0) + '°'} | orient. ${p.orientatio}°`,
  )
}
console.log(
  `TOTAL annoncé ${totalSurf.toFixed(0)} m² | total projeté ${totalProj.toFixed(0)} m² | ratio ${(totalSurf / totalProj).toFixed(2)}`,
)
const main = feats.reduce((a, b) => (a.properties.surface > b.properties.surface ? a : b))
const ring = main.geometry.coordinates[0]
let cx = 0
let cy = 0
for (const [x, y] of ring.slice(0, -1)) {
  cx += x
  cy += y
}
console.log(`centroïde du pan principal : ${cx / (ring.length - 1)} ${cy / (ring.length - 1)}`)
