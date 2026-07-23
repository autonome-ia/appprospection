// Driver séquentiel : dumps LiDAR Guipavas (pause 2 s entre chaque, rate-limit IGN).
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const jobs = [
  ['etalon-rouget-isle.json', -4.417805, 48.410181, "9 rue Rouget de l'Isle 29490 Guipavas"],
  ['etalon-danton.json', -4.42061, 48.410709, '90 rue Danton 29490 Guipavas'],
  ['guipavas-1.json', -4.394333, 48.434231, '22 rue Commandant Charcot 29490 Guipavas'],
  ['guipavas-2.json', -4.399628, 48.435714, '5 rue Amiral Troude 29490 Guipavas'],
  ['guipavas-3.json', -4.400378, 48.435085, '30 rue de Paris 29490 Guipavas'],
  ['guipavas-4.json', -4.451235, 48.414316, '14 rue Lamartine 29490 Guipavas'],
  ['guipavas-5.json', -4.447884, 48.414472, '6 rue Alfred de Musset 29490 Guipavas'],
  ['guipavas-6.json', -4.457511, 48.416791, '16 rue Georges Brassens 29490 Guipavas'],
  ['guipavas-7.json', -4.458755, 48.413518, '9 boulevard Chateaubriand 29490 Guipavas'],
  ['guipavas-8.json', -4.45844, 48.41437, '8 boulevard Corneille 29490 Guipavas'],
  ['guipavas-9.json', -4.444387, 48.412479, '3 place Xavier Grall 29490 Guipavas'],
  ['guipavas-10.json', -4.404962, 48.436671, '12 rue Anatole Le Braz 29490 Guipavas'],
  ['guipavas-11.json', -4.389756, 48.434431, '10 rue de Kerivin 29490 Guipavas'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const [name, lon, lat, addr] of jobs) {
  const out = `fixtures/${name}`
  try {
    execFileSync('node', ['dump.mjs', String(lon), String(lat), out], {
      cwd: import.meta.dirname,
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 180_000,
    })
    if (existsSync(`${import.meta.dirname}/${out}`)) {
      const j = JSON.parse(readFileSync(`${import.meta.dirname}/${out}`, 'utf8'))
      const n = j.pts?.length ?? 0
      console.log(`RESULT ${name} | ${n} pts | ${addr}`)
    } else {
      console.log(`RESULT ${name} | NO FILE | ${addr}`)
    }
  } catch (e) {
    console.log(`RESULT ${name} | FAIL ${e.message?.slice(0, 120)} | ${addr}`)
  }
  await sleep(2000)
}
console.log('DONE')
