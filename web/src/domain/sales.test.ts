import { describe, expect, it } from 'vitest'
import {
  commissionOf,
  commissionSum,
  formatEuros,
  formatRate,
  isCounted,
  missingFields,
  objectiveFor,
  periodBounds,
  periodLabel,
  rankSellers,
  shareOf,
  shiftPeriod,
  summarize,
  type Sale,
} from './sales'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'

let n = 0
const sale = (over: Partial<Sale> = {}): Sale => ({
  id: `s${++n}`,
  organization_id: 'org',
  sold_on: '2026-09-15',
  client_name: 'Client',
  address: null,
  note: null,
  origin: 'prospection',
  prestation: 'toiture',
  amount_ht: 10000,
  payment: 'comptant',
  financed_ht: null,
  seller1_id: A,
  seller2_id: null,
  rate1: 0.13,
  rate2: null,
  status: 'active',
  cancelled_at: null,
  point_id: null,
  event_id: null,
  appointment_id: null,
  created_by: A,
  created_at: '2026-09-15T10:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  ...over,
})

describe('état d’une vente', () => {
  it('liste les champs manquants d’une vente « à compléter »', () => {
    expect(missingFields(sale({ amount_ht: null, prestation: null, payment: null, origin: null }))).toEqual([
      'montant',
      'prestation',
      'paiement',
      'origine',
    ])
    expect(missingFields(sale({ payment: 'financement', financed_ht: null }))).toEqual(['montant financé'])
    expect(missingFields(sale())).toEqual([])
  })

  it('une vente annulée ou à compléter ne compte pas', () => {
    expect(isCounted(sale())).toBe(true)
    expect(isCounted(sale({ status: 'annulee' }))).toBe(false)
    expect(isCounted(sale({ amount_ht: null }))).toBe(false)
  })

  it('la vue tableau (sans origine) n’exige pas l’origine', () => {
    const { origin: _o, ...board } = sale()
    void _o
    expect(missingFields(board as Sale)).toEqual([])
  })
})

describe('parts et commissions (D4, D7)', () => {
  it('seul = 1, à deux = 0,5 chacun, étranger = 0', () => {
    expect(shareOf(sale(), A)).toBe(1)
    const duo = sale({ seller2_id: B, rate2: 0.13 })
    expect(shareOf(duo, A)).toBe(0.5)
    expect(shareOf(duo, B)).toBe(0.5)
    expect(shareOf(duo, C)).toBe(0)
  })

  it('commission = montant × part × taux figé', () => {
    expect(commissionOf(sale(), A)).toBeCloseTo(1300)
    const duo = sale({ seller2_id: B, rate2: 0.1 })
    expect(commissionOf(duo, A)).toBeCloseTo(650)
    expect(commissionOf(duo, B)).toBeCloseTo(500)
    expect(commissionOf(sale({ status: 'annulee' }), A)).toBe(0)
    expect(commissionSum([sale(), sale({ prestation: 'gouttiere', amount_ht: 1000, rate1: 0.08 })], A)).toBeCloseTo(1380)
  })
})

describe('summarize (plan §3)', () => {
  const ventes = [
    sale({ amount_ht: 20000, payment: 'financement', financed_ht: 15000 }), // A seul, toiture
    sale({ amount_ht: 10000, seller2_id: B, rate2: 0.13 }), // A + B, toiture
    sale({ amount_ht: 4000, prestation: 'gouttiere', seller1_id: B, rate1: 0.08 }), // B seul
    sale({ amount_ht: 9999, status: 'annulee' }), // annulée : nulle part
    sale({ amount_ht: null }), // à compléter
  ]

  it('vue agence : une toiture vendue à deux reste UNE toiture', () => {
    const s = summarize(ventes)
    expect(s.ca).toBe(34000)
    expect(s.ventes).toBe(3)
    expect(s.toitures).toBe(2)
    expect(s.trc).toBeCloseTo(15000 / 34000)
    expect(s.partToiture).toBeCloseTo(30000 / 34000)
    // 20 000 € dont 15 000 € financés : 15 000 financés, le reste comptant.
    expect(s.caFinancement).toBe(15000)
    expect(s.caComptant).toBe(19000)
    expect(s.aCompleter).toBe(1)
  })

  it('vue vendeur : moitié du CA et 0,5 vente pour une vente à deux', () => {
    const a = summarize(ventes, A)
    expect(a.ca).toBe(25000)
    expect(a.ventes).toBe(1.5)
    expect(a.toitures).toBe(1.5)
    expect(a.trc).toBeCloseTo(15000 / 25000)
    expect(a.panierMoyen).toBeCloseTo(25000 / 1.5)
    const b = summarize(ventes, B)
    expect(b.ca).toBe(9000)
    expect(b.toitures).toBe(0.5)
    expect(b.partToiture).toBeCloseTo(5000 / 9000)
  })

  it('sans vente : ratios nuls plutôt que NaN', () => {
    const s = summarize([], A)
    expect(s.trc).toBeNull()
    expect(s.partToiture).toBeNull()
    expect(s.panierMoyen).toBeNull()
  })
})

describe('périodes (D10)', () => {
  const now = new Date(2026, 8, 25) // jeudi 25 septembre 2026

  it('bornes semaine / mois / trimestre / année', () => {
    expect(periodBounds('semaine', now)).toEqual({ start: '2026-09-21', end: '2026-09-28' })
    expect(periodBounds('mois', now)).toEqual({ start: '2026-09-01', end: '2026-10-01' })
    expect(periodBounds('trimestre', now)).toEqual({ start: '2026-07-01', end: '2026-10-01' })
    expect(periodBounds('annee', now)).toEqual({ start: '2026-01-01', end: '2027-01-01' })
  })

  it('navigation : un 31 ne déborde pas sur le mois courant', () => {
    const d = shiftPeriod('mois', -1, new Date(2026, 6, 31))
    expect(periodBounds('mois', d).start).toBe('2026-06-01')
    expect(periodBounds('trimestre', shiftPeriod('trimestre', -1, now)).start).toBe('2026-04-01')
  })

  it('libellés', () => {
    expect(periodLabel('mois', now)).toBe('Septembre 2026')
    expect(periodLabel('trimestre', now)).toBe('T3 2026')
    expect(periodLabel('semaine', now)).toBe('Semaine du 21 septembre')
  })

  it('objectif mensuel × mois, pas d’objectif à la semaine ni à 0', () => {
    expect(objectiveFor(40000, 'mois')).toBe(40000)
    expect(objectiveFor(40000, 'trimestre')).toBe(120000)
    expect(objectiveFor(40000, 'annee')).toBe(480000)
    expect(objectiveFor(40000, 'semaine')).toBeNull()
    expect(objectiveFor(0, 'mois')).toBeNull()
  })
})

describe('classement et formats', () => {
  it('classe par CA, avec l’avancement vers l’objectif', () => {
    const rows = rankSellers(
      [sale({ amount_ht: 5000 }), sale({ amount_ht: 8000, seller1_id: B, rate1: 0.13 })],
      [
        { id: A, monthly_ca_target: 10000 },
        { id: B, monthly_ca_target: 0 },
      ],
      'mois',
    )
    expect(rows.map((r) => r.id)).toEqual([B, A])
    expect(rows[1].avancement).toBeCloseTo(0.5)
    expect(rows[0].objectif).toBeNull()
  })

  it('euros entiers et taux en pourcentage', () => {
    expect(formatEuros(12450.4).replace(/\s/g, ' ')).toBe('12 450 €')
    expect(formatRate(0.13).replace(/\s/g, ' ')).toBe('13 %')
    expect(formatRate(0.125).replace(/\s/g, ' ')).toBe('12,5 %')
  })
})

describe('graphiques', () => {
  it('découpe l’année en 12 mois et le mois en jours', async () => {
    const { periodBuckets, caByOrigin } = await import('./sales')
    const now = new Date(2026, 8, 25)
    expect(periodBuckets('annee', periodBounds('annee', now))).toHaveLength(12)
    expect(periodBuckets('mois', periodBounds('mois', now))).toHaveLength(30)
    expect(periodBuckets('trimestre', periodBounds('trimestre', now)).map((b) => b.start)).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ])
    const o = caByOrigin([sale({ amount_ht: 1000 }), sale({ amount_ht: 500, origin: 'lead_entrant', seller2_id: B })], A)
    expect(o.prospection).toBe(1000)
    expect(o.lead_entrant).toBe(250)
  })
})
