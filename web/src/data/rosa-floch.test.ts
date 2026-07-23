// Non-régression sur données RÉELLES : 1 impasse Rosa Floch, Le Relecq-
// Kerhuon — la maison de référence du chef des ventes (facture couvreur :
// 223 m², corps principal). Nuage capturé par tools/lidar-spike/dump.mjs
// (fixture rosa.json, 5 320 points classe 6, survol 12/2024).
// Cette maison a attrapé DEUX bugs de la soudure : faîtage raide (46°)
// classé en marche par la médiane, puis verdict figé sur une chaîne de
// 3 coins au lieu de toute la frontière.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measureRoof, type Pt, type Ring } from './lidar-core'
import { mainBodyPans, reconstructRoof } from './lidar-recon'

const { ring, pts } = JSON.parse(
  readFileSync(new URL('../../../tools/lidar-spike/rosa.json', import.meta.url), 'utf8'),
) as { ring: Ring; pts: Pt[] }

describe('Rosa Floch (réel, facture 223 m²)', () => {
  const m = measureRoof(pts, ring)
  const r = reconstructRoof(
    m.pans.map((p) => ({ plane: p.plane, counts: p.counts })),
    ring,
    0.5,
  )
  const body = mainBodyPans(
    m.pans.map((p) => p.realDedup),
    m.pans.map((p) => p.type === 'plat'),
    r?.welds ?? [],
    r?.absorbed ?? [],
  )
  const principal = m.pans.reduce((s, p, i) => (body.has(i) ? s + p.realDedup : s), 0)

  it('mesure totale stable (303 m² ± 3 %)', () => {
    expect(Math.abs(m.total - 303) / 303).toBeLessThanOrEqual(0.03)
  })

  it('le faîtage raide (46°) est soudé : les deux ailes du L forment UN corps', () => {
    // 4 pans inclinés soudés entre eux (faîtages + arêtiers du L).
    const pitched = m.pans
      .map((p, i) => (p.type !== 'plat' && p.realDedup >= 10 ? i : -1))
      .filter((i) => i >= 0)
    for (const i of pitched) expect(body.has(i)).toBe(true)
  })

  it('la dalle plate (annexe ~58 m²) est EXCLUE du corps', () => {
    for (const [i, p] of m.pans.entries()) {
      if (p.type === 'plat') expect(body.has(i)).toBe(false)
    }
  })

  it('badge « la maison » ≈ 243 m² (facture 223 : +9 %, annexes exclues)', () => {
    expect(Math.abs(principal - 243)).toBeLessThanOrEqual(8)
  })
})
