import { supabase } from '../lib/supabase'
import type { PointStatus } from '../domain/status'

export type Period = 'jour' | 'semaine' | 'mois'

/** Bornes [start, end) de la période, en heure locale. */
export function periodRange(period: Period, now = new Date()): { start: Date; end: Date } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (period === 'jour') {
    end.setDate(end.getDate() + 1)
  } else if (period === 'semaine') {
    // Lundi comme premier jour.
    const day = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - day)
    end.setTime(start.getTime())
    end.setDate(end.getDate() + 7)
  } else {
    start.setDate(1)
    end.setTime(start.getTime())
    end.setMonth(end.getMonth() + 1)
  }
  return { start, end }
}

// Un "contact" = quelqu'un a répondu (à revoir / RDV pris / vendu).
// (Absent et Impossible = pas de contact.) — définitions à valider avec le métier.
const CONTACT_STATUSES: PointStatus[] = ['a_revoir', 'rdv_pris', 'vendu']

export interface CommercialStats {
  commercial_id: string
  portes: number
  contacts: number
  rdv_pris: number
  rdv_effectues: number
  ventes: number
}

export interface StatsResult {
  byCommercial: Record<string, CommercialStats>
  team: CommercialStats
  /** Portes toquées par jour (clé = YYYY-MM-DD) pour la courbe d'activité. */
  activityByDay: Record<string, number>
}

function emptyStats(id: string): CommercialStats {
  return { commercial_id: id, portes: 0, contacts: 0, rdv_pris: 0, rdv_effectues: 0, ventes: 0 }
}

export async function fetchStats(period: Period): Promise<StatsResult> {
  const empty: StatsResult = { byCommercial: {}, team: emptyStats('team'), activityByDay: {} }
  if (!supabase) return empty

  const { start, end } = periodRange(period)
  const startISO = start.toISOString()
  const endISO = end.toISOString()

  const [{ data: events, error: e1 }, { data: appts, error: e2 }] = await Promise.all([
    supabase
      .from('point_events')
      .select('author_id, status, occurred_at')
      .gte('occurred_at', startISO)
      .lt('occurred_at', endISO),
    supabase
      .from('appointments')
      .select('commercial_id, status, scheduled_at')
      .gte('scheduled_at', startISO)
      .lt('scheduled_at', endISO),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const result: StatsResult = { byCommercial: {}, team: emptyStats('team'), activityByDay: {} }

  const bump = (id: string | null, key: keyof CommercialStats, n = 1) => {
    if (!id) return
    if (!result.byCommercial[id]) result.byCommercial[id] = emptyStats(id)
    ;(result.byCommercial[id][key] as number) += n
    ;(result.team[key] as number) += n
  }

  for (const ev of events ?? []) {
    const e = ev as { author_id: string | null; status: PointStatus; occurred_at: string }
    bump(e.author_id, 'portes')
    if (CONTACT_STATUSES.includes(e.status)) bump(e.author_id, 'contacts')
    if (e.status === 'rdv_pris') bump(e.author_id, 'rdv_pris')
    if (e.status === 'vendu') bump(e.author_id, 'ventes')
    const day = e.occurred_at.slice(0, 10)
    result.activityByDay[day] = (result.activityByDay[day] ?? 0) + 1
  }

  for (const ap of appts ?? []) {
    const a = ap as { commercial_id: string | null; status: string }
    if (a.status === 'effectue' || a.status === 'vendu') bump(a.commercial_id, 'rdv_effectues')
  }

  return result
}

/** Taux (0-1) en évitant la division par zéro. */
export function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}
