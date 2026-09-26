import { Segmented } from '../ui/Segmented'
import type { Space } from '../../lib/space'

const OPTIONS = [
  { value: 'prospection', label: 'Prospection' },
  { value: 'numbers', label: 'Ventes' },
] as const

/** Le switch d'espace (chantier Numbers) : sur l'Accueil des DEUX espaces,
    sous l'en-tête — même sélecteur que partout ailleurs dans l'app. */
export function SpaceSwitch({ value, onChange }: { value: Space; onChange: (s: Space) => void }) {
  return <Segmented className="space-switch" options={OPTIONS} value={value} onChange={onChange} />
}
