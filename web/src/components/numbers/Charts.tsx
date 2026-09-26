import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { Money, Pct } from './Money'
import { colorForCommercial } from '../../domain/colors'
import { formatCompact, paceOf, type Bucket } from '../../domain/sales'

/**
 * Graphiques de Numbers — refonte du tour UI/UX (26/09, 3 audits + choix
 * briac) : l'argent en ENCRE, toiture en encre pleine et le reste en gris
 * (plus d'arc-en-ciel qui rappelait les statuts de la carte), rythme et
 * projection vers l'objectif, CA cumulé face à la droite d'objectif.
 * Règles dataviz : légende chiffrée toujours présente, lecture au doigt,
 * 2 px d'espace entre les segments, pas de lignes à 0 €.
 */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const dayTitle = (k: string) => {
  const [, m, d] = k.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`
}

/** Scrub au doigt partagé (même mécanique que le graphe des portes). */
function useScrub(count: number) {
  const [active, setActive] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const pick = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * count)
    setActive(Math.max(0, Math.min(count - 1, i)))
  }
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      window.clearTimeout(timer.current)
      e.currentTarget.setPointerCapture(e.pointerId)
      pick(e)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if ((e.buttons || e.pointerType === 'touch') && e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
    },
    onPointerUp: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setActive(null), 1400)
    },
  }
  return { active, handlers: { ...handlers, onPointerCancel: handlers.onPointerUp } }
}

// ---------------------------------------------------------------------------
// Objectif : réalisé, repère « attendu à ce jour », reste, projection
// ---------------------------------------------------------------------------

export function GoalCard({
  title,
  ca,
  target,
  bounds,
  unit,
}: {
  title: string
  ca: number
  target: number
  bounds: { start: string; end: string }
  /** « du mois », « du trimestre »… pour la projection. */
  unit: string
}) {
  const p = paceOf(ca, target, bounds)
  const current = p.elapsed < 1
  const pct = Math.min(100, (ca / target) * 100)
  const done = ca >= target
  return (
    <section className="card goal-card">
      <div className="goal-head">
        <span className="eyebrow">{title}</span>
        <Pct value={ca / target} whole className="goal-pct" />
      </div>
      <div className="goal-bar">
        <div className={`goal-fill ${done ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
        {current && !done && (
          <span className="goal-mark" style={{ left: `${Math.min(100, p.elapsed * 100)}%` }} aria-hidden="true" />
        )}
      </div>
      <p className="goal-line">
        <Money value={ca} /> sur <Money value={target} />
      </p>
      {done ? (
        <p className="goal-status is-ahead">Objectif atteint</p>
      ) : current ? (
        <>
          <p className="goal-line">
            Reste <Money value={p.reste} className="is-strong" />
            {p.joursOuvres > 0 && (
              <>
                {' · '}
                <span className="tnum">{p.joursOuvres}</span> jour{p.joursOuvres > 1 ? 's' : ''} ouvré{p.joursOuvres > 1 ? 's' : ''}
              </>
            )}
          </p>
          <p className={`goal-status ${p.ecart >= 0 ? 'is-ahead' : 'is-behind'}`}>
            {p.ecart >= 0 ? 'En avance de ' : 'En retard de '}
            <Money value={Math.abs(p.ecart)} /> sur le rythme · projection {unit} <Money value={p.projection} />
          </p>
        </>
      ) : (
        <p className="goal-status is-behind">
          Manqué de <Money value={p.reste} />
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// CA cumulé (semaine, mois) face à la droite d'objectif et à la période
// précédente — « en avance ou en retard » se lit en une seconde.
// ---------------------------------------------------------------------------

export function CumulChart({
  days,
  values,
  prev,
  target,
  prevLabel,
}: {
  days: string[]
  values: (number | null)[]
  prev: (number | null)[]
  target: number | null
  prevLabel: string
}) {
  const W = 320
  const H = 150
  const n = days.length
  const known = values.filter((v): v is number => v != null)
  const last = known.length ? known[known.length - 1] : 0
  const max = Math.max(1, target ?? 0, ...known, ...prev.map((v) => v ?? 0)) * 1.08
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const y = (v: number) => H - (v / max) * H
  const path = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')
  const lastIdx = known.length - 1
  const { active, handlers } = useScrub(n)
  const shownIdx = active ?? lastIdx
  const shown = shownIdx >= 0 ? values[shownIdx] : null

  return (
    <section className="card">
      <div className="chart-head">
        <p className="eyebrow">{active !== null ? dayTitle(days[active]) : 'CA cumulé'}</p>
        <span className="chart-total">
          {shown != null ? <Money value={shown} /> : <span className="chart-none">à venir</span>}
        </span>
      </div>
      <div className="cumul" {...handlers}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="cumul-svg" aria-label={`CA cumulé : ${Math.round(last)} euros`}>
          {target != null && <line x1="0" y1={H} x2={W} y2={y(target)} className="cumul-goal" />}
          <polyline points={path(prev)} className="cumul-prev" />
          <polyline points={path(values)} className="cumul-cur" />
          {shownIdx >= 0 && shown != null && (
            <>
              {active !== null && <line x1={x(shownIdx)} y1="0" x2={x(shownIdx)} y2={H} className="cumul-cursor" />}
              <circle cx={x(shownIdx)} cy={y(shown)} r="4" className="cumul-dot" />
            </>
          )}
        </svg>
      </div>
      <div className="cumul-axis">
        {days.map((d) => (
          <span key={d}>{n > 8 ? (Number(d.slice(8)) % 7 === 1 ? Number(d.slice(8)) : '') : ['D', 'L', 'M', 'M', 'J', 'V', 'S'][new Date(`${d}T12:00:00`).getDay()]}</span>
        ))}
      </div>
      <div className="cumul-legend">
        <span>
          <i className="leg-line is-cur" /> Réalisé
        </span>
        <span>
          <i className="leg-line is-prev" /> {prevLabel}
        </span>
        {target != null && (
          <span>
            <i className="leg-line is-goal" /> Rythme objectif
          </span>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Évolution par mois (trimestre, année) avec le repère d'objectif mensuel
// ---------------------------------------------------------------------------

export function Evolution({ buckets, values, goal }: { buckets: Bucket[]; values: number[]; goal?: number | null }) {
  const max = Math.max(1, goal ?? 0, ...values) * 1.05
  const total = values.reduce((s, v) => s + v, 0)
  const { active, handlers } = useScrub(buckets.length)
  return (
    <section className="card">
      <div className="chart-head">
        <p className="eyebrow">{active !== null ? buckets[active].title : 'CA par mois'}</p>
        <span className="chart-total">
          <Money value={active !== null ? values[active] : total} />
        </span>
      </div>
      <div className={`chart-bars evo-bars ${active !== null ? 'is-scrubbing' : ''}`} {...handlers}>
        {buckets.map((b, i) => {
          const v = values[i]
          return (
            <div key={b.start} className="chart-col">
              <div className="chart-stick">
                {v > 0 && (
                  <span className="chart-val tnum" style={{ bottom: `calc(${(v / max) * 100}% + 4px)` }}>
                    {formatCompact(v)}
                  </span>
                )}
                {goal ? <span className="evo-goal" style={{ bottom: `${(goal / max) * 100}%` }} /> : null}
                <div
                  className={`chart-bar evo-bar ${i === active ? 'is-active' : ''} ${goal && v >= goal ? 'is-done' : ''} ${v === 0 ? 'is-zero' : ''}`}
                  style={{ height: `${(v / max) * 100}%` }}
                />
              </div>
              <span className="chart-day">{b.label}</span>
            </div>
          )
        })}
      </div>
      {goal ? (
        <div className="cumul-legend">
          <span>
            <i className="leg-line is-goal" /> Objectif mensuel <Money value={goal} />
          </span>
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Répartition (prestations, origines) : une barre + la liste chiffrée
// ---------------------------------------------------------------------------

export interface Slice {
  key: string
  label: ReactNode
  value: number
  /** Couleur CSS : encre pour la part mise en avant, gris sinon. */
  color: string
}

export function MixBar({ slices, onPick }: { slices: Slice[]; onPick?: (key: string) => void }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const shown = slices.filter((s) => s.value > 0)
  if (total <= 0) return <p className="screen-empty">Aucune vente sur cette période.</p>
  return (
    <div className="mix">
      <div className="mix-bar" aria-hidden="true">
        {shown.map((s) => (
          <span key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="mix-list">
        {shown.map((s) => {
          const body = (
            <>
              <i className="legend-dot" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <Money value={s.value} className="legend-value" />
              <Pct value={s.value / total} whole className="legend-pct" />
            </>
          )
          return onPick ? (
            <button key={s.key} type="button" className="legend-row is-clickable" onClick={() => onPick(s.key)}>
              {body}
            </button>
          ) : (
            <div key={s.key} className="legend-row">
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CA par vendeur : barres à la couleur du commercial
// ---------------------------------------------------------------------------

export interface SellerBar {
  id: string
  name: string
  color: string | null
  ca: number
  ventes: number
  /** Avancement vers l'objectif, null sans objectif OU masqué (D-UX :
      un commercial ne voit pas l'objectif de ses collègues). */
  avancement: number | null
  /** Écart au rythme attendu (> 0 en avance), null si non affiché. */
  ecart: number | null
}

export function SellerBars({ rows, meId, onOpen }: { rows: SellerBar[]; meId: string; onOpen?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.ca))
  if (rows.length === 0) return <p className="screen-empty">Aucune vente sur cette période.</p>
  return (
    <div className="seller-bars">
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="seller-rank tnum">{i + 1}</span>
            <Avatar id={r.id} name={r.name} color={r.color} size={26} />
            <span className="seller-main">
              <span className="seller-line">
                <span className={`seller-name ${r.id === meId ? 'is-me' : ''}`}>{r.name}</span>
                <Money value={r.ca} className="seller-value" />
              </span>
              <span className="seller-track">
                <span className="seller-fill" style={{ width: `${(r.ca / max) * 100}%`, background: colorForCommercial(r.id, r.color) }} />
              </span>
              <span className="seller-meta">
                <span className="tnum">{r.ventes.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span> vente
                {r.ventes >= 2 ? 's' : ''}
                {r.avancement != null && (
                  <>
                    {' · '}
                    <Pct value={r.avancement} whole /> de l’objectif
                  </>
                )}
                {r.ecart != null && r.ecart < 0 && (
                  <span className="seller-late">
                    {' · '}en retard de <Money value={-r.ecart} />
                  </span>
                )}
              </span>
            </span>
            {onOpen && <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />}
          </>
        )
        return onOpen ? (
          <button key={r.id} type="button" className="seller-row is-clickable" onClick={() => onOpen(r.id)}>
            {body}
          </button>
        ) : (
          <div key={r.id} className="seller-row">
            {body}
          </div>
        )
      })}
    </div>
  )
}
