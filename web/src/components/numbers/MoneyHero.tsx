import type { ReactNode } from 'react'
import { Num } from '../ui/Num'

/**
 * Chiffre héros de Numbers (retour briac 26/09 : pas de gros chiffre vert).
 * Même carte que le héros des Stats de prospection, mais l'argent est en
 * ENCRE : le vert reste le signe « vendu / objectif atteint ».
 */
export function MoneyHero({
  eyebrow,
  value,
  delta,
  mark,
  ribbon,
  unit = '€ HT',
}: {
  eyebrow: string
  value: number
  delta?: ReactNode
  mark?: ReactNode
  ribbon: { value: ReactNode; label: string }[]
  /** « € HT » (CA), « € » (commission). */
  unit?: string
}) {
  return (
    <section className="card stats-hero money-hero">
      <div className="hero-top">
        <div className="hero-main">
          <p className="eyebrow">{eyebrow}</p>
          <div className="hero-line">
            <span className="hero-value tnum">
              <Num value={Math.round(value)} />
            </span>
            <span className="hero-unit">{unit}</span>
          </div>
          {delta}
        </div>
        {mark && <div className="hero-mark">{mark}</div>}
      </div>
      <div className="hero-ribbon">
        {ribbon.map((r) => (
          <div key={r.label} className="ribbon-stat">
            <span className="ribbon-value tnum">{r.value}</span>
            <span className="ribbon-label">{r.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
