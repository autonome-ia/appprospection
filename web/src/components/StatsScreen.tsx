import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUp, ArrowDown, ChevronLeft, Pencil } from 'lucide-react'
import {
  fetchStatsComparison,
  ratio,
  type Period,
  type CommercialStats,
  type StatsResult,
} from '../data/stats'
import { fetchOrgProfiles, updateWeeklyTarget, type OrgProfile } from '../data/profiles'
import { colorForCommercial } from '../domain/colors'
import type { Profile } from '../domain/types'

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
  contacts: 0,
  rdv_pris: 0,
  rdv_effectues: 0,
  ventes: 0,
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

function Delta({ value, unit }: { value: number; unit?: string }) {
  if (value === 0) return <span className="delta flat">—</span>
  const up = value > 0
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUp size={12} strokeWidth={2.4} /> : <ArrowDown size={12} strokeWidth={2.4} />}
      {Math.abs(value)}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}

function Kpi({ label, value, delta, unit }: { label: string; value: string; delta: number; unit?: string }) {
  return (
    <div className="kpi">
      <span className="eyebrow">{label}</span>
      <span className="kpi-value tnum">{value}</span>
      <Delta value={delta} unit={unit} />
    </div>
  )
}

// Étapes du tunnel : valeur + taux de passage depuis l'étape précédente.
const STEPS: { key: keyof CommercialStats; label: string; from?: keyof CommercialStats; rate?: string }[] = [
  { key: 'portes', label: 'Portes toquées' },
  { key: 'contacts', label: 'Contacts', from: 'portes', rate: 'ouvrent' },
  { key: 'rdv_pris', label: 'RDV pris', from: 'contacts', rate: '→ RDV' },
  { key: 'rdv_effectues', label: 'RDV honorés', from: 'rdv_pris', rate: 'honorés' },
  { key: 'ventes', label: 'Ventes', from: 'rdv_effectues', rate: 'vendent' },
]

function Funnel({ s }: { s: CommercialStats }) {
  // Point de blocage = plus faible taux "maîtrisable" (prise RDV / présence / closing).
  const controllable = [
    { i: 2, r: ratio(s.rdv_pris, s.contacts) },
    { i: 3, r: ratio(s.rdv_effectues, s.rdv_pris) },
    { i: 4, r: ratio(s.ventes, s.rdv_effectues) },
  ].filter((x) => x.r > 0)
  const leak = controllable.length ? controllable.reduce((a, b) => (b.r < a.r ? b : a)) : null

  return (
    <div className="funnel2">
      {STEPS.map((step, i) => (
        <div key={step.key}>
          {i > 0 && (
            <div className={`funnel-link ${leak?.i === i ? 'is-leak' : ''}`}>
              <span className="funnel-rate tnum">{pct(ratio(s[step.key] as number, s[step.from!] as number))}</span>
              <span className="funnel-rate-label">{step.rate}</span>
            </div>
          )}
          <div className="funnel-step">
            <span className="funnel-step-label">{step.label}</span>
            <span className="funnel-step-value tnum">{s[step.key] as number}</span>
          </div>
        </div>
      ))}
      <div className="funnel-foot">
        <span className="funnel-conv">
          Conversion globale <b className="tnum">{pct1(ratio(s.ventes, s.portes))}</b>
        </span>
        <span className="funnel-absents tnum">
          {s.absents} absents · {pct(ratio(s.absents, s.portes))}
        </span>
      </div>
      {leak && (
        <p className="funnel-leak-note">
          Point de blocage : {STEPS[leak.i].label.toLowerCase()} ({pct(controllable.find((c) => c.i === leak.i)!.r)})
        </p>
      )}
    </div>
  )
}

function Chart({ daily, days }: { daily: Record<string, number>; days: string[] }) {
  const max = Math.max(1, ...days.map((d) => daily[d] ?? 0))
  return (
    <div className="card">
      <p className="eyebrow">Portes toquées par jour</p>
      <div className="chart-bars">
        {days.map((d) => {
          const v = daily[d] ?? 0
          return (
            <div key={d} className="chart-col" title={`${d} : ${v}`}>
              <div className="chart-bar" style={{ height: `${(v / max) * 100}%` }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StatsScreen({ profile }: { profile: Profile | null }) {
  const [period, setPeriod] = useState<Period>('semaine')
  const [data, setData] = useState<{ current: StatsResult; previous: StatsResult; range: { start: Date; end: Date } } | null>(null)
  const [profiles, setProfiles] = useState<OrgProfile[]>([])
  const [drillId, setDrillId] = useState<string | null>(null)

  const isManager = profile?.role === 'manager'
  const meId = profile?.id ?? null

  const loadProfiles = useCallback(() => {
    fetchOrgProfiles().then(setProfiles).catch((e) => console.error('Profils :', e))
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    fetchStatsComparison(period).then(setData).catch((e) => console.error('Stats :', e))
  }, [period])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? 'Commercial'
  const targetOf = (id: string) => profiles.find((p) => p.id === id)?.weekly_rdv_target ?? 0

  // Focus : commercial = ses stats ; manager = équipe (ou commercial en drill-down).
  const focusId = isManager ? drillId : meId
  const cur = data ? (focusId ? data.current.byCommercial[focusId] ?? EMPTY : data.current.team) : EMPTY
  const prev = data ? (focusId ? data.previous.byCommercial[focusId] ?? EMPTY : data.previous.team) : EMPTY
  const daily = data
    ? focusId
      ? data.current.activityByDayBy[focusId] ?? {}
      : data.current.activityByDay
    : {}

  const convCur = ratio(cur.ventes, cur.portes)
  const convPrev = ratio(prev.ventes, prev.portes)

  const ranked = [...profiles].sort((a, b) => {
    const sa = data?.current.byCommercial[a.id]?.ventes ?? 0
    const sb = data?.current.byCommercial[b.id]?.ventes ?? 0
    const ra = data?.current.byCommercial[a.id]?.rdv_pris ?? 0
    const rb = data?.current.byCommercial[b.id]?.rdv_pris ?? 0
    return sb - sa || rb - ra
  })

  const rangeLabel = data
    ? `${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(data.range.start)} – ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(data.range.end.getTime() - 86400000))}`
    : ''

  const showChart = period !== 'jour' && data
  const showObjective = period === 'semaine' && focusId
  const days = data ? daysOf(data.range.start, data.range.end) : []

  const editTarget = async (id: string) => {
    const val = window.prompt(`Objectif hebdo de RDV pour ${nameOf(id)} :`, String(targetOf(id)))
    if (val === null) return
    const v = parseInt(val, 10)
    if (!Number.isNaN(v)) {
      await updateWeeklyTarget(id, v)
      loadProfiles()
    }
  }

  const myIdx = meId ? ranked.findIndex((p) => p.id === meId) : -1
  const above = myIdx > 0 ? ranked[myIdx - 1] : null

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Statistiques</h2>
      </header>

      <div className="seg">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`seg-btn ${period === p.value ? 'is-active' : ''}`}
            onClick={() => setPeriod(p.value)}
          >
            {period === p.value && (
              <motion.span layoutId="seg-indicator" className="seg-ind" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
            )}
            <span className="seg-text">{p.label}</span>
          </button>
        ))}
      </div>
      {rangeLabel && <p className="stats-range">{rangeLabel}</p>}

      {isManager && drillId && (
        <button type="button" className="drill-back" onClick={() => setDrillId(null)}>
          <ChevronLeft size={16} /> Retour équipe
        </button>
      )}
      <p className="focus-title">{focusId ? nameOf(focusId) : 'Équipe'}</p>

      <div className="kpis">
        <Kpi label="Ventes" value={String(cur.ventes)} delta={cur.ventes - prev.ventes} />
        <Kpi label="RDV pris" value={String(cur.rdv_pris)} delta={cur.rdv_pris - prev.rdv_pris} />
        <Kpi label="Conversion" value={pct1(convCur)} delta={Math.round((convCur - convPrev) * 100)} unit="pts" />
      </div>

      {showObjective && (
        <div className="card obj-card">
          <div className="obj-head">
            <span className="eyebrow">Objectif hebdo de RDV</span>
            <span className="obj-big tnum">
              {cur.rdv_pris} / {targetOf(focusId!)}
            </span>
          </div>
          <div className="obj-bar-bg">
            <div
              className="obj-bar"
              style={{ width: `${targetOf(focusId!) > 0 ? Math.min(100, (cur.rdv_pris / targetOf(focusId!)) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      <section className="card">
        <p className="eyebrow">Tunnel de conversion</p>
        <Funnel s={cur} />
      </section>

      {showChart && <Chart daily={daily} days={days} />}

      {/* Manager : classement complet (cliquable). Commercial : sa position. */}
      {isManager && !drillId && (
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
                  <div className="rank-metrics tnum">
                    {s.rdv_pris} RDV · conv. {pct1(ratio(s.ventes, s.portes))}
                  </div>
                  <div className="rank-obj">
                    <div className="obj-bar-bg">
                      <div className="obj-bar" style={{ width: `${targetPct}%` }} />
                    </div>
                    <span className="obj-text tnum">
                      {s.rdv_pris}/{target}
                    </span>
                  </div>
                </button>
                <button type="button" className="rank-edit" onClick={() => editTarget(p.id)} aria-label="Modifier l'objectif">
                  <Pencil size={15} strokeWidth={1.8} />
                </button>
              </div>
            )
          })}
        </section>
      )}

      {!isManager && myIdx >= 0 && (
        <section className="card mypos">
          <p className="eyebrow">Ma position</p>
          <div className="mypos-rank">
            <span className="mypos-num tnum">{myIdx + 1}</span>
            <span className="mypos-total">sur {ranked.length}</span>
          </div>
          {above && (
            <p className="mypos-gap">
              {above.full_name ?? 'Le suivant'} est devant (+
              {(data?.current.byCommercial[above.id]?.ventes ?? 0) - cur.ventes} vente
              {(data?.current.byCommercial[above.id]?.ventes ?? 0) - cur.ventes > 1 ? 's' : ''})
            </p>
          )}
        </section>
      )}

      <p className="stats-note">Un « contact » = à revoir / RDV pris / vendu. À ajuster selon le métier.</p>
    </div>
  )
}
