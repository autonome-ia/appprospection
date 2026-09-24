import { DISPLAY_STATUSES, type PointStatus } from '../domain/status'
import { markerDataUrl } from '../config/markers'

interface Props {
  /** Statut surligné. Absent = chips d'ACTION (pose en 1 tap) : aucune ne
      reste « active » d'une maison à l'autre. */
  active?: PointStatus
  onChange: (status: PointStatus) => void
  /** Chips grisées (ex. réticule sous le zoom de visée). */
  disabled?: boolean
}

/**
 * Chips de statut. Chaque chip montre le VRAI marqueur de la carte (retour
 * briac 25/07), pas un rond plat de la couleur. Sans `active`, un tap = une
 * pose (chantier design 24/09, décision briac : plus de « Poser · X »).
 */
export function StatusPicker({ active, onChange, disabled }: Props) {
  return (
    <div className="status-picker">
      {DISPLAY_STATUSES.map((s) => (
        <button
          key={s.value}
          type="button"
          className={`chip chip-lg ${active === s.value ? 'is-active' : ''}`}
          style={{ ['--chip' as string]: s.color }}
          onClick={() => onChange(s.value)}
          disabled={disabled}
          title={s.description}
        >
          <img className="chip-marker" src={markerDataUrl(s.value)} alt="" />
          {s.label}
        </button>
      ))}
    </div>
  )
}
