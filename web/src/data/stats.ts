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

/** Décale "now" de n périodes (n < 0 = passé) — navigation ‹ › des stats. */
export function shiftNow(period: Period, n: number, now = new Date()): Date {
  const d = new Date(now)
  if (period === 'jour') d.setDate(d.getDate() + n)
  else if (period === 'semaine') d.setDate(d.getDate() + 7 * n)
  else {
    // setDate(1) D'ABORD : un 31 juillet, « 31 juin » déborde sur le
    // 1er juillet et la « période précédente » redevenait le mois COURANT
    // (évolutions à zéro les jours de bilan — audit).
    d.setDate(1)
    d.setMonth(d.getMonth() + n)
  }
  return d
}

/** Décale "now" pour obtenir la période précédente. */
function previousNow(period: Period, now = new Date()): Date {
  return shiftNow(period, -1, now)
}

/** Clé jour LOCALE — slice(0,10) sur l'ISO donnait le jour UTC : un événement
    à 00 h 30 tombait sur la barre de la veille (bornes de période locales). */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Select paginé : Supabase tronque silencieusement à 1 000 lignes — une
    équipe dépasse 1 000 point_events en une semaine, les stats du manager
    étaient sous-comptées sans aucun signal (audit). */
async function fetchAllRows(
  table: 'point_events' | 'appointments',
  cols: string,
  timeCol: string,
  startISO: string,
  endISO: string,
): Promise<Record<string, unknown>[]> {
  if (!supabase) return []
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .gte(timeCol, startISO)
      .lt(timeCol, endISO)
      // Le tri n'est stable qu'avec un tie-breaker UNIQUE : sans lui, les
      // ex æquo de timeCol changent d'ordre entre pages (lignes dupliquées
      // ou perdues à la frontière des 1 000).
      .order(timeCol)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Record<string, unknown>[]
    all.push(...rows)
    if (rows.length < PAGE) return all
  }
}

export interface CommercialStats {
  commercial_id: string
  portes: number
  absents: number
  rdv_pris: number
  /** RDV de la période déjà ÉCHUS (ou soldés) : dénominateur du taux
      « effectués » — cohorte cohérente (décision chef des ventes, 25/07). */
  rdv_planifies: number
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
  return { commercial_id: id, portes: 0, absents: 0, rdv_pris: 0, rdv_planifies: 0, rdv_effectues: 0, ventes: 0 }
}

async function fetchStatsRange(start: Date, end: Date): Promise<StatsResult> {
  const result: StatsResult = { byCommercial: {}, team: emptyStats('team'), activityByDay: {}, activityByDayBy: {} }
  if (!supabase) return result

  const startISO = start.toISOString()
  const endISO = end.toISOString()

  const [events, appts] = await Promise.all([
    fetchAllRows('point_events', 'author_id, status, occurred_at', 'occurred_at', startISO, endISO),
    fetchAllRows('appointments', 'commercial_id, status, scheduled_at', 'scheduled_at', startISO, endISO),
  ])

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
    if (e.status === 'rdv_pris') bump(e.author_id, 'rdv_pris')
    if (e.status === 'vendu') bump(e.author_id, 'ventes')

    const day = localDayKey(new Date(e.occurred_at))
    result.activityByDay[day] = (result.activityByDay[day] ?? 0) + 1
    if (e.author_id) {
      ;(result.activityByDayBy[e.author_id] ??= {})[day] =
        (result.activityByDayBy[e.author_id]?.[day] ?? 0) + 1
    }
  }

  const now = Date.now()
  for (const ap of appts ?? []) {
    const a = ap as { commercial_id: string | null; status: string; scheduled_at: string }
    // « Planifiés » = RDV de la période déjà échus OU déjà soldés : un RDV
    // de demain encore « à venir » n'est pas un RDV non honoré. Comme les
    // effectués sont un sous-ensemble des échus, le taux reste ≤ 100 %.
    if (Date.parse(a.scheduled_at) <= now || a.status !== 'a_venir') {
      bump(a.commercial_id, 'rdv_planifies')
    }
    if (a.status === 'effectue' || a.status === 'vendu') bump(a.commercial_id, 'rdv_effectues')
  }

  return result
}

export async function fetchStats(period: Period): Promise<StatsResult> {
  const { start, end } = periodRange(period)
  return fetchStatsRange(start, end)
}

/** Stats de la période + période précédente (pour les évolutions) + plage de
    dates. `offset` (≤ 0) décale vers le passé : bilan du lundi matin sur la
    semaine ÉCOULÉE (audit UX B8) — le delta compare toujours à la période
    précédant celle AFFICHÉE. */
export async function fetchStatsComparison(
  period: Period,
  offset = 0,
): Promise<{
  current: StatsResult
  previous: StatsResult
  range: { start: Date; end: Date }
}> {
  const shown = shiftNow(period, offset)
  const range = periodRange(period, shown)
  const prev = periodRange(period, previousNow(period, shown))
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
