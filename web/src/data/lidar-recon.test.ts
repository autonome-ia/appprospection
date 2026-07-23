// Tests de la reconstruction en pans jointifs (lidar-recon) sur toits
// synthétiques : la partition doit couvrir le toit SANS trou, les frontières
// doivent être partagées à l'identique entre pans voisins (même géométrie,
// même altitude des deux côtés) — c'est tout l'objet du module.
import { describe, expect, it } from 'vitest'
import { measureRoof, ringArea, type Pt, type Ring } from './lidar-core'
import { reconstructRoof, type ReconPan } from './lidar-recon'

const DENSITY = 12
const NOISE = 0.03

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

function gable(L: number, W: number, d: number, pitchDeg: number, seed: number) {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const ring: Ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts: Pt[] = []
  for (let i = 0; i < Math.round(Lr * Wr * DENSITY); i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    pts.push([x, y, 10 + Math.tan(p) * Math.min(y, Wr - y) + gauss() * NOISE])
  }
  return { pts, ring, Lr, Wr, p }
}

function hip(L: number, W: number, d: number, pitchDeg: number, seed: number) {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const ring: Ring = [
    [d, d],
    [d + L, d],
    [d + L, d + W],
    [d, d + W],
    [d, d],
  ]
  const pts: Pt[] = []
  for (let i = 0; i < Math.round(Lr * Wr * DENSITY); i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    const edge = Math.min(x, Lr - x, y, Wr - y)
    pts.push([x, y, 10 + Math.tan(p) * edge + gauss() * NOISE])
  }
  return { pts, ring, Lr, Wr, p }
}

function reconFromSynthetic(pts: Pt[], ring: Ring) {
  const m = measureRoof(pts, ring)
  const inputs = m.pans.map((p) => ({ plane: p.plane, counts: p.counts }))
  return { recon: reconstructRoof(inputs, ring), measure: m }
}

/** Arêtes d'un contour, clé indifférente au sens (jointure entre pans). */
function edgeKeys(pan: ReconPan): string[] {
  const keys: string[] = []
  const r = pan.contour
  for (let i = 0; i < r.length - 1; i++) {
    const a = `${r[i][0].toFixed(2)},${r[i][1].toFixed(2)}`
    const b = `${r[i + 1][0].toFixed(2)},${r[i + 1][1].toFixed(2)}`
    keys.push(a < b ? `${a}|${b}` : `${b}|${a}`)
  }
  return keys
}

describe('reconstructRoof', () => {
  it('bâtière : 2 pans, partition complète (surfaces ≈ emprise du toit)', () => {
    const { pts, ring, Lr, Wr } = gable(11, 7, 0.4, 40, 3)
    const { recon } = reconFromSynthetic(pts, ring)
    expect(recon).not.toBeNull()
    const pans = recon!.filter((p): p is ReconPan => p !== null)
    expect(pans.length).toBe(2)
    const total = pans.reduce((s, p) => s + ringArea(p.contour), 0)
    expect(Math.abs(total - Lr * Wr) / (Lr * Wr)).toBeLessThanOrEqual(0.08)
  })

  it('bâtière : le faîtage est une frontière PARTAGÉE (mêmes arêtes des deux côtés)', () => {
    const { pts, ring, Lr } = gable(11, 7, 0.4, 40, 3)
    const { recon } = reconFromSynthetic(pts, ring)
    const pans = recon!.filter((p): p is ReconPan => p !== null)
    const counts = new Map<string, number>()
    for (const p of pans) for (const k of edgeKeys(p)) counts.set(k, (counts.get(k) ?? 0) + 1)
    // Longueur totale des arêtes présentes dans DEUX pans ≈ longueur du faîtage.
    let shared = 0
    for (const [k, n] of counts) {
      if (n === 2) {
        const [a, b] = k.split('|').map((s) => s.split(',').map(Number))
        shared += Math.hypot(b[0] - a[0], b[1] - a[1])
      }
    }
    expect(shared).toBeGreaterThanOrEqual(0.8 * Lr)
  })

  it('bâtière : altitude identique des deux côtés de chaque sommet partagé', () => {
    const { pts, ring, Wr, p } = gable(11, 7, 0.4, 40, 3)
    const { recon } = reconFromSynthetic(pts, ring)
    const pans = recon!.filter((x): x is ReconPan => x !== null)
    const zByVertex = new Map<string, number[]>()
    for (const pan of pans) {
      for (let i = 0; i < pan.contour.length - 1; i++) {
        const k = `${pan.contour[i][0].toFixed(2)},${pan.contour[i][1].toFixed(2)}`
        const list = zByVertex.get(k) ?? []
        list.push(pan.alts[i])
        zByVertex.set(k, list)
      }
    }
    for (const zs of zByVertex.values()) {
      if (zs.length < 2) continue
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(0.15)
    }
    // Et le comble a la bonne hauteur : ~tan(pente) × demi-largeur.
    const all = pans.flatMap((x) => x.alts)
    const comble = Math.max(...all) - Math.min(...all)
    expect(Math.abs(comble - Math.tan(p) * (Wr / 2))).toBeLessThanOrEqual(0.5)
  })

  it('croupe : 4 pans jointifs qui couvrent le toit', () => {
    const { pts, ring, Lr, Wr } = hip(12, 8, 0.4, 35, 1)
    const { recon } = reconFromSynthetic(pts, ring)
    expect(recon).not.toBeNull()
    const pans = recon!.filter((p): p is ReconPan => p !== null)
    expect(pans.length).toBe(4)
    const total = pans.reduce((s, p) => s + ringArea(p.contour), 0)
    expect(Math.abs(total - Lr * Wr) / (Lr * Wr)).toBeLessThanOrEqual(0.08)
    // Arêtiers + faîtage : il existe des frontières partagées.
    const counts = new Map<string, number>()
    for (const p of pans) for (const k of edgeKeys(p)) counts.set(k, (counts.get(k) ?? 0) + 1)
    expect([...counts.values()].filter((n) => n === 2).length).toBeGreaterThan(0)
  })

  it('déterminisme : mêmes entrées → même reconstruction', () => {
    const { pts, ring } = hip(12, 8, 0.4, 35, 1)
    const a = reconFromSynthetic(pts, ring).recon
    const b = reconFromSynthetic(pts, ring).recon
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
