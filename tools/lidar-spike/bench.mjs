// ---------------------------------------------------------------------------
// Banc d'essai synthétique — vérité terrain MATHÉMATIQUE.
// On génère des nuages de points de toits dont la surface exacte est connue,
// avec le réalisme du LiDAR HD (densité ~12 pts/m², bruit σ=3 cm, cheminée,
// points aberrants), puis on les passe dans le MÊME code de mesure (lib.mjs).
// Usage : node bench.mjs [nbRuns]
// ---------------------------------------------------------------------------
import { measureRoof } from './lib.mjs'

const RUNS = Number(process.argv[2] ?? 5)
const DENSITY = 12 // pts/m² (observé : 11-13 sur Lesneven)
const NOISE = 0.03 // σ bruit vertical (m)

const rand = () => Math.random()
const gauss = () => {
  let u = 0, v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Toit en croupe (4 pans) sur rectangle mur L×W, débord d, pente p uniforme.
 * Hauteur du toit au point (x,y) : tan(p) × distance au bord du rectangle
 * de toiture. Surface réelle EXACTE = aire projetée du toit / cos(p).
 */
function makeHipRoof({ L, W, d, pitchDeg }) {
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const projected = Lr * Wr
  const exact = projected / Math.cos(p)
  // polygone des murs (ce que renvoie la BD TOPO), origine au coin du toit
  const ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts = []
  const n = Math.round(projected * DENSITY)
  for (let i = 0; i < n; i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    const edge = Math.min(x, Lr - x, y, Wr - y)
    const z = 10 + Math.tan(p) * edge + gauss() * NOISE
    pts.push([x, y, z])
  }
  // cheminée : petit amas 1,2 m au-dessus du pan sud
  for (let i = 0; i < 25; i++) {
    pts.push([Lr / 2 + rand() * 0.8, Wr * 0.25 + rand() * 0.8, 10 + Math.tan(p) * (Wr * 0.25) + 1.2 + gauss() * 0.05])
  }
  // 2 % de points aberrants (végétation mal classée, bords)
  for (let i = 0; i < n * 0.02; i++) {
    pts.push([rand() * Lr, rand() * Wr, 10 + rand() * 3])
  }
  return { pts, ring, exact, projected, label: `croupe ${L}×${W} m, pente ${pitchDeg}°, débord ${d} m` }
}

/** Toit bâtière (2 pans), faîtage au milieu de la largeur. */
function makeGableRoof({ L, W, d, pitchDeg }) {
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const projected = Lr * Wr
  const exact = projected / Math.cos(p)
  const ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts = []
  const n = Math.round(projected * DENSITY)
  for (let i = 0; i < n; i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    const z = 10 + Math.tan(p) * Math.min(y, Wr - y) + gauss() * NOISE
    pts.push([x, y, z])
  }
  return { pts, ring, exact, projected, label: `bâtière ${L}×${W} m, pente ${pitchDeg}°, débord ${d} m` }
}

/** Toit plat (annexe / commerce). */
function makeFlatRoof({ L, W }) {
  const projected = L * W
  const ring = [
    [0, 0],
    [L, 0],
    [L, W],
    [0, W],
    [0, 0],
  ]
  const pts = []
  const n = Math.round(projected * DENSITY)
  for (let i = 0; i < n; i++) {
    pts.push([rand() * L, rand() * W, 10 + gauss() * NOISE])
  }
  return { pts, ring, exact: projected, projected, label: `plat ${L}×${W} m` }
}

const cases = [
  makeHipRoof({ L: 12, W: 8, d: 0.4, pitchDeg: 35 }),
  makeHipRoof({ L: 14, W: 9, d: 0.4, pitchDeg: 45 }),
  makeGableRoof({ L: 11, W: 7, d: 0.4, pitchDeg: 40 }),
  makeFlatRoof({ L: 20, W: 15 }),
]

console.log(`Banc synthétique — ${RUNS} runs par cas (densité ${DENSITY} pts/m², bruit ${NOISE * 100} cm)\n`)
let worst = 0
for (const c of cases) {
  const errors = []
  let lastPans = 0
  for (let r = 0; r < RUNS; r++) {
    const { pans, total } = measureRoof(c.pts, c.ring)
    errors.push(((total - c.exact) / c.exact) * 100)
    lastPans = pans.length
  }
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  const spread = Math.max(...errors) - Math.min(...errors)
  worst = Math.max(worst, ...errors.map(Math.abs))
  console.log(
    `${c.label.padEnd(42)} | exact ${c.exact.toFixed(1).padStart(6)} m² | ` +
      `erreur moy ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} % (dispersion ${spread.toFixed(1)} pt) | ${lastPans} pans`,
  )
}
console.log(`\nErreur absolue max observée : ${worst.toFixed(1)} % (objectif Gate G0 : ≤ 8 %)`)
