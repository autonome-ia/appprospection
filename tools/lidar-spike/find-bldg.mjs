// Trouve le centroïde (lon/lat) du bâtiment le plus proche d'un point BAN.
// Usage : node find-bldg.mjs <lon> <lat> [rayon_m=40]
const [lon, lat, radius = 40] = process.argv.slice(2).map(Number)
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
const R = Math.PI / 180
const dist2 = (a, b) => {
  const dx = (a[0] - b[0]) * Math.cos(lat * R) * 111320
  const dy = (a[1] - b[1]) * 111320
  return dx * dx + dy * dy
}
const items = feats.map((f) => {
  const outer = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length
  const cy = outer.reduce((s, p) => s + p[1], 0) / outer.length
  return { id: f.properties?.cleabs, c: [cx, cy], d: Math.sqrt(dist2([cx, cy], [lon, lat])), usage: f.properties?.usage_1 }
})
items.sort((a, b) => a.d - b.d)
for (const it of items.slice(0, 5)) console.log(`${it.id} | ${it.c[0].toFixed(6)},${it.c[1].toFixed(6)} | d=${it.d.toFixed(1)}m | ${it.usage}`)
