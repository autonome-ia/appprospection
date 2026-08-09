import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, MapPin, Minus, Pencil, Plus } from 'lucide-react'
import {
  fetchStatsComparison,
  periodRange,
  ratio,
  shiftNow,
  type Period,
  type CommercialStats,
  type StatsResult,
} from '../data/stats'
import { fetchOrgProfiles, updateWeeklyTarget, type OrgProfile } from '../data/profiles'
import { colorForCommercial } from '../domain/colors'
import { CLIENT_STATUSES, DISPLAY_STATUSES, isClientStatus } from '../domain/status'
import { markerDataUrl } from '../config/markers'
import { isSupervisorRole, type Profile } from '../domain/types'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'jour', label: 'Jour' },
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
]

const pct = (r: number) => `${Math.round(r * 100)}%`
const pct1 = (r: number) => `${(r * 100).toFixed(1)}%`
const EMPTY: CommercialStats = {
  commercial_id: '',
  portes: 0,
  absents: 0,
  rdv_pris: 0,
  rdv_planifies: 0,
  rdv_effectues: 0,
  ventes: 0,
  parStatut: {},
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function daysOf(start: Date, end: Date): string[] {
  const out: string[] = []
  const d = new Date(start)
  while (d < end) {
    out.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

// Delta du chiffre héros : une phrase lisible, AFFICHÉE SEULEMENT quand ça
// bouge — « = vs semaine précédente » à 0 vente était du vide (briac 26/07).
const PREV_LABEL: Record<Period, string> = {
  jour: 'vs la veille',
  semaine: 'vs sem. dernière',
  mois: 'vs mois dernier',
}

function HeroDelta({ value, period }: { value: number; period: Period }) {
  if (value === 0) return null
  const up = value > 0
  return (
    <span className={`hero-delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUp size={13} strokeWidth={2.4} /> : <ArrowDown size={13} strokeWidth={2.4} />}
      <span className="tnum">{up ? `+${value}` : `−${Math.abs(value)}`}</span> {PREV_LABEL[period]}
    </span>
  )
}

// Tunnel simplifié (cahier des charges briac, 26/07) : 4 volumes et DEUX
// taux seulement — effectués ÷ pris et ventes ÷ effectués. Les libellés de
// taux, le taux portes→RDV et les « absents » ont été retirés (bruit).
// NB : effectués ÷ pris mélange deux populations (un RDV pris cette semaine
// peut être fait la suivante) — peut dépasser 100 % sur une petite période ;
// taux « métier » assumé, qui remplace la cohorte du 25/07 à l'affichage.
const STEPS: { key: keyof CommercialStats; label: string; from?: keyof CommercialStats }[] = [
  { key: 'portes', label: 'Portes' },
  // Taux de prise AFFICHÉ (retour briac 27/07) mais hors logique de blocage :
  // 5-30 % est structurel au porte-à-porte, il serait rouge en permanence.
  { key: 'rdv_pris', label: 'RDV pris', from: 'portes' },
  { key: 'rdv_effectues', label: 'Effectués', from: 'rdv_pris' },
  { key: 'ventes', label: 'Ventes', from: 'rdv_effectues' },
]

/** Tunnel en barres PROPORTIONNELLES (refonte 26/07) : la largeur = le
    volume. Le plus faible des deux taux passe en rouge (sans texte). */
function Funnel({ s }: { s: CommercialStats }) {
  // Un taux compte dès que son DÉNOMINATEUR existe : 0 vente sur 3 RDV faits
  // est un vrai blocage (l'ancien filtre r > 0 marquait le bon taux en rouge
  // et laissait le 0 % en gris).
  const controllable = [
    { i: 2, r: ratio(s.rdv_effectues, s.rdv_pris), has: s.rdv_pris > 0 },
    { i: 3, r: ratio(s.ventes, s.rdv_effectues), has: s.rdv_effectues > 0 },
  ].filter((x) => x.has)
  const leak = controllable.length ? controllable.reduce((a, b) => (b.r < a.r ? b : a)) : null
  const max = Math.max(1, ...STEPS.map((st) => s[st.key] as number))

  return (
    <div className="funnel3">
      {STEPS.map((step, i) => {
        const v = s[step.key] as number
        return (
          <div key={step.key}>
            {step.from && (
              <div className={`fun-rate ${leak?.i === i ? 'is-leak' : ''}`}>
                <ArrowDown size={11} strokeWidth={2.2} />
                <span className="tnum">{pct(ratio(v, s[step.from] as number))}</span>
              </div>
            )}
            <div className="fun-row">
              <span className="fun-label">{step.label}</span>
              <div className="fun-track">
                <span
                  className={`fun-bar fun-bar-${i}`}
                  style={{ width: `${Math.max(2, (v / max) * 100)}%` }}
                />
                <span className="fun-value tnum">{v}</span>
              </div>
            </div>
          </div>
        )
      })}
      <div className="funnel-foot">
        <span className="funnel-conv">
          {/* LA conversion métier (retour briac 30/07) : ventes ÷ RDV
              effectués — celle qu'on pilote. Ventes ÷ portes mesurait tout
              le tunnel d'un coup, personne ne s'en servait. */}
          Conversion <b className="tnum">{pct1(ratio(s.ventes, s.rdv_effectues))}</b>
        </span>
      </div>
    </div>
  )
}

/** Répartition des poses par statut (demande briac 29/07) : combien de
    chaque type de point sur la période — barres proportionnelles aux
    couleurs SÉMANTIQUES des statuts (couleur = statut, jamais l'accent),
    ordre stable de la palette pour comparer d'une période à l'autre. */
function StatusBreakdown({ s }: { s: CommercialStats }) {
  // Une seule ligne « Client » (fusion 29/07) : somme des deux valeurs —
  // le tunnel garde les VENTES à part (événements `vendu` uniquement).
  const rows = DISPLAY_STATUSES.map((st) => ({
    st,
    v: isClientStatus(st.value)
      ? CLIENT_STATUSES.reduce((n, v) => n + (s.parStatut[v] ?? 0), 0)
      : (s.parStatut[st.value] ?? 0),
  })).filter((r) => r.v > 0)
  const max = Math.max(1, ...rows.map((r) => r.v))
  return (
    <section className="card">
      <p className="eyebrow">Points posés</p>
      {rows.length === 0 ? (
        <p className="screen-empty">Aucun point posé sur la période.</p>
      ) : (
        <div className="statmix">
          {rows.map(({ st, v }) => (
            <div key={st.value} className="statmix-row">
              <span className="statmix-label">
                {/* Le VRAI marqueur, pas un rond plat (retour briac 29/07 —
                    même convention que les chips de statut et les filtres). */}
                <img className="chip-marker" src={markerDataUrl(st.value)} alt="" />
                {st.label}
              </span>
              <div className="statmix-track">
                <span
                  className="statmix-bar"
                  style={{ width: `${Math.max(3, (v / max) * 100)}%`, background: st.color }}
                />
              </div>
              <span className="statmix-value tnum">{v}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Initiales de jours indexées par getDay() (0 = dimanche).
const DAY_INITIALS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function Chart({ daily, days }: { daily: Record<string, number>; days: string[] }) {
  const max = Math.max(1, ...days.map((d) => daily[d] ?? 0))
  const total = days.reduce((s, d) => s + (daily[d] ?? 0), 0)
  // Étiquettes sous les barres (audit UX A26) : barres anonymes, impossible
  // de distinguer mercredi de samedi (le jour vivait dans un title, mort au
  // tactile). Semaine : initiales ; Mois : 1 · 8 · 15 · 22 · 29.
  const isMonth = days.length > 10
  const todayKey = dayKey(new Date())
  const labelOf = (d: string) => {
    const date = new Date(`${d}T00:00:00`)
    if (!isMonth) return DAY_INITIALS[date.getDay()]
    const dom = date.getDate()
    return dom % 7 === 1 ? String(dom) : ''
  }
  return (
    <div className="card">
      {/* Les chiffres, pas que des barres (retour briac 27/07) : total de la
          période dans l'en-tête + valeur au-dessus de chaque barre en vue
          Semaine (en Mois, 31 barres — les chiffres ne rentrent pas). */}
      <div className="chart-head">
        <p className="eyebrow">Portes toquées par jour</p>
        <span className="chart-total tnum">{total}</span>
      </div>
      <div className="chart-bars">
        {days.map((d) => {
          const v = daily[d] ?? 0
          return (
            <div key={d} className="chart-col" title={`${d} : ${v}`}>
              {!isMonth && <span className="chart-val tnum">{v > 0 ? v : ''}</span>}
              <div className="chart-stick">
                <div
                  className={`chart-bar ${d === todayKey ? 'is-today' : ''}`}
                  style={{ height: `${(v / max) * 100}%` }}
                />
              </div>
              <span className="chart-day">{labelOf(d)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StatsScreen({
  profile,
  onShowCommercialOnMap,
}: {
  profile: Profile | null
  /** Pont Stats→Carte (audit UX B5) : « combien » répond enfin à « où ». */
  onShowCommercialOnMap?: (commercialId: string) => void
}) {
  const [period, setPeriod] = useState<Period>('semaine')
  // Décalage de période (≤ 0) : le bilan du lundi matin porte sur la semaine
  // ÉCOULÉE, pas sur la semaine en cours (audit UX B8).
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ current: StatsResult; previous: StatsResult; range: { start: Date; end: Date } } | null>(null)
  const [profiles, setProfiles] = useState<OrgProfile[]>([])
  const [drillId, setDrillId] = useState<string | null>(null)
  // Édition de l'objectif hebdo : stepper inline (audit UX A32) — fini le
  // window.prompt système (clavier libre, saisie invalide avalée).
  const [targetEdit, setTargetEdit] = useState<number | null>(null)

  // Chef des ventes = mêmes VUES que le manager (drill-down, classement,
  // pont carte) ; l'ÉDITION de l'objectif hebdo reste manager strict
  // (verrouillée aussi en base — trigger profiles_guard).
  const isSupervisor = isSupervisorRole(profile?.role)
  const isManager = profile?.role === 'manager'
  const meId = profile?.id ?? null

  const loadProfiles = useCallback(() => {
    fetchOrgProfiles().then(setProfiles).catch((e) => console.error('Profils :', e))
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  // Échec ≠ vraies stats à zéro : sans drapeau persistant, un échec réseau
  // laissait un tableau de bord entièrement à zéro présenté comme réel
  // (contre-audit, bug 27).
  const [loadError, setLoadError] = useState(false)
  // Anti-course : « Mois » (4 requêtes paginées, lent) pouvait résoudre
  // APRÈS « Jour » et s'afficher sous le segment « Jour » (bug 29). Seule la
  // réponse de la dernière demande est appliquée.
  const statsSeq = useRef(0)
  const loadStats = useCallback(() => {
    const seq = ++statsSeq.current
    fetchStatsComparison(period, offset)
      .then((d) => {
        if (seq !== statsSeq.current) return
        setData(d)
        setLoadError(false)
      })
      .catch((e) => {
        console.error('Stats :', e)
        if (seq !== statsSeq.current) return
        setLoadError(true)
      })
  }, [period, offset])

  // Changer de commercial ferme l'éditeur d'objectif.
  useEffect(() => setTargetEdit(null), [drillId])

  useEffect(() => {
    loadStats()
    // iOS restaure la PWA sans recharger la page : sans ça, les bornes de
    // période restaient figées (les chiffres d'HIER sous le segment « Jour »
    // au brief du matin — bug 28).
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadStats()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadStats])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? 'Commercial'
  const targetOf = (id: string) => profiles.find((p) => p.id === id)?.weekly_rdv_target ?? 0

  // Focus : commercial = ses stats ; superviseur = équipe (ou drill-down).
  const focusId = isSupervisor ? drillId : meId
  const cur = data ? (focusId ? data.current.byCommercial[focusId] ?? EMPTY : data.current.team) : EMPTY
  const prev = data ? (focusId ? data.previous.byCommercial[focusId] ?? EMPTY : data.previous.team) : EMPTY
  const daily = data
    ? focusId
      ? data.current.activityByDayBy[focusId] ?? {}
      : data.current.activityByDay
    : {}


  // Classement : ceux qui PROSPECTENT — manager compris (décision chef des
  // ventes 25/07), MAIS objectif hebdo 0 = hors classement et hors objectif
  // équipe (profil support/dev — demande briac 09/08) ; secrétaires et
  // comptes désactivés exclus d'office.
  const prospectors = profiles.filter(
    (p) => !p.disabled_at && p.role !== 'secretaire' && (p.weekly_rdv_target ?? 0) > 0,
  )
  const teamTarget = prospectors.reduce((s, p) => s + (p.weekly_rdv_target ?? 0), 0)
  const ranked = [...prospectors].sort((a, b) => {
    const sa = data?.current.byCommercial[a.id]?.ventes ?? 0
    const sb = data?.current.byCommercial[b.id]?.ventes ?? 0
    const ra = data?.current.byCommercial[a.id]?.rdv_pris ?? 0
    const rb = data?.current.byCommercial[b.id]?.rdv_pris ?? 0
    return sb - sa || rb - ra
  })

  // Plage AFFICHÉE calculée côté client (pas depuis la réponse) : le libellé
  // suit le tap sur ‹ › immédiatement, sans attendre le fetch.
  const shownRange = periodRange(period, shiftNow(period, offset))
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d)
  const rangeLabel =
    period === 'jour'
      ? fmtDay(shownRange.start)
      : `${fmtDay(shownRange.start)} – ${fmtDay(new Date(shownRange.end.getTime() - 86400000))}`

  const showChart = period !== 'jour' && data
  // Objectif hebdo : par commercial en drill-down/vue perso, AGRÉGÉ en vue
  // Équipe (audit UX A28 — le manager additionnait de tête les X/Y).
  const showObjective =
    data !== null && period === 'semaine' && (focusId !== null || (isSupervisor && teamTarget > 0))
  const objectiveTarget = focusId ? targetOf(focusId) : teamTarget
  const days = data ? daysOf(data.range.start, data.range.end) : []

  const saveTarget = async () => {
    if (!drillId || targetEdit === null) return
    try {
      await updateWeeklyTarget(drillId, targetEdit)
      loadProfiles()
      setTargetEdit(null)
      toast.success('Objectif mis à jour')
    } catch (e) {
      console.error('Objectif hebdo :', e)
      toast.error('Objectif non enregistré — vérifiez le réseau')
    }
  }

  const myIdx = meId ? ranked.findIndex((p) => p.id === meId) : -1
  const above = myIdx > 0 ? ranked[myIdx - 1] : null

  return (
    // Pas d'en-tête « Statistiques » (refonte 26/07, même logique que
    // l'agenda) : le segmented ouvre l'écran, la période est le titre.
    <div className="screen">
      <div className="seg">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`seg-btn ${period === p.value ? 'is-active' : ''}`}
            onClick={() => {
              setPeriod(p.value)
              setOffset(0) // « semaine -2 » n'a pas de sens transposé en jours
            }}
          >
            {period === p.value && (
              <motion.span layoutId="seg-indicator" className="seg-ind" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
            )}
            <span className="seg-text">{p.label}</span>
          </button>
        ))}
      </div>
      {/* Navigation vers les périodes passées (audit UX B8). */}
      <div className="stats-rangebar">
        <button
          type="button"
          className="range-nav"
          onClick={() => setOffset((o) => o - 1)}
          aria-label="Période précédente"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <p className="stats-range">{rangeLabel}</p>
        <button
          type="button"
          className="range-nav"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
          aria-label="Période suivante"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
        {offset < 0 && (
          <button type="button" className="text-btn range-today" onClick={() => setOffset(0)}>
            Aujourd’hui
          </button>
        )}
      </div>

      {loadError && (
        <div className="load-error">
          <span>Statistiques impossibles à charger — vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={loadStats}>
            Réessayer
          </button>
        </div>
      )}

      {isSupervisor && drillId && (
        <button type="button" className="drill-back" onClick={() => setDrillId(null)}>
          <ChevronLeft size={16} /> Retour équipe
        </button>
      )}

      {/* Squelettes tant que les données ne sont pas là (audit UX B14) : les
          KPI/tunnel/classement affichaient de FAUX zéros plusieurs secondes —
          des chiffres faux commentés en réunion. */}
      {!data && !loadError && (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-hero" />
          <span className="sk sk-block" />
          <span className="sk sk-block sk-block-tall" />
        </div>
      )}

      {/* Chiffre HÉROS (refonte 26/07) : les ventes portent l'écran, delta en
          phrase ; les autres KPI passent en ligne secondaire — fini les 3
          cartes de même poids qui doublonnaient le tunnel. */}
      {data && (
        <section className="stats-hero">
          <p className="eyebrow">{focusId ? nameOf(focusId) : 'Équipe'}</p>
          <div className="hero-line">
            <span className="hero-value tnum">{cur.ventes}</span>
            <span className="hero-unit">vente{cur.ventes > 1 ? 's' : ''}</span>
            <HeroDelta value={cur.ventes - prev.ventes} period={period} />
          </div>
          {/* La conversion ne vit plus qu'au pied du tunnel (doublon, 26/07). */}
          <p className="hero-sub">
            <b className="tnum">{cur.portes}</b> portes · <b className="tnum">{cur.rdv_pris}</b>{' '}
            RDV pris
          </p>
          {/* « Ma position » vit sous le héros (plus de carte séparée en
              fond d'écran que personne n'atteignait). */}
          {!isSupervisor && myIdx >= 0 && (
            <p className="hero-pos">
              {myIdx + 1}
              {myIdx === 0 ? 'ᵉʳ' : 'ᵉ'} sur {ranked.length}
              {above &&
                ` · ${above.full_name ?? 'le suivant'} devant (+${
                  (data?.current.byCommercial[above.id]?.ventes ?? 0) - cur.ventes
                } vente${
                  (data?.current.byCommercial[above.id]?.ventes ?? 0) - cur.ventes > 1 ? 's' : ''
                })`}
            </p>
          )}
          {isSupervisor && drillId && onShowCommercialOnMap && (
            <button
              type="button"
              className="text-btn drill-map"
              onClick={() => onShowCommercialOnMap(drillId)}
            >
              <MapPin size={14} strokeWidth={2} /> Voir ses points sur la carte
            </button>
          )}
        </section>
      )}

      {showObjective && (
        <div className="card obj-card">
          <div className="obj-head">
            <span className="eyebrow">
              {focusId ? 'Objectif hebdo de RDV' : 'Objectif hebdo équipe'}
            </span>
            <span className="obj-big tnum">
              {cur.rdv_pris} / {objectiveTarget}
            </span>
            {/* Le crayon vit ici, plus dans les lignes du classement où il
                brouillait le drill-down (audit UX A25). */}
            {isManager && drillId && targetEdit === null && (
              <button
                type="button"
                className="rank-edit"
                onClick={() => setTargetEdit(targetOf(drillId))}
                aria-label="Modifier l'objectif"
              >
                <Pencil size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>
          {targetEdit !== null && drillId ? (
            <div className="obj-stepper">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTargetEdit(Math.max(0, targetEdit - 1))}
                aria-label="Diminuer"
              >
                <Minus size={16} />
              </button>
              <span className="obj-big tnum">{targetEdit}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTargetEdit(targetEdit + 1)}
                aria-label="Augmenter"
              >
                <Plus size={16} />
              </button>
              <button type="button" className="btn btn-primary obj-save" onClick={saveTarget}>
                OK
              </button>
            </div>
          ) : (
            <div className="obj-bar-bg">
              <div
                className="obj-bar"
                style={{ width: `${objectiveTarget > 0 ? Math.min(100, (cur.rdv_pris / objectiveTarget) * 100) : 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      {data && (
        <section className="card">
          <p className="eyebrow">Tunnel de conversion</p>
          <Funnel s={cur} />
        </section>
      )}

      {showChart && <Chart daily={daily} days={days} />}

      {/* Répartition par statut SOUS le graphe des portes (placement briac). */}
      {data && <StatusBreakdown s={cur} />}

      {/* Manager : classement complet (cliquable). Commercial : sa position. */}
      {data && isSupervisor && !drillId && (
        <section className="card">
          <p className="eyebrow">Classement des commerciaux</p>
          {ranked.length === 0 && <p className="screen-empty">Aucun commercial.</p>}
          {ranked.map((p, i) => {
            const s = data?.current.byCommercial[p.id] ?? EMPTY
            const target = p.weekly_rdv_target || 0
            const targetPct = target > 0 ? Math.min(100, (s.rdv_pris / target) * 100) : 0
            return (
              <div key={p.id} className="rank">
                <span className="rank-pos tnum">{i + 1}</span>
                <button type="button" className="rank-body rank-clickable" onClick={() => setDrillId(p.id)}>
                  <div className="rank-line">
                    <span className="rank-name">
                      <span className="status-dot" style={{ background: colorForCommercial(p.id, p.color) }} />
                      {p.full_name ?? 'Commercial'}
                    </span>
                    <span className="rank-sales tnum">
                      {s.ventes} <span className="rank-sales-unit">vente{s.ventes > 1 ? 's' : ''}</span>
                    </span>
                  </div>
                  {/* Portes dans la ligne (audit UX A10) : 0 porte et 80
                      portes sans RDV étaient indiscernables. */}
                  <div className="rank-metrics">
                    <span className="tnum">{s.portes}</span> portes ·{' '}
                    <span className="tnum">{s.rdv_pris}</span> RDV · conv.{' '}
                    {/* Même définition que le pied du tunnel (30/07) :
                        ventes ÷ RDV effectués. */}
                    <span className="tnum">{pct1(ratio(s.ventes, s.rdv_effectues))}</span>
                  </div>
                  {/* Barre d'objectif HEBDO seulement en Semaine (audit UX
                      A9) : en Jour tout le monde était à 10 %, en Mois tout
                      le monde le pulvérisait. */}
                  {period === 'semaine' && (
                    <div className="rank-obj">
                      <div className="obj-bar-bg">
                        <div className="obj-bar" style={{ width: `${targetPct}%` }} />
                      </div>
                      <span className="obj-text tnum">
                        {s.rdv_pris}/{target}
                      </span>
                    </div>
                  )}
                </button>
                {/* Affordance du drill-down (audit UX A25). */}
                <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
              </div>
            )
          })}
        </section>
      )}

    </div>
  )
}
