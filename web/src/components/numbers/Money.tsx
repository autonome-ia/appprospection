import type { ReactNode } from 'react'

/**
 * Un seul langage pour les montants et les taux de Numbers (tour UI/UX du
 * 26/09, audit DA) : les CHIFFRES en Geist Mono, les unités (€, %, k) et
 * l'espace fine en Geist — en mono, l'espace insécable fine prenait une
 * cellule entière (« 650  € »). Découpage par Intl.formatToParts.
 */

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const EUR_COMPACT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })
const PCT0 = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 })

const NUMERIC = new Set(['integer', 'decimal', 'fraction', 'minusSign', 'plusSign'])

function render(parts: Intl.NumberFormatPart[], className?: string): ReactNode {
  return (
    <span className={`money ${className ?? ''}`}>
      {parts.map((p, i) =>
        NUMERIC.has(p.type) ? (
          <span key={i} className="tnum">
            {p.value}
          </span>
        ) : p.type === 'group' ? (
          // Séparateur de milliers : l'espace fine, en police texte.
          <span key={i} className="g">
            {p.value}
          </span>
        ) : p.type === 'literal' && /^\s+$/.test(p.value) ? null : (
          <span key={i} className="u">
            {p.value}
          </span>
        ),
      )}
    </span>
  )
}

/** Montant en euros entiers. `compact` : « 36,5 k€ » (cases étroites). */
export function Money({ value, compact = false, className }: { value: number; compact?: boolean; className?: string }) {
  const n = Math.round(value)
  const f = compact && Math.abs(n) >= 10000 ? EUR_COMPACT : EUR
  return render(f.formatToParts(n), className)
}

/** Taux / part : « 13 % », « 30,7 % ». `whole` : sans décimale. */
export function Pct({ value, whole = false, className }: { value: number; whole?: boolean; className?: string }) {
  return render((whole ? PCT0 : PCT).formatToParts(value), className)
}
