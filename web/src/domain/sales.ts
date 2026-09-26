/**
 * Numbers (chantier 25/09/2026, docs/plan-numbers.md) : le vocabulaire des
 * ventes et TOUTES les règles de calcul (CA, parts, TRC, commissions,
 * objectifs). Fonctions pures, testées (sales.test.ts) : les écrans ne
 * recalculent jamais rien eux-mêmes.
 */

export type Prestation = 'toiture' | 'facade' | 'isolation' | 'traitement_bois' | 'gouttiere' | 'energie'
export type SaleOrigin = 'prospection' | 'lead_entrant' | 'ancien_client'
export type SalePayment = 'comptant' | 'financement'
export type SaleStatus = 'active' | 'annulee'

export const PRESTATIONS: { value: Prestation; label: string }[] = [
  { value: 'toiture', label: 'Toiture' },
  { value: 'facade', label: 'Façade' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'traitement_bois', label: 'Traitement du bois' },
  { value: 'gouttiere', label: 'Gouttière' },
  { value: 'energie', label: 'Énergie' },
]

export const ORIGINS: { value: SaleOrigin; label: string }[] = [
  { value: 'prospection', label: 'Prospection' },
  { value: 'lead_entrant', label: 'Lead entrant' },
  { value: 'ancien_client', label: 'Ancien client' },
]

export const PAYMENTS: { value: SalePayment; label: string }[] = [
  { value: 'comptant', label: 'Comptant' },
  { value: 'financement', label: 'Financement' },
]

const labelOf = <T extends string>(list: { value: T; label: string }[], v: T | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? ''
export const prestationLabel = (v: Prestation | null | undefined) => labelOf(PRESTATIONS, v)
export const originLabel = (v: SaleOrigin | null | undefined) => labelOf(ORIGINS, v)
export const paymentLabel = (v: SalePayment | null | undefined) => labelOf(PAYMENTS, v)

/** Ligne du tableau de l'agence (vue `sales_board`) : lisible par toute
    l'équipe Numbers, sans client, adresse, note ni taux (D9). */
export interface BoardSale {
  id: string
  sold_on: string // AAAA-MM-JJ
  prestation: Prestation | null
  amount_ht: number | null
  payment: SalePayment | null
  financed_ht: number | null
  seller1_id: string
  seller2_id: string | null
  status: SaleStatus
  created_at: string
}

/** Vente complète (table `sales`) : ses vendeurs et les superviseurs. */
export interface Sale extends BoardSale {
  organization_id: string
  client_name: string | null
  address: string | null
  note: string | null
  origin: SaleOrigin | null
  /** Taux FIGÉS le jour de la vente (0.13 = 13 %), posés par la base. */
  rate1: number | null
  rate2: number | null
  cancelled_at: string | null
  point_id: string | null
  event_id: string | null
  appointment_id: string | null
  created_by: string | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// État d'une vente
// ---------------------------------------------------------------------------

/** Champs manquants d'une vente « à compléter » (D11), dans l'ordre du
    formulaire. Vide = vente complète. */
export function missingFields(s: Partial<Sale> & BoardSale): string[] {
  const out: string[] = []
  if (s.amount_ht == null) out.push('montant')
  if (!s.prestation) out.push('prestation')
  if (!s.payment) out.push('paiement')
  else if (s.payment === 'financement' && s.financed_ht == null) out.push('montant financé')
  // L'origine n'existe que sur la ligne complète (pas dans le tableau).
  if ('origin' in s && !s.origin) out.push('origine')
  return out
}

export const isComplete = (s: Partial<Sale> & BoardSale) => missingFields(s).length === 0

/** Une vente COMPTE (CA, compteurs, commissions) si elle est active et
    complète. Annulée : nulle part (D16) ; à compléter : listée à part. */
export const isCounted = (s: Partial<Sale> & BoardSale) => s.status === 'active' && isComplete(s)

/** Part d'un vendeur : 1 seul, 0,5 à deux, 0 s'il n'est pas vendeur (D4). */
export function shareOf(s: BoardSale, profileId: string): number {
  if (s.seller1_id !== profileId && s.seller2_id !== profileId) return 0
  return s.seller2_id ? 0.5 : 1
}

export const isSellerOf = (s: BoardSale, profileId: string) => shareOf(s, profileId) > 0

/** Taux figé d'un vendeur sur une vente (null si inconnu). */
export function rateOf(s: Sale, profileId: string): number | null {
  if (s.seller1_id === profileId) return s.rate1
  if (s.seller2_id === profileId) return s.rate2
  return null
}

/** Commission d'un vendeur : montant HT × sa part × son taux figé. */
export function commissionOf(s: Sale, profileId: string): number {
  if (!isCounted(s)) return 0
  const rate = rateOf(s, profileId)
  return rate == null ? 0 : (s.amount_ht ?? 0) * shareOf(s, profileId) * Number(rate)
}

/** Commission totale versée sur une vente (vue manager). */
export function commissionTotal(s: Sale): number {
  return commissionOf(s, s.seller1_id) + (s.seller2_id ? commissionOf(s, s.seller2_id) : 0)
}

// ---------------------------------------------------------------------------
// Agrégats (D4, plan §3)
// ---------------------------------------------------------------------------

export interface NumbersSummary {
  /** CA HT (part du vendeur, ou total agence). */
  ca: number
  /** Nombre de ventes (0,5 pour une vente à deux côté vendeur). */
  ventes: number
  /** Nombre de toitures (même règle de part). */
  toitures: number
  /** Montant financé (même règle de part). */
  finance: number
  /** TRC = financé ÷ CA ; null sans CA. */
  trc: number | null
  /** Part du CA venant des toitures ; null sans CA. */
  partToiture: number | null
  panierMoyen: number | null
  caParPrestation: Record<Prestation, number>
  /** Répartition du CA : la part FINANCÉE (montant financé) et le reste,
      payé comptant — une vente de 20 000 € dont 10 000 € financés met
      10 000 € de chaque côté (retour briac 26/09). */
  caComptant: number
  caFinancement: number
  /** Ventes « à compléter » (hors calculs) de la sélection. */
  aCompleter: number
}

const emptyByPrestation = (): Record<Prestation, number> => ({
  toiture: 0,
  facade: 0,
  isolation: 0,
  traitement_bois: 0,
  gouttiere: 0,
  energie: 0,
})

/**
 * Résumé d'un ensemble de ventes. `forProfile` : vue d'UN vendeur (parts à
 * 0,5 pour les ventes à deux) ; absent : vue AGENCE (chaque vente compte
 * une fois — une toiture vendue à deux reste UNE toiture).
 */
export function summarize(sales: (Partial<Sale> & BoardSale)[], forProfile?: string): NumbersSummary {
  const out: NumbersSummary = {
    ca: 0,
    ventes: 0,
    toitures: 0,
    finance: 0,
    trc: null,
    partToiture: null,
    panierMoyen: null,
    caParPrestation: emptyByPrestation(),
    caComptant: 0,
    caFinancement: 0,
    aCompleter: 0,
  }
  for (const s of sales) {
    const part = forProfile ? shareOf(s, forProfile) : 1
    if (part === 0 || s.status !== 'active') continue
    if (!isComplete(s)) {
      out.aCompleter += 1
      continue
    }
    const ca = (s.amount_ht ?? 0) * part
    out.ca += ca
    out.ventes += part
    out.caParPrestation[s.prestation!] += ca
    if (s.prestation === 'toiture') out.toitures += part
    if (s.payment === 'financement') out.finance += (s.financed_ht ?? 0) * part
  }
  out.caFinancement = out.finance
  out.caComptant = out.ca - out.finance
  if (out.ca > 0) {
    out.trc = out.finance / out.ca
    out.partToiture = out.caParPrestation.toiture / out.ca
  }
  if (out.ventes > 0) out.panierMoyen = out.ca / out.ventes
  return out
}

/** Commission d'un vendeur sur un ensemble de ventes (lignes complètes). */
export function commissionSum(sales: Sale[], profileId: string): number {
  return sales.reduce((sum, s) => sum + commissionOf(s, profileId), 0)
}

// ---------------------------------------------------------------------------
// Périodes (D10) : dates « AAAA-MM-JJ » locales, bornes [start, end)
// ---------------------------------------------------------------------------

export type NumbersPeriod = 'semaine' | 'mois' | 'trimestre' | 'annee'

export const NUMBERS_PERIODS: { value: NumbersPeriod; label: string }[] = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'annee', label: 'Année' },
]

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function periodBounds(period: NumbersPeriod, now = new Date()): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let end: Date
  if (period === 'semaine') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // lundi
    end = new Date(start)
    end.setDate(end.getDate() + 7)
  } else if (period === 'mois') {
    start.setDate(1)
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  } else if (period === 'trimestre') {
    start.setDate(1)
    start.setMonth(Math.floor(start.getMonth() / 3) * 3)
    end = new Date(start.getFullYear(), start.getMonth() + 3, 1)
  } else {
    start.setMonth(0, 1)
    end = new Date(start.getFullYear() + 1, 0, 1)
  }
  return { start: dayKey(start), end: dayKey(end) }
}

/** Décale « maintenant » de n périodes (navigation ‹ ›). Jour 1 D'ABORD :
    un 31, « le mois précédent » débordait sur le mois courant (même piège
    que shiftNow des Stats). */
export function shiftPeriod(period: NumbersPeriod, n: number, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'semaine') d.setDate(d.getDate() + 7 * n)
  else {
    d.setDate(1)
    d.setMonth(d.getMonth() + n * (period === 'mois' ? 1 : period === 'trimestre' ? 3 : 12))
  }
  return d
}

export const inPeriod = (s: { sold_on: string }, b: { start: string; end: string }) =>
  s.sold_on >= b.start && s.sold_on < b.end

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Libellé de la période : « Septembre 2026 », « T3 2026 », « 2026 »,
    « Semaine du 21 septembre ». */
export function periodLabel(period: NumbersPeriod, now = new Date()): string {
  const { start } = periodBounds(period, now)
  const [y, m, d] = start.split('-').map(Number)
  if (period === 'annee') return String(y)
  if (period === 'trimestre') return `T${Math.floor((m - 1) / 3) + 1} ${y}`
  if (period === 'mois') return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`
  return `Semaine du ${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`
}

/** Objectif de CA d'une période : l'objectif est MENSUEL (D17) → × nombre
    de mois ; pas d'objectif en vue semaine (null). */
export function objectiveFor(monthlyTarget: number, period: NumbersPeriod): number | null {
  if (period === 'semaine' || !(monthlyTarget > 0)) return null
  return monthlyTarget * (period === 'mois' ? 1 : period === 'trimestre' ? 3 : 12)
}

// ---------------------------------------------------------------------------
// Classement de CA
// ---------------------------------------------------------------------------

export interface RankRow {
  id: string
  ca: number
  ventes: number
  objectif: number | null
  /** Avancement vers l'objectif (0..∞), null sans objectif. */
  avancement: number | null
}

/** Classement de CA des vendeurs donnés (déjà filtrés : support, désactivés,
    manager masqué…), du plus gros CA au plus petit. */
export function rankSellers(
  sales: BoardSale[],
  sellers: { id: string; monthly_ca_target: number }[],
  period: NumbersPeriod,
): RankRow[] {
  return sellers
    .map((p) => {
      const s = summarize(sales, p.id)
      const objectif = objectiveFor(p.monthly_ca_target, period)
      return { id: p.id, ca: s.ca, ventes: s.ventes, objectif, avancement: objectif ? s.ca / objectif : null }
    })
    .sort((a, b) => b.ca - a.ca || b.ventes - a.ventes)
}

// ---------------------------------------------------------------------------
// Formats (doctrine typo : chiffres en .tnum)
// ---------------------------------------------------------------------------

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 })
const PCT1 = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

/** « 12 450 € » (espaces insécables fines de fr-FR). */
export const formatEuros = (n: number) => EUR.format(Math.round(n))
/** « 13 % » ; une décimale si besoin (« 12,5 % »). */
export const formatRate = (r: number) => (Math.round(r * 1000) % 10 === 0 ? PCT : PCT1).format(r)
/** « 0,5 » / « 2 » : compteur de ventes à parts. */
export const formatCount = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

// ---------------------------------------------------------------------------
// Graphiques des Stats (retour briac 26/09)
// ---------------------------------------------------------------------------

/** CA par origine (lignes complètes seulement : l'origine n'est pas dans le
    tableau de l'agence). */
export function caByOrigin(sales: Sale[], forProfile?: string): Record<SaleOrigin, number> {
  const out: Record<SaleOrigin, number> = { prospection: 0, lead_entrant: 0, ancien_client: 0 }
  for (const s of sales) {
    const part = forProfile ? shareOf(s, forProfile) : 1
    if (part === 0 || !isCounted(s) || !s.origin) continue
    out[s.origin] += (s.amount_ht ?? 0) * part
  }
  return out
}

export interface Bucket {
  /** Libellé sous la barre (vide = pas de libellé). */
  label: string
  /** Libellé complet (lecture au doigt). */
  title: string
  start: string
  end: string
}

const DAY_INITIALS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** Découpage d'une période pour l'évolution du CA : jours (semaine, mois),
    mois (trimestre, année). */
export function periodBuckets(period: NumbersPeriod, b: { start: string; end: string }): Bucket[] {
  const out: Bucket[] = []
  const [y, m, d] = b.start.split('-').map(Number)
  const cur = new Date(y, m - 1, d)
  const endKey = b.end
  const byMonth = period === 'trimestre' || period === 'annee'
  while (dayKey(cur) < endKey) {
    const start = dayKey(cur)
    const next = byMonth ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1) : new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
    let label: string
    let title: string
    if (byMonth) {
      label = period === 'annee' ? MONTH_INITIALS[cur.getMonth()] : MONTHS[cur.getMonth()].slice(0, 4)
      title = `${MONTHS[cur.getMonth()][0].toUpperCase()}${MONTHS[cur.getMonth()].slice(1)}`
    } else {
      const dom = cur.getDate()
      label = period === 'semaine' ? DAY_INITIALS[cur.getDay()] : dom % 7 === 1 ? String(dom) : ''
      title = `${dom === 1 ? '1er' : dom} ${MONTHS[cur.getMonth()]}`
    }
    out.push({ label, title, start, end: dayKey(next) })
    cur.setTime(next.getTime())
  }
  return out
}

/** CA de chaque tranche (même règle de part que summarize). */
export function caByBucket(rows: BoardSale[], buckets: Bucket[], forProfile?: string): number[] {
  return buckets.map((bk) => summarize(rows.filter((s) => inPeriod(s, bk)), forProfile).ca)
}

// ---------------------------------------------------------------------------
// Pilotage (tour UI/UX du 26/09) : comparer À DATE, rythme, projection
// ---------------------------------------------------------------------------

const parseDay = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400e3)
const addDays = (k: string, n: number) => {
  const d = parseDay(k)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** La période affichée est-elle EN COURS (aujourd'hui dedans) ? */
export const isCurrentPeriod = (b: { start: string; end: string }, today = new Date()) =>
  dayKey(today) >= b.start && dayKey(today) < b.end

/**
 * Bornes de comparaison JUSTES : une période en cours se compare à la même
 * durée écoulée de la période précédente (1-26 août face au 1-26 septembre),
 * jamais à la période précédente entière — sinon chaque début de mois est
 * rouge. Période close : comparaison entière.
 */
export function comparisonBounds(
  cur: { start: string; end: string },
  prev: { start: string; end: string },
  today = new Date(),
): { start: string; end: string; toDate: boolean } {
  if (!isCurrentPeriod(cur, today)) return { ...prev, toDate: false }
  const elapsed = daysBetween(cur.start, dayKey(today)) + 1
  const end = addDays(prev.start, elapsed)
  return { start: prev.start, end: end < prev.end ? end : prev.end, toDate: true }
}

/** « vs 26 août » : la date de fin (incluse) de la comparaison à date. */
export function toDateLabel(b: { end: string }): string {
  const d = parseDay(addDays(b.end, -1))
  return `vs ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]}`
}

export interface Pace {
  /** Part de la période écoulée (0..1), aujourd'hui compris. */
  elapsed: number
  /** CA attendu à ce jour pour tenir l'objectif (objectif × écoulé). */
  expected: number
  /** CA de fin de période au rythme actuel. */
  projection: number
  /** Reste à faire pour atteindre l'objectif (≥ 0). */
  reste: number
  /** Jours ouvrés restants (lundi-vendredi, après aujourd'hui). */
  joursOuvres: number
  /** Écart à l'attendu (> 0 = en avance). */
  ecart: number
}

/** Rythme vers l'objectif. Période close : écoulé = 1, projection = réalisé. */
export function paceOf(ca: number, target: number, b: { start: string; end: string }, today = new Date()): Pace {
  const total = daysBetween(b.start, b.end)
  const current = isCurrentPeriod(b, today)
  const done = current ? daysBetween(b.start, dayKey(today)) + 1 : total
  const elapsed = total > 0 ? Math.min(1, done / total) : 1
  let joursOuvres = 0
  if (current) {
    const d = parseDay(dayKey(today))
    d.setDate(d.getDate() + 1)
    while (dayKey(d) < b.end) {
      const wd = d.getDay()
      if (wd !== 0 && wd !== 6) joursOuvres++
      d.setDate(d.getDate() + 1)
    }
  }
  const expected = target * elapsed
  return {
    elapsed,
    expected,
    projection: elapsed > 0 ? ca / elapsed : ca,
    reste: Math.max(0, target - ca),
    joursOuvres,
    ecart: ca - expected,
  }
}

/** CA CUMULÉ jour par jour sur la période (null après aujourd'hui). */
export function cumulativeByDay(
  rows: BoardSale[],
  b: { start: string; end: string },
  forProfile?: string,
  today = new Date(),
): { days: string[]; values: (number | null)[] } {
  const days: string[] = []
  for (let k = b.start; k < b.end; k = addDays(k, 1)) days.push(k)
  const perDay = new Map<string, number>()
  for (const s of rows) {
    if (s.sold_on < b.start || s.sold_on >= b.end) continue
    const ca = summarize([s], forProfile).ca
    if (ca) perDay.set(s.sold_on, (perDay.get(s.sold_on) ?? 0) + ca)
  }
  const todayKey = dayKey(today)
  let run = 0
  const values = days.map((d) => {
    run += perDay.get(d) ?? 0
    return d > todayKey ? null : run
  })
  return { days, values }
}

/** « 36,5 k » : étiquettes courtes des graphiques, à la française. */
const COMPACT = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
export const formatCompact = (n: number) => COMPACT.format(Math.round(n))

/** Date courte de tableau : « 26/09 ». */
export const formatDayNum = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`
