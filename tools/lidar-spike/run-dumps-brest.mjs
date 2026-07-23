// Runner séquentiel des dumps LiDAR pour la zone Brest (rate-limit IGN : 1 à la fois, pause 2 s).
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'

const targets = [
  // [lon, lat, fichier, libellé]
  [-4.493147, 48.416985, 'fixtures/etalon-deschard.json', '2 rue Maryan Deschard 29200 Brest (etalon 143 m2)'],
  [-4.494198, 48.414877, 'fixtures/brest-1.json', '25 rue Pierre Corre 29200 Brest (Lambezellec)'],
  [-4.476344, 48.413741, 'fixtures/brest-2.json', '12 rue de Keranfurust 29200 Brest (Lambezellec)'],
  [-4.493442, 48.417052, 'fixtures/brest-3.json', '6 rue Maryan Deschard 29200 Brest'],
  [-4.488689, 48.414349, 'fixtures/brest-4.json', '18 rue de Coetlogon 29200 Brest'],
  // Bande de maisons mitoyennes, rue Anatole France (Saint-Pierre)
  [-4.528822, 48.381392, 'fixtures/brest-5.json', '26 rue Anatole France 29200 Brest (mitoyenne)'],
  [-4.528394, 48.381457, 'fixtures/brest-6.json', '30 rue Anatole France 29200 Brest (mitoyenne)'],
  [-4.528233, 48.381483, 'fixtures/brest-7.json', '32 rue Anatole France 29200 Brest (mitoyenne)'],
  [-4.528099, 48.381504, 'fixtures/brest-8.json', '34 rue Anatole France 29200 Brest (mitoyenne)'],
  [-4.534741, 48.379741, 'fixtures/brest-9.json', '40 rue Victor Eusen 29200 Brest (Saint-Pierre)'],
  [-4.534575, 48.379803, 'fixtures/brest-10.json', '42 rue Victor Eusen 29200 Brest (Saint-Pierre)'],
  [-4.474207, 48.395919, 'fixtures/brest-11.json', '15 rue Kerivin 29200 Brest'],
  [-4.493103, 48.410474, 'fixtures/brest-12.json', '14 rue de Kerelie 29200 Brest'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
for (const [lon, lat, out, label] of targets) {
  console.log(`\n=== ${label} -> ${out}`)
  const r = spawnSync('node', ['dump.mjs', String(lon), String(lat), out], {
    encoding: 'utf8',
    timeout: 180000,
  })
  process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  let n = 0
  if (r.status === 0 && existsSync(out)) {
    try {
      n = JSON.parse(readFileSync(out, 'utf8')).pts.length
    } catch {}
  }
  results.push({ out, label, lon, lat, pts: n, ok: r.status === 0 && n > 300 })
  await sleep(2000)
}
console.log('\n===== BILAN =====')
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.out} pts=${r.pts} ${r.label} [${r.lon},${r.lat}]`)
}
