import { useId } from 'react'
import { motion } from 'motion/react'
import { SPRING_SNAPPY } from '../../lib/motion'

type Option<T extends string> = { value: T; label: string }

/**
 * Sélecteur segmenté partagé (chantier design 24/09) : l'indicateur GLISSE
 * d'une option à l'autre (layoutId propre à chaque instance, ressort net sans
 * rebond) au lieu de réapparaître d'un bloc. Classes .seg / .seg-btn /
 * .seg-ind / .seg-text inchangées (styles et sondes Playwright).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly Option<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  const id = useId()
  return (
    <div className={`seg ${className ?? ''}`}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            className={`seg-btn ${on ? 'is-active' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="seg-ind" transition={SPRING_SNAPPY} />}
            <span className="seg-text">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
