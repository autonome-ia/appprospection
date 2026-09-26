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
  /** TOUTES les portes toquées (travail fait) : classement, Accueil, graphe,
      ligne d'en-tête, « Points posés ». */
  portes: number
  /** Base du TUNNEL (retour Alexis 21/09/2026) : portes SANS les « hors
      cible » ni les maisons déjà clientes (`ancien_client`) — à qui on ne
      peut rien vendre. Le tunnel garde le libellé « Portes » (choix briac),
      une mention sous le tunnel explique l'écart avec l'en-tête. */
  prospects: number
  absents: number
  rdv_pris: number
  /** RDV de la période déjà ÉCHUS (ou soldés) : dénominateur du taux
      « effectués » — cohorte cohérente (décision chef des ventes, 25/07). */
  rdv_planifies: number
  rdv_effectues: number
  ventes: number
  /** Poses par statut sur la période (section « Points posés », 29/07) —
      la somme des valeurs = `portes`. */
  parStatut: Partial<Record<PointStatus, number>>
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
  return { commercial_id: id, portes: 0, prospects: 0, absents: 0, rdv_pris: 0, rdv_planifies: 0, rdv_effectues: 0, ventes: 0, parStatut: {} }
}

/** Profils support (db/0022 — dev/test) : leur activité ne compte dans AUCUN
    agrégat. Cache 5 min (le drapeau change une fois par an, en SQL). Colonne
    absente (migration pas passée) ou erreur → personne n'est support.
    NB : le manager masqué au classement (db/0023) COMPTE dans les totaux —
    seule sa ligne est filtrée, côté écran (StatsScreen). */
let supportCache: { at: number; ids: Set<string> } | null = null
async function fetchSupportIds(): Promise<Set<string>> {
  if (!supabase) return new Set()
  if (supportCache && Date.now() - supportCache.at < 5 * 60_000) return supportCache.ids
  const { data, error } = await supabase.from('profiles').select('id').eq('is_support', true)
  if (error) return new Set()
  const ids = new Set((data ?? []).map((r) => r.id as string))
  supportCache = { at: Date.now(), ids }
  return ids
}

/**
 * Ventes du tunnel lues dans NUMBERS (26/09, décision briac, option A) :
 * une vente à deux compte 0,5 à chaque vendeur (1 pour l'équipe), comme dans
 * Numbers — un seul chiffre partout. Seules les ventes d'origine
 * « Prospection » (ou pas encore renseignée : un « Vendu » à compléter)
 * comptent : le tunnel reste celui du porte-à-porte ; les leads entrants et
 * anciens clients vivent dans Numbers. Les ventes annulées sortent.
 * `linkedEvents` : les « Vendu » du journal qui ont une vente Numbers — ils
 * comptent par la vente ; les AUTRES (historique d'avant Numbers, jamais
 * importé) gardent leur 1 pour leur auteur : ni trou, ni doublon.
 * null = agence sans Numbers, vue sans origin/event_id (db/0033 pas passée)
 * ou erreur : l'appelant garde le comptage par le journal seul.
 */
async function fetchNumbersSales(
  start: Date,
  end: Date,
): Promise<{ sales: { seller1_id: string; seller2_id: string | null }[]; linkedEvents: Set<string> } | null> {
  if (!supabase) return null
  const org = await supabase.from('organizations').select('numbers_enabled').maybeSingle()
  if (org.error || !(org.data as { numbers_enabled?: boolean } | null)?.numbers_enabled) return null
  const [inRange, linked] = await Promise.all([
    supabase
      .from('sales_board')
      .select('seller1_id, seller2_id, status, origin')
      .gte('sold_on', localDayKey(start))
      .lt('sold_on', localDayKey(end))
      .range(0, 9999),
    // Toutes périodes : une vente dont la date a été corrigée hors de la
    // plage garde son événement « lié » (il ne doit pas recompter ici).
    supabase.from('sales_board').select('event_id').not('event_id', 'is', null).range(0, 49999),
  ])
  if (inRange.error || linked.error) {
    console.warn('Ventes Numbers indisponibles pour les Stats (db/0033 ?) :', (inRange.error ?? linked.error)!.message)
    return null
  }
  return {
    sales: (inRange.data ?? []).filter(
      (x) => x.status === 'active' && (x.origin == null || x.origin === 'prospection'),
    ) as { seller1_id: string; seller2_id: string | null }[],
    linkedEvents: new Set((linked.data ?? []).map((x) => x.event_id as string)),
  }
}

/** Stats de prospection sur une plage libre (Numbers : le lien portes · RDV
    · ventes du détail d'un commercial, périodes trimestre et année). */
export async function fetchStatsRange(start: Date, end: Date): Promise<StatsResult> {
  const result: StatsResult = { byCommercial: {}, team: emptyStats('team'), activityByDay: {}, activityByDayBy: {} }
  if (!supabase) return result

  const startISO = start.toISOString()
  const endISO = end.toISOString()

  const [support, events, appts, numbersSales] = await Promise.all([
    fetchSupportIds(),
    fetchAllRows('point_events', 'id, author_id, status, occurred_at', 'occurred_at', startISO, endISO),
    // `kind` : les TÂCHES d'agenda (db/0016) ne comptent dans aucun taux —
    // repli sans la colonne si la migration n'est pas passée (tout est RDV).
    fetchAllRows('appointments', 'commercial_id, status, scheduled_at, kind', 'scheduled_at', startISO, endISO).catch(
      (e: Error) => {
        if (!(/kind/.test(e.message) && /column|schema/i.test(e.message))) throw e
        console.warn('Colonne kind absente — exécuter db/0016_appointment_kind.sql')
        return fetchAllRows('appointments', 'commercial_id, status, scheduled_at', 'scheduled_at', startISO, endISO)
      },
    ),
    fetchNumbersSales(start, end).catch(() => null),
  ])

  const bump = (id: string | null, key: keyof CommercialStats, n = 1) => {
    if (!id) return
    if (!result.byCommercial[id]) result.byCommercial[id] = emptyStats(id)
    ;(result.byCommercial[id][key] as number) += n
    ;(result.team[key] as number) += n
  }

  // Répartition par statut (mêmes règles d'attribution que `portes`).
  const bumpStatut = (id: string | null, status: PointStatus) => {
    if (!id) return
    if (!result.byCommercial[id]) result.byCommercial[id] = emptyStats(id)
    const mine = result.byCommercial[id].parStatut
    mine[status] = (mine[status] ?? 0) + 1
    result.team.parStatut[status] = (result.team.parStatut[status] ?? 0) + 1
  }

  for (const ev of events ?? []) {
    const e = ev as { id: string; author_id: string | null; status: PointStatus; occurred_at: string }
    // L'activité d'un profil support (tests) ne compte nulle part.
    if (e.author_id && support.has(e.author_id)) continue
    bump(e.author_id, 'portes')
    // Hors cible et client existant : une porte (travail), pas un prospect
    // (aucune vente possible) — ils sortent de la base du tunnel.
    if (e.status !== 'hors_cible' && e.status !== 'ancien_client') bump(e.author_id, 'prospects')
    bumpStatut(e.author_id, e.status)
    if (e.status === 'absent') bump(e.author_id, 'absents')
    if (e.status === 'rdv_pris') bump(e.author_id, 'rdv_pris')
    // Ventes : un « Vendu » lié à une vente Numbers compte PAR LA VENTE (plus
    // bas, avec les parts) ; sans vente liée (historique, agence sans
    // Numbers), il compte 1 pour son auteur, comme avant.
    if (e.status === 'vendu' && !numbersSales?.linkedEvents.has(e.id)) bump(e.author_id, 'ventes')

    const day = localDayKey(new Date(e.occurred_at))
    result.activityByDay[day] = (result.activityByDay[day] ?? 0) + 1
    if (e.author_id) {
      ;(result.activityByDayBy[e.author_id] ??= {})[day] =
        (result.activityByDayBy[e.author_id]?.[day] ?? 0) + 1
    }
  }

  // Ventes Numbers : 1 vendeur = 1, deux vendeurs = 0,5 chacun (l'équipe
  // additionne les parts : 1 par vente). Comptes support exclus.
  for (const s of numbersSales?.sales ?? []) {
    const sellers = [s.seller1_id, s.seller2_id].filter((x): x is string => !!x)
    const part = sellers.length > 1 ? 0.5 : 1
    for (const id of sellers) if (!support.has(id)) bump(id, 'ventes', part)
  }

  const now = Date.now()
  for (const ap of appts ?? []) {
    const a = ap as { commercial_id: string | null; status: string; scheduled_at: string; kind?: string }
    if (a.kind === 'tache') continue // tâche d'agenda : hors tunnel
    if (a.commercial_id && support.has(a.commercial_id)) continue // RDV de test
    // Un RDV ANNULÉ n'est pas un RDV raté (décision briac 29/07) : il sort
    // des deux compteurs — il sera replanifié (et compté à sa vraie date).
    if (a.status === 'annule') continue
    // « Planifiés » = RDV de la période déjà échus OU déjà soldés : un RDV
    // de demain encore « à venir » n'est pas un RDV non honoré. Comme les
    // effectués sont un sous-ensemble des échus, le taux reste ≤ 100 %.
    if (Date.parse(a.scheduled_at) <= now || a.status !== 'a_venir') {
      bump(a.commercial_id, 'rdv_planifies')
    }
    // « Effectués » = RDV TENUS : en attente (ex-Effectué), vendus, refusés
    // (un refus est un RDV qui a eu lieu — refonte des issues 29/07).
    if (a.status === 'effectue' || a.status === 'vendu' || a.status === 'refus')
      bump(a.commercial_id, 'rdv_effectues')
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
