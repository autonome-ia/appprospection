// Non-rÃ©gression sur donnÃ©es RÃ‰ELLES : 1 impasse Rosa Floch, Le Relecq-
// Kerhuon â€” la maison de rÃ©fÃ©rence du chef des ventes (facture couvreur :
// 223 mÂ², corps principal). Nuage capturÃ© par tools/lidar-spike/dump.mjs
// (fixture rosa.json, 5 320 points classe 6, survol 12/2024).
// Cette maison a attrapÃ© DEUX bugs de la soudure : faÃ®tage raide (46Â°)
// classÃ© en marche par la mÃ©diane, puis verdict figÃ© sur une chaÃ®ne de
// 3 coins au lieu de toute la frontiÃ¨re.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measureRoof, type Pt, type Ring } from './lidar-core'
import { mainBodyPans, reconstructRoof } from './lidar-recon'

const { ring, pts } = JSON.parse(
  readFileSync(new URL('../../../tools/lidar-spike/rosa.json', import.meta.url), 'utf8'),
) as { ring: Ring; pts: Pt[] }

describe('Rosa Floch (rÃ©el, facture 223 mÂ²)', () => {
  const m = measureRoof(pts, ring)
  const r = reconstructRoof(
    m.pans.map((p) => ({ plane: p.plane, counts: p.counts, zMin: p.zMin, zMax: p.zMax })),
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

  it('mesure totale stable (303 mÂ² Â± 3 %)', () => {
    expect(Math.abs(m.total - 303) / 303).toBeLessThanOrEqual(0.03)
  })

  it('le faÃ®tage raide (46Â°) est soudÃ© : les deux ailes du L forment UN corps', () => {
    // 4 pans inclinÃ©s soudÃ©s entre eux (faÃ®tages + arÃªtiers du L).
    const pitched = m.pans
      .map((p, i) => (p.type !== 'plat' && p.realDedup >= 10 ? i : -1))
      .filter((i) => i >= 0)
    for (const i of pitched) expect(body.has(i)).toBe(true)
  })

  it('la dalle plate (annexe ~58 mÂ²) est EXCLUE du corps', () => {
    for (const [i, p] of m.pans.entries()) {
      if (p.type === 'plat') expect(body.has(i)).toBe(false)
    }
  })

  it('badge Â« la maison Â» â‰ˆ 243 mÂ² (facture 223 : +9 %, annexes exclues)', () => {
    expect(Math.abs(principal - 243)).toBeLessThanOrEqual(8)
  })
})
