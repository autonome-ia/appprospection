import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { colorForCommercial } from '../../domain/colors'
import { formatEuros, type Bucket } from '../../domain/sales'

/**
 * Graphiques de Numbers (retour briac 26/09 : « des camemberts, des
 * graphiques plus lisibles »). SVG et HTML nus, tokens de la DA ; règles du
 * skill dataviz : parts d'un tout en anneau (≤ 6 parts), 2 px d'espace entre
 * les parts, légende TOUJOURS présente avec valeur et %, lecture au doigt.
 */

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0)

export interface Slice {
  key: string
  label: string
  value: number
  /** Couleur CSS (variable de la palette des prestations, ou encre). */
  color: string
}

/** Anneau + légende. Toucher une part (ou sa ligne) la met en avant et
    affiche sa valeur au centre ; re-toucher revient au total. */
export function Donut({ slices, totalLabel = 'CA HT' }: { slices: Slice[]; totalLabel?: string }) {
  const [active, setActive] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  const R = 46
  const C = 2 * Math.PI * R
  const GAP = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 2.2 : 0
  let offset = 0
  const shown = slices.find((s) => s.key === active)
  const toggle = (k: string) => setActive((a) => (a === k ? null : k))

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg viewBox="0 0 120 120" className="donut-svg" role="img" aria-label={`Répartition : ${slices.map((s) => `${s.label} ${formatEuros(s.value)}`).join(', ')}`}>
          <circle cx="60" cy="60" r={R} className="donut-track" />
          <g transform="rotate(-90 60 60)">
          {total > 0 &&
            slices.map((s) => {
              if (s.value <= 0) return null
              const len = (s.value / total) * C
              const dash = Math.max(0.01, len - GAP)
              const el = (
                <circle
                  key={s.key}
                  cx="60"
                  cy="60"
                  r={R}
                  className={`donut-seg ${active && active !== s.key ? 'is-dim' : ''}`}
                  style={{ stroke: s.color }}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  onClick={() => toggle(s.key)}
                />
              )
              offset += len
              return el
            })}
          </g>
        </svg>
        <div className="donut-center">
          <span className="donut-center-value tnum">{formatEuros(shown ? shown.value : total)}</span>
          <span className="donut-center-label">{shown ? `${shown.label} · ${pct(shown.value, total)} %` : totalLabel}</span>
        </div>
      </div>
      <div className="donut-legend">
        {slices.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`legend-row ${active === s.key ? 'is-active' : ''} ${s.value <= 0 ? 'is-zero' : ''}`}
            onClick={() => toggle(s.key)}
            aria-pressed={active === s.key}
          >
            <i className="legend-dot" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value tnum">{formatEuros(s.value)}</span>
            <span className="legend-pct tnum">{pct(s.value, total)} %</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Évolution du CA : colonnes par jour ou par mois, lecture au doigt comme
    le graphe des portes des Stats de prospection. */
export function Evolution({ buckets, values }: { buckets: Bucket[]; values: number[] }) {
  const max = Math.max(1, ...values)
  const total = values.reduce((s, v) => s + v, 0)
  const few = buckets.length <= 12
  const [active, setActive] = useState<number | null>(null)
  const releaseTimer = useRef<number | undefined>(undefined)
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * buckets.length)
    setActive(Math.max(0, Math.min(buckets.length - 1, i)))
  }
  const release = () => {
    window.clearTimeout(releaseTimer.current)
    releaseTimer.current = window.setTimeout(() => setActive(null), 1200)
  }
  useEffect(() => () => window.clearTimeout(releaseTimer.current), [])

  return (
    <div className="card">
      <div className="chart-head">
        <p className="eyebrow">{active !== null ? buckets[active].title : 'Évolution du CA'}</p>
        <span className="chart-total tnum">{formatEuros(active !== null ? values[active] : total)}</span>
      </div>
      <div
        className={`chart-bars evo-bars ${active !== null ? 'is-scrubbing' : ''}`}
        onPointerDown={(e) => {
          window.clearTimeout(releaseTimer.current)
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          if ((e.buttons || e.pointerType === 'touch') && e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {buckets.map((b, i) => {
          const v = values[i]
          return (
            <div key={b.start} className="chart-col">
              <div className="chart-stick">
                {few && v > 0 && (
                  <span className="chart-val tnum" style={{ bottom: `calc(${(v / max) * 100}% + 4px)` }}>
                    {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
                  </span>
                )}
                <div
                  className={`chart-bar evo-bar ${i === active ? 'is-active' : ''} ${v === 0 ? 'is-zero' : ''}`}
                  style={{ height: `${(v / max) * 100}%` }}
                />
              </div>
              <span className="chart-day">{b.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface SellerBar {
  id: string
  name: string
  color: string | null
  ca: number
  /** Avancement vers l'objectif (0..∞), null sans objectif. */
  avancement: number | null
}

/** CA par vendeur : barres horizontales à la couleur du commercial (même
    doctrine que l'agenda), rang, montant, part du total et objectif. */
export function SellerBars({ rows, meId, onOpen }: { rows: SellerBar[]; meId: string; onOpen?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.ca))
  const total = rows.reduce((s, r) => s + r.ca, 0)
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
                <span className="seller-value tnum">{formatEuros(r.ca)}</span>
              </span>
              <span className="seller-track">
                <span
                  className="seller-fill"
                  style={{ width: `${(r.ca / max) * 100}%`, background: colorForCommercial(r.id, r.color) }}
                />
              </span>
              <span className="seller-meta">
                <span className="tnum">{pct(r.ca, total)} %</span> du CA
                {r.avancement != null && (
                  <>
                    {' · '}
                    <span className="tnum">{Math.round(r.avancement * 100)} %</span> de l’objectif
                  </>
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
