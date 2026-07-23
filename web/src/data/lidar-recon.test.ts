// Tests de la reconstruction v3 (pans jointifs ET rectilignes, ancrés sur le
// polygone d'emprise) : silhouette = polygone décalé du débord (netteté),
// faîtages droits partagés, altitudes égales aux soudures, MARCHE détectée
// entre niveaux (annexe basse), déterminisme.
import { describe, expect, it } from 'vitest'
import { distToRing, measureRoof, ringArea, type Pt, type Ring } from './lidar-core'
import {
  mainBodyPans,
  offsetRing,
  reconstructRoof,
  type ReconPan,
  type ReconResult,
} from './lidar-recon'

const DENSITY = 12
const NOISE = 0.03
const OVERHANG = 0.5

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

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

function gable(L: number, W: number, d: number, pitchDeg: number, seed: number) {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const ring = rect(d, d, d + L, d + W)
  const pts: Pt[] = []
  for (let i = 0; i < Math.round(Lr * Wr * DENSITY); i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    pts.push([x, y, 10 + Math.tan(p) * Math.min(y, Wr - y) + gauss() * NOISE])
  }
  return { pts, ring, p }
}

function hip(L: number, W: number, d: number, pitchDeg: number, seed: number) {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const Lr = L + 2 * d
  const Wr = W + 2 * d
  const ring = rect(d, d, d + L, d + W)
  const pts: Pt[] = []
  for (let i = 0; i < Math.round(Lr * Wr * DENSITY); i++) {
    const x = rand() * Lr
    const y = rand() * Wr
    const edge = Math.min(x, Lr - x, y, Wr - y)
    pts.push([x, y, 10 + Math.tan(p) * edge + gauss() * NOISE])
  }
  return { pts, ring, p }
}

/** Maison à deux niveaux : bâtière sur [0,W1], annexe PLATE plus basse derrière. */
function twoLevels(L: number, W1: number, W2: number, pitchDeg: number, seed: number) {
  const rand = makeRand(seed)
  const gauss = makeGauss(rand)
  const p = (pitchDeg * Math.PI) / 180
  const ring = rect(0, 0, L, W1 + W2)
  const pts: Pt[] = []
  for (let i = 0; i < Math.round(L * (W1 + W2) * DENSITY); i++) {
    const x = rand() * L
    const y = rand() * (W1 + W2)
    const z =
      y <= W1 ? 10 + Math.tan(p) * Math.min(y, W1 - y) + gauss() * NOISE : 7.5 + gauss() * NOISE
    pts.push([x, y, z])
  }
  return { pts, ring }
}

function recon(pts: Pt[], ring: Ring) {
  const m = measureRoof(pts, ring)
  const inputs = m.pans.map((p) => ({ plane: p.plane, counts: p.counts }))
  return reconstructRoof(inputs, ring, OVERHANG)
}

const kept = (r: ReconResult | null): ReconPan[] =>
  (r?.pans ?? []).filter((p): p is ReconPan => p !== null)

function pointInRingLocal(px: number, py: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
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

describe('offsetRing', () => {
  it('rectangle : +d de chaque côté, 4 coins nets', () => {
    const off = offsetRing(rect(0, 0, 10, 6), 0.5)
    expect(off).not.toBeNull()
    expect(off!.length).toBe(5)
    expect(ringArea(off!)).toBeCloseTo(11 * 7, 5)
  })

  it('L : aire = aire + périmètre×d + coins (le coin rentrant se compense)', () => {
    // L : rectangle 10×6 moins un coin 4×3.
    const ring: Ring = [
      [0, 0],
      [10, 0],
      [10, 3],
      [6, 3],
      [6, 6],
      [0, 6],
      [0, 0],
    ]
    const off = offsetRing(ring, 0.5)
    expect(off).not.toBeNull()
    // 5 coins sortants (+d²·… net) : l'aire attendue = A + P·d + (4−1)·d²
    // (4 coins sortants ajoutent d² au quart… on vérifie surtout la cohérence).
    const a = ringArea(off!)
    expect(a).toBeGreaterThan(ringArea(ring) + perimeterOf(ring) * 0.5 * 0.9)
    expect(a).toBeLessThan(ringArea(ring) + perimeterOf(ring) * 0.5 + 4 * 0.25 + 0.1)
  })
})

function perimeterOf(ring: Ring): number {
  let p = 0
  for (let i = 0; i < ring.length - 1; i++) {
    p += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
  }
  return p
}

describe('reconstructRoof v3', () => {
  it('bâtière : 2 pans NETS (≤ 8 sommets), couverture = polygone décalé', () => {
    const { pts, ring } = gable(11, 7, 0.4, 40, 3)
    const pans = kept(recon(pts, ring))
    expect(pans.length).toBe(2)
    const outline = offsetRing(ring, OVERHANG)!
    const target = ringArea(outline)
    const total = pans.reduce((s, p) => s + ringArea(p.contour), 0)
    expect(Math.abs(total - target) / target).toBeLessThanOrEqual(0.05)
    for (const p of pans) {
      // La netteté v3 : un pan de bâtière = ~un rectangle (4-8 sommets, pas 30).
      expect(p.contour.length - 1).toBeLessThanOrEqual(8)
    }
  })

  it('bâtière : les gouttières sont SUR le polygone décalé (silhouette exacte)', () => {
    const { pts, ring } = gable(11, 7, 0.4, 40, 3)
    const pans = kept(recon(pts, ring))
    const outline = offsetRing(ring, OVERHANG)!
    // Sommets bas (gouttières/rives) : à ≤ 5 cm du périmètre décalé.
    for (const p of pans) {
      const zMin = Math.min(...p.alts)
      for (let v = 0; v < p.contour.length - 1; v++) {
        if (p.alts[v] < zMin + 0.3) {
          expect(distToRing(p.contour[v][0], p.contour[v][1], outline)).toBeLessThanOrEqual(0.05)
        }
      }
    }
  })

  it('bâtière : faîtage DROIT (1 segment) et partagé, altitudes égales', () => {
    const { pts, ring, p: pitch } = gable(11, 7, 0.4, 40, 3)
    const pans = kept(recon(pts, ring))
    const counts = new Map<string, number>()
    for (const p of pans) for (const k of edgeKeys(p)) counts.set(k, (counts.get(k) ?? 0) + 1)
    const sharedEdges = [...counts.entries()].filter(([, n]) => n === 2)
    expect(sharedEdges.length).toBe(1) // le faîtage, en un seul segment
    // Altitudes identiques des deux côtés de chaque sommet partagé.
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
      if (zs.length >= 2) expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(0.15)
    }
    // Hauteur de comble cohérente (mesurée mur à mur : tan(pente) × W/2).
    const all = pans.flatMap((x) => x.alts)
    const comble = Math.max(...all) - Math.min(...all)
    const expected = Math.tan(pitch) * ((7 + 0.8) / 2 + OVERHANG)
    expect(Math.abs(comble - expected)).toBeLessThanOrEqual(0.6)
  })

  it('croupe : 4 pans nets et jointifs', () => {
    const { pts, ring } = hip(12, 8, 0.4, 35, 1)
    const pans = kept(recon(pts, ring))
    expect(pans.length).toBe(4)
    const outline = offsetRing(ring, OVERHANG)!
    const target = ringArea(outline)
    const total = pans.reduce((s, p) => s + ringArea(p.contour), 0)
    expect(Math.abs(total - target) / target).toBeLessThanOrEqual(0.06)
    for (const p of pans) expect(p.contour.length - 1).toBeLessThanOrEqual(10)
    const counts = new Map<string, number>()
    for (const p of pans) for (const k of edgeKeys(p)) counts.set(k, (counts.get(k) ?? 0) + 1)
    // Faîtage + 4 arêtiers : 5 frontières partagées (chacune en 1 segment).
    const shared = [...counts.values()].filter((n) => n === 2).length
    expect(shared).toBeGreaterThanOrEqual(4)
    expect(shared).toBeLessThanOrEqual(7)
  })

  it('deux niveaux : la frontière bâtière/annexe est une MARCHE (alts distinctes)', () => {
    const { pts, ring } = twoLevels(10, 6, 4, 40, 5)
    const pans = kept(recon(pts, ring))
    expect(pans.length).toBeGreaterThanOrEqual(3) // 2 pans + annexe plate
    // Sur au moins un sommet partagé en XY, l'écart d'altitude reste ≥ 1,5 m
    // (10 vs 7,5) : les plans ne sont PAS soudés à la marche.
    const zByVertex = new Map<string, number[]>()
    for (const pan of pans) {
      for (let i = 0; i < pan.contour.length - 1; i++) {
        const k = `${pan.contour[i][0].toFixed(2)},${pan.contour[i][1].toFixed(2)}`
        const list = zByVertex.get(k) ?? []
        list.push(pan.alts[i])
        zByVertex.set(k, list)
      }
    }
    const stepped = [...zByVertex.values()].filter(
      (zs) => zs.length >= 2 && Math.max(...zs) - Math.min(...zs) >= 1.5,
    )
    expect(stepped.length).toBeGreaterThan(0)
  })

  it('L avec noue : aucun sommet hors silhouette, couverture complète', () => {
    // Toit en L « parfait » : z = hauteur ∝ distance au bord de l'emprise
    // (croupes + noue diagonale au coin rentrant).
    const rand = makeRand(11)
    const gauss = makeGauss(rand)
    const p = (35 * Math.PI) / 180
    const ring: Ring = [
      [0, 0],
      [14, 0],
      [14, 6],
      [8, 6],
      [8, 12],
      [0, 12],
      [0, 0],
    ]
    const pts: Pt[] = []
    let tries = 0
    while (pts.length < Math.round(120 * DENSITY) && tries++ < 100000) {
      const x = rand() * 14
      const y = rand() * 12
      if (!pointInRingLocal(x, y, ring)) continue
      pts.push([x, y, 10 + Math.tan(p) * distToRing(x, y, ring) + gauss() * NOISE])
    }
    const m = measureRoof(pts, ring)
    const r = reconstructRoof(
      m.pans.map((x) => ({ plane: x.plane, counts: x.counts })),
      ring,
      OVERHANG,
    )
    const pans = kept(r)
    expect(pans.length).toBeGreaterThanOrEqual(2)
    const outline = offsetRing(ring, OVERHANG)!
    // Garde v4 : aucune écharde qui déborde de la silhouette.
    for (const pan of pans) {
      for (const [x, y] of pan.contour) {
        if (!pointInRingLocal(x, y, outline)) {
          expect(distToRing(x, y, outline)).toBeLessThanOrEqual(0.25)
        }
      }
    }
    const total = pans.reduce((s, x) => s + ringArea(x.contour), 0)
    const target = ringArea(outline)
    expect(Math.abs(total - target) / target).toBeLessThanOrEqual(0.08)
  })

  it('écharde : une région filiforme est absorbée par son voisin (aire préservée)', () => {
    // Partition artificielle : A et B côte à côte, C = colonne d'1 cellule
    // de large coincée entre les deux (lamelle de sur-segmentation).
    const ring = rect(0, 0, 15, 10)
    const mk = (cx0: number, cx1: number): Map<string, number> => {
      const m = new Map<string, number>()
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = 0; cy <= 19; cy++) m.set(`${cx}:${cy}`, 5)
      }
      return m
    }
    const pans = [
      { plane: [0, 0, 10] as [number, number, number], counts: mk(0, 14) },
      { plane: [0, 0, 10] as [number, number, number], counts: mk(16, 29) },
      { plane: [0, 0, 12] as [number, number, number], counts: mk(15, 15) },
    ]
    const r = reconstructRoof(pans, ring, OVERHANG)
    expect(r).not.toBeNull()
    expect(r!.pans[2]).toBeNull() // l'écharde n'est pas dessinée…
    // …son absorption est tracée (elle rejoint le corps de son absorbeur)…
    expect(r!.absorbed.length).toBe(1)
    expect(r!.absorbed[0][0]).toBe(2)
    const drawn = kept(r)
    const total = drawn.reduce((s, x) => s + ringArea(x.contour), 0)
    const target = ringArea(offsetRing(ring, OVERHANG)!)
    // …et son aire est reprise par les voisins : rien ne manque.
    expect(Math.abs(total - target) / target).toBeLessThanOrEqual(0.05)
  })

  it('bâtière : les 2 pans sont SOUDÉS (welds) — même toit physique', () => {
    const { pts, ring } = gable(11, 7, 0.4, 40, 3)
    const r = recon(pts, ring)
    expect(r!.welds).toContainEqual([0, 1])
  })

  it('bâtière RAIDE (48°, toits bretons) : le faîtage reste soudé', () => {
    // Régression Rosa Floch : la médiane des écarts de plans sur les coins de
    // grille (zigzag ±0,5 m du faîtage) classait les toits pentus en marche —
    // badge à 110 m² au lieu de 219 (le corps ne contenait plus qu'un pan).
    const { pts, ring } = gable(11, 7, 0.4, 48, 7)
    const r = recon(pts, ring)
    expect(r!.welds).toContainEqual([0, 1])
    const m = measureRoof(pts, ring)
    const body = mainBodyPans(
      m.pans.map((p) => p.realDedup),
      m.pans.map((p) => p.type === 'plat'),
      r!.welds,
      r!.absorbed,
    )
    const bodyM2 = m.pans.reduce((s, p, i) => (body.has(i) ? s + p.realDedup : s), 0)
    expect(bodyM2 / m.total).toBeGreaterThanOrEqual(0.95)
  })

  it('deux niveaux : la marche n’est PAS une soudure, la « maison » exclut l’annexe', () => {
    const { pts, ring } = twoLevels(10, 6, 4, 40, 5)
    const m = measureRoof(pts, ring)
    const r = reconstructRoof(
      m.pans.map((x) => ({ plane: x.plane, counts: x.counts })),
      ring,
      OVERHANG,
    )
    expect(r).not.toBeNull()
    const flatIdx = m.pans.findIndex((p) => p.type === 'plat')
    expect(flatIdx).toBeGreaterThanOrEqual(0)
    // L'annexe plate (7,5 m vs murs 10 m) n'est soudée à aucun pan de la bâtière.
    for (const [a, b] of r!.welds) {
      expect(a === flatIdx || b === flatIdx).toBe(false)
    }
    // « La maison » = les pans de la bâtière, sans l'annexe.
    const body = mainBodyPans(
      m.pans.map((p) => p.realDedup),
      m.pans.map((p) => p.type === 'plat'),
      r!.welds,
      r!.absorbed,
    )
    expect(body.has(flatIdx)).toBe(false)
    const bodyM2 = m.pans.reduce((s, p, i) => (body.has(i) ? s + p.realDedup : s), 0)
    const gableM2 = m.pans.reduce((s, p, i) => (i !== flatIdx ? s + p.realDedup : s), 0)
    expect(bodyM2).toBeGreaterThanOrEqual(0.85 * gableM2)
  })

  it('déterminisme : mêmes entrées → même reconstruction', () => {
    const { pts, ring } = hip(12, 8, 0.4, 35, 1)
    const a = recon(pts, ring)
    const b = recon(pts, ring)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
