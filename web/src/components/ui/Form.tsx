import type { ReactNode } from 'react'
import { ChevronsUpDown } from 'lucide-react'

/**
 * Formulaires façon Réglages iOS (chantier design 24/09) : un BLOC par thème
 * (titre en eyebrow au-dessus), des lignes « label à gauche · saisie à
 * droite » séparées par des filets — au lieu d'une pile de boîtes bordées
 * coiffées chacune d'un label en capitales.
 */
export function FormGroup({
  title,
  hint,
  children,
}: {
  title?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="form-section">
      {title && <p className="eyebrow form-section-title">{title}</p>}
      <div className="form-group">{children}</div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

/** Une ligne : label fixe à gauche, contrôle natif à droite (input, select).
    `select` ajoute le chevron ⇅ des listes iOS. */
export function FormRow({
  label,
  select = false,
  children,
}: {
  label: string
  select?: boolean
  children: ReactNode
}) {
  return (
    <label className={`form-row ${select ? 'is-select' : ''}`}>
      <span className="form-row-label">{label}</span>
      <span className="form-row-control">
        {children}
        {select && <ChevronsUpDown size={15} strokeWidth={1.8} className="form-row-chevron" aria-hidden="true" />}
      </span>
    </label>
  )
}
