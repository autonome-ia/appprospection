// Tests du cœur de mesure LiDAR — sur le code SHIPPÉ (lidar-core.ts).
// Reprend les cas historiques du spike (tools/lidar-spike/test-outline.mjs et
// bench.mjs), qui testaient une copie manuelle : ici, plus de dérive possible.
// Le banc synthétique est SEEDÉ (LCG) : vérité mathématique + déterminisme.
import { describe, expect, it } from 'vitest'
import { closeCells, measureRoof, traceOutline, type Pt, type Ring } from './lidar-core'

// --- Traçage de contours (phase 3 : pans dessinés sur l'ortho) -----------------

describe('traceOutline', () => {
  it('L : aire exacte (rectangle 10×6 moins un coin 4×3)', () => {
    const cells = new Set<string>()
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 6; y++) if (!(x >= 6 && y >= 3)) cells.add(`${x}:${y}`)
    const t = traceOutline(cells)
    expect(t).not.toBeNull()
    expect(t!.area).toBeCloseTo(48, 9)
  })

  it('pincement en diagonale : rend la plus grande boucle, sans boucle folle', () => {
    const cells = new Set<string>()
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.add(`${x}:${y}`)
    for (let x = 3; x < 6; x++) for (let y = 3; y < 6; y++) cells.add(`${x}:${y}`)
    const t = traceOutline(cells)
    expect(t).not.toBeNull()
    expect(t!.area).toBeGreaterThanOrEqual(9)
    expect(t!.area).toBeLessThanOrEqual(18)
  })

  it('nappe trouée (ardoise sombre) : la fermeture morphologique restaure l’enveloppe', () => {
    const cells = new Set<string>()
    let seed = 7
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)
    for (let x = 0; x < 12; x++)
      for (let y = 0; y < 8; y++) if (rand() > 0.3) cells.add(`${x}:${y}`)
    const fermee = traceOutline(closeCells(cells, 2))
    expect(fermee).not.toBeNull()
    expect(fermee!.area).toBeGreaterThanOrEqual(0.85 * 96)
    expect(fermee!.area).toBeLessThanOrEqual(96)
  })
})

// --- Banc synthétique (vérité terrain mathématique) -----------------------------

const DENSITY = 12 // pts/m² (observé : 11-13 sur Lesneven)
const NOISE = 0.03 // σ bruit vertical (m)

function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
}
function makeGauss(rand: () => number): () => number {
  return () => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

interface SyntheticRoof {
  pts: Pt[]
  ring: Ring
  exact: number
  label: string
}

/** Toit en croupe (4 pans), débord d, pente uniforme : surface exacte connue. */
function makeHipRoof(L: number, W: number, d: number, pitchDeg: number, seed: number): SyntheticRoof {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const projected = Lr * Wr
  const exact = projected / Math.cos(p)
  const ring: Ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts: Pt[] = []
  const n = Math.round(projected * DENSITY)
  for (let i = 0; i < n; i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    const edge = Math.min(x, Lr - x, y, Wr - y)
    pts.push([x, y, 10 + Math.tan(p) * edge + gauss() * NOISE])
  }
  // cheminée : petit amas 1,2 m au-dessus du pan
  for (let i = 0; i < 25; i++) {
    pts.push([
      Lr / 2 + rand() * 0.8,
      Wr * 0.25 + rand() * 0.8,
      10 + Math.tan(p) * (Wr * 0.25) + 1.2 + gauss() * 0.05,
    ])
  }
  // 2 % de points aberrants (végétation mal classée, bords)
  for (let i = 0; i < n * 0.02; i++) {
    pts.push([rand() * Lr, rand() * Wr, 10 + rand() * 3])
  }
  return { pts, ring, exact, label: `croupe ${L}×${W}, pente ${pitchDeg}°` }
}

/** Toit bâtière (2 pans), faîtage parallèle à l'axe X au milieu de la largeur. */
function makeGableRoof(L: number, W: number, d: number, pitchDeg: number, seed: number): SyntheticRoof {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const projected = Lr * Wr
  const exact = projected / Math.cos(p)
  const ring: Ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts: Pt[] = []
  const n = Math.round(projected * DENSITY)
  for (let i = 0; i < n; i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    pts.push([x, y, 10 + Math.tan(p) * Math.min(y, Wr - y) + gauss() * NOISE])
  }
  return { pts, ring, exact, label: `bâtière ${L}×${W}, pente ${pitchDeg}°` }
}

/** Toit plat (annexe / commerce). */
function makeFlatRoof(L: number, W: number, seed: number): SyntheticRoof {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const ring: Ring = [
    [0, 0],
    [L, 0],
    [L, W],
    [0, W],
    [0, 0],
  ]
  const pts: Pt[] = []
  const n = Math.round(L * W * DENSITY)
  for (let i = 0; i < n; i++) {
    pts.push([rand() * L, rand() * W, 10 + gauss() * NOISE])
  }
  return { pts, ring, exact: L * W, label: `plat ${L}×${W}` }
}

describe('measureRoof (banc synthétique)', () => {
  const cases = [
    makeHipRoof(12, 8, 0.4, 35, 1),
    makeHipRoof(14, 9, 0.4, 45, 2),
    makeGableRoof(11, 7, 0.4, 40, 3),
    makeFlatRoof(20, 15, 4),
  ]

  it.each(cases.map((c) => [c.label, c] as const))('%s : erreur ≤ 5 %%', (_label, c) => {
    const { total } = measureRoof(c.pts, c.ring)
    const errPct = Math.abs((total - c.exact) / c.exact) * 100
    expect(errPct).toBeLessThanOrEqual(5)
  })

  it('déterminisme : mêmes points → même mesure, au centième près', () => {
    const c = cases[0]
    const a = measureRoof(c.pts, c.ring)
    const b = measureRoof(c.pts, c.ring)
    expect(b.total).toBe(a.total)
    expect(b.pans.map((p) => p.realDedup)).toEqual(a.pans.map((p) => p.realDedup))
  })

  it('bâtière : 2 pans dont la pente vaut ~40°', () => {
    const c = makeGableRoof(11, 7, 0.4, 40, 3)
    const m = measureRoof(c.pts, c.ring)
    const pitched = m.pans.filter((p) => p.type !== 'plat')
    expect(pitched.length).toBe(2)
    for (const p of pitched) {
      expect(Math.abs(p.slopeDeg - 40)).toBeLessThanOrEqual(2)
    }
  })

  it('azimut boussole : bâtière faîtage est-ouest → pans exposés sud (180°) et nord (0°)', () => {
    // makeGableRoof : faîtage parallèle à l'axe X (est-ouest) au milieu de la
    // largeur — le pan côté y faible descend vers le sud, l'autre vers le nord.
    const c = makeGableRoof(11, 7, 0.4, 40, 3)
    const m = measureRoof(c.pts, c.ring)
    const azimuts = m.pans
      .filter((p) => p.type !== 'plat')
      .map((p) => p.azimutDeg)
      .sort((a, b) => a - b)
    expect(azimuts.length).toBe(2)
    // écart angulaire au nord (0° modulo 360) et au sud (180°)
    const distNord = Math.min(azimuts[0], 360 - azimuts[0])
    expect(distNord).toBeLessThanOrEqual(5)
    expect(Math.abs(azimuts[1] - 180)).toBeLessThanOrEqual(5)
  })

  it('toit plat : un pan unique typé plat, couverture pleine', () => {
    const c = makeFlatRoof(20, 15, 4)
    const m = measureRoof(c.pts, c.ring)
    expect(m.pans.length).toBe(1)
    expect(m.pans[0].type).toBe('plat')
    expect(m.coverage).toBeGreaterThan(0.9)
  })
})
