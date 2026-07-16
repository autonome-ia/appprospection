import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { X, Trash2, Clock, User, Eye } from 'lucide-react'
import { getPointDetail, type PointDetail } from '../data/points'
import { isSupabaseConfigured } from '../lib/supabase'
import { hasMapillary } from '../lib/mapillary'
import { STATUSES, STATUS_BY_VALUE, type PointStatus } from '../domain/status'
import type { MapPoint } from '../domain/types'

interface Props {
  open: boolean
  point: MapPoint | null
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, changes: { status?: PointStatus; note?: string | null }) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRdvNeeded?: (point: MapPoint) => void
  onStreetView?: (point: MapPoint) => void
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function PointDetailSheet({ open, point, onOpenChange, onUpdate, onDelete, onRdvNeeded, onStreetView }: Props) {
  const [detail, setDetail] = useState<PointDetail | null>(null)
  const [status, setStatus] = useState<PointStatus>('absent')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!point) return
    setStatus(point.status)
    setNote('')
    setDetail(null)
    if (!isSupabaseConfigured) return
    let active = true
    getPointDetail(point.id)
      .then((d) => {
        if (!active || !d) return
        setDetail(d)
        setStatus(d.status)
        setNote(d.note ?? '')
      })
      .catch((e) => console.error('Détail du point :', e))
    return () => {
      active = false
    }
  }, [point])

  if (!point) return null

  const dirty = status !== point.status || (detail !== null && note !== (detail.note ?? ''))

  async function save() {
    if (!point) return
    setSaving(true)
    const changes: { status?: PointStatus; note?: string | null } = {}
    if (status !== point.status) changes.status = status
    if (detail && note !== (detail.note ?? '')) changes.note = note.trim() ? note.trim() : null
    const becameRdv = changes.status === 'rdv_pris'
    await onUpdate(point.id, changes)
    setSaving(false)
    onOpenChange(false)
    toast.success('Point mis à jour')
    if (becameRdv) onRdvNeeded?.({ ...point, status: 'rdv_pris' })
  }

  async function remove() {
    if (!point) return
    setSaving(true)
    await onDelete(point.id)
    setSaving(false)
    onOpenChange(false)
    toast('Point supprimé')
  }

  const current = STATUS_BY_VALUE[point.status]

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">
              <span className="status-pill" style={{ background: current.color }} />
              {current.label}
            </span>
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          {detail && (
            <div className="drawer-meta">
              <span>
                <Clock size={13} /> {formatDate(detail.created_at)}
              </span>
              {detail.author_name && (
                <span>
                  <User size={13} /> {detail.author_name}
                </span>
              )}
            </div>
          )}

          {hasMapillary && onStreetView && (
            <button type="button" className="street-btn" onClick={() => onStreetView(point)}>
              <Eye size={17} strokeWidth={1.9} /> Voir la rue
            </button>
          )}

          <p className="eyebrow field-label">Statut</p>
          <div className="chip-row">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`chip ${status === s.value ? 'is-active' : ''}`}
                style={{ ['--chip' as string]: s.color }}
                onClick={() => setStatus(s.value)}
              >
                <span className="chip-dot" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>

          <p className="eyebrow field-label">Note</p>
          <textarea
            className="field-input"
            placeholder="Ex : repasser en soirée, portail bleu…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />

          <div className="drawer-actions">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>
              <Trash2 size={16} /> Supprimer
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
