import { STATUSES, type PointStatus } from '../domain/status'

interface Props {
  active: PointStatus
  onChange: (status: PointStatus) => void
}

/**
 * Sélecteur du statut actif : le prochain clic sur la carte pose un point
 * avec ce statut. La puce active se remplit de la couleur du statut.
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
          <span className="chip-dot" style={{ background: s.color }} />
          {s.label}
        </button>
      ))}
    </div>
  )
}
