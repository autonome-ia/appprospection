import { describe, expect, it } from 'vitest'
import { assignTeamColors, colorForCommercial, registerTeamColors, TEAM_PALETTE } from './colors'

const seed = (n: number, colored: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    color: colored[i] ?? null,
    created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }))

describe('assignTeamColors (garde-fou anti-doublon)', () => {
  it('donne une couleur différente à chacun tant que la palette suffit', () => {
    const map = assignTeamColors(seed(TEAM_PALETTE.length))
    expect(new Set(map.values()).size).toBe(TEAM_PALETTE.length)
    for (const c of map.values()) expect(TEAM_PALETTE).toContain(c)
  })

  it('réserve les couleurs choisies et n’en redonne aucune en automatique', () => {
    const chosen = TEAM_PALETTE[3]
    const map = assignTeamColors(seed(12, { 5: chosen }))
    expect(map.get(seed(12)[5].id)).toBe(chosen)
    const autos = [...map.entries()].filter(([id]) => id !== seed(12)[5].id).map(([, c]) => c)
    expect(autos).not.toContain(chosen)
    expect(new Set(map.values()).size).toBe(12)
  })

  it('ne déplace pas les anciens quand un nouveau membre arrive', () => {
    const before = assignTeamColors(seed(6))
    const after = assignTeamColors(seed(7))
    for (const [id, c] of before) expect(after.get(id)).toBe(c)
  })

  it('reste déterministe quel que soit l’ordre de la liste reçue', () => {
    const list = seed(10, { 2: TEAM_PALETTE[0] })
    const a = assignTeamColors(list)
    const b = assignTeamColors([...list].reverse())
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('alimente colorForCommercial, la couleur explicite gardant la priorité', () => {
    const list = seed(3)
    registerTeamColors(list)
    const map = assignTeamColors(list)
    expect(colorForCommercial(list[1].id, null)).toBe(map.get(list[1].id))
    expect(colorForCommercial(list[1].id, '#123456')).toBe('#123456')
  })
})
