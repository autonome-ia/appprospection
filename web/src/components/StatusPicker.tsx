import { STATUSES, type PointStatus } from '../domain/status'
import { markerDataUrl } from '../config/markers'

interface Props {
  active: PointStatus
  onChange: (status: PointStatus) => void
}

/**
 * Sélecteur du statut actif : le prochain clic sur la carte pose un point
 * avec ce statut. Chaque chip montre le VRAI marqueur de la carte (retour
 * briac 25/07), pas un rond plat de la couleur.
 */
export function StatusPicker({ active, onChange }: Props) {
  return (
    <div className="status-picker">
      {STATUSES.map((s) => (
        <button
          key={s.value}
          type="button"
          className={`chip chip-lg ${active === s.value ? 'is-active' : ''}`}
          style={{ ['--chip' as string]: s.color }}
          onClick={() => onChange(s.value)}
          title={s.description}
        >
          <img className="chip-marker" src={markerDataUrl(s.value)} alt="" />
          {s.label}
        </button>
      ))}
    </div>
  )
}
