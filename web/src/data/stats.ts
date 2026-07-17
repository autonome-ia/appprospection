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
    const day = (start.getDay() + 6) % 7 // lundi = premier jour
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

/** Décale "now" pour obtenir la période précédente. */
function previousNow(period: Period, now = new Date()): Date {
  const d = new Date(now)
  if (period === 'jour') d.setDate(d.getDate() - 1)
  else if (period === 'semaine') d.setDate(d.getDate() - 7)
  else d.setMonth(d.getMonth() - 1)
  return d
}

/** Une action récente de l'équipe (feed d'activité de l'Accueil). */
export interface ActivityItem {
  id: string
  status: PointStatus
  occurred_at: string
  author_name: string | null
  client_name: string | null
  address: string | null
}

/** Dernières actions de l'équipe (journal point_events, plus récentes d'abord). */
export async function fetchRecentActivity(limit = 12): Promise<ActivityItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('point_events')
    .select('id, status, occurred_at, author:profiles(full_name), point:points(client_name, address)')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    status: r.status as PointStatus,
    occurred_at: r.occurred_at as string,
    author_name: (r.author as { full_name?: string | null } | null)?.full_name ?? null,
    client_name: (r.point as { client_name?: string | null } | null)?.client_name ?? null,
    address: (r.point as { address?: string | null } | null)?.address ?? null,
  }))
}

// Un "contact" = quelqu'un a répondu (à revoir / RDV pris / vendu).
// (Absent et Impossible = pas de contact.) — définition à valider avec le métier.
const CONTACT_STATUSES: PointStatus[] = ['a_revoir', 'rdv_pris', 'vendu']

export interface CommercialStats {
  commercial_id: string
  portes: number
  absents: number
  contacts: number
  rdv_pris: number
  rdv_effectues: number
  ventes: number
}

export interface StatsResult {
  byCommercial: Record<string, CommercialStats>
  team: CommercialStats
  /** Portes par jour (clé YYYY-MM-DD), équipe. */
  activityByDay: Record<string, number>
  /** Portes par jour et par commercial. */
  activityByDayBy: Record<string, Record<string, number>>
}

function emptyStats(id: string): CommercialStats {
  return { commercial_id: id, portes: 0, absents: 0, contacts: 0, rdv_pris: 0, rdv_effectues: 0, ventes: 0 }
}

async function fetchStatsRange(start: Date, end: Date): Promise<StatsResult> {
  const result: StatsResult = { byCommercial: {}, team: emptyStats('team'), activityByDay: {}, activityByDayBy: {} }
  if (!supabase) return result

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

  const bump = (id: string | null, key: keyof CommercialStats, n = 1) => {
    if (!id) return
    if (!result.byCommercial[id]) result.byCommercial[id] = emptyStats(id)
    ;(result.byCommercial[id][key] as number) += n
    ;(result.team[key] as number) += n
  }

  for (const ev of events ?? []) {
    const e = ev as { author_id: string | null; status: PointStatus; occurred_at: string }
    bump(e.author_id, 'portes')
    if (e.status === 'absent') bump(e.author_id, 'absents')
    if (CONTACT_STATUSES.includes(e.status)) bump(e.author_id, 'contacts')
    if (e.status === 'rdv_pris') bump(e.author_id, 'rdv_pris')
    if (e.status === 'vendu') bump(e.author_id, 'ventes')

    const day = e.occurred_at.slice(0, 10)
    result.activityByDay[day] = (result.activityByDay[day] ?? 0) + 1
    if (e.author_id) {
      ;(result.activityByDayBy[e.author_id] ??= {})[day] =
        (result.activityByDayBy[e.author_id]?.[day] ?? 0) + 1
    }
  }

  for (const ap of appts ?? []) {
    const a = ap as { commercial_id: string | null; status: string }
    if (a.status === 'effectue' || a.status === 'vendu') bump(a.commercial_id, 'rdv_effectues')
  }

  return result
}

export async function fetchStats(period: Period): Promise<StatsResult> {
  const { start, end } = periodRange(period)
  return fetchStatsRange(start, end)
}

/** Stats de la période + période précédente (pour les évolutions) + plage de dates. */
export async function fetchStatsComparison(period: Period): Promise<{
  current: StatsResult
  previous: StatsResult
  range: { start: Date; end: Date }
}> {
  const range = periodRange(period)
  const prev = periodRange(period, previousNow(period))
  const [current, previous] = await Promise.all([
    fetchStatsRange(range.start, range.end),
    fetchStatsRange(prev.start, prev.end),
  ])
  return { current, previous, range }
}

/** Taux (0-1) en évitant la division par zéro. */
export function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}
