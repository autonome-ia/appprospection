import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { X, Trash2, Clock, User } from 'lucide-react'
import { getPointDetail, fetchPointNotes, type PointDetail, type PointNote } from '../data/points'
import { isSupabaseConfigured } from '../lib/supabase'
import { STATUSES, STATUS_BY_VALUE, type PointStatus } from '../domain/status'
import type { MapPoint } from '../domain/types'

interface Props {
  open: boolean
  point: MapPoint | null
  onOpenChange: (open: boolean) => void
  onUpdate: (
    id: string,
    changes: { status?: PointStatus; note?: string | null; client_name?: string | null },
  ) => Promise<void>
  /** Ajoute une note au journal de la maison (jamais d'écrasement). */
  onAddNote: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRdvNeeded?: (point: MapPoint) => void
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

export function PointDetailSheet({
  open,
  point,
  onOpenChange,
  onUpdate,
  onAddNote,
  onDelete,
  onRdvNeeded,
}: Props) {
  const [detail, setDetail] = useState<PointDetail | null>(null)
  const [status, setStatus] = useState<PointStatus>('absent')
  const [history, setHistory] = useState<PointNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [clientName, setClientName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!point) return
    setStatus(point.status)
    setClientName(point.client_name ?? '')
    setNewNote('')
    setDetail(null)
    setHistory([])
    // Point en cours d'enregistrement (id temporaire, pose optimiste) : pas
    // encore de détail ni de journal en base.
    if (!isSupabaseConfigured || point.id.startsWith('temp-')) return
    let active = true
    getPointDetail(point.id)
      .then((d) => {
        if (active && d) setDetail(d)
      })
      .catch((e) => console.error('Détail du point :', e))
    fetchPointNotes(point.id)
      .then((ns) => {
        if (active) setHistory(ns)
      })
      .catch((e) => console.error('Journal de notes :', e))
    return () => {
      active = false
    }
  }, [point])

  if (!point) return null

  const dirty =
    status !== point.status ||
    clientName !== (point.client_name ?? '') ||
    newNote.trim().length > 0

  // Journal affiché : le vrai journal, ou à défaut la dernière note connue
  // du point (ancienne donnée pas encore migrée, ou fetch en cours).
  const shownNotes: PointNote[] =
    history.length === 0 && point.note
      ? [
          {
            id: 'legacy',
            body: point.note,
            created_at: detail?.created_at ?? '',
            author_name: detail?.author_name ?? null,
          },
        ]
      : history

  async function save() {
    if (!point) return
    setSaving(true)
    const changes: { status?: PointStatus; client_name?: string | null } = {}
    if (status !== point.status) changes.status = status
    if (clientName !== (point.client_name ?? ''))
      changes.client_name = clientName.trim() ? clientName.trim() : null
    const becameRdv = changes.status === 'rdv_pris'
    try {
      if (Object.keys(changes).length > 0) await onUpdate(point.id, changes)
      if (newNote.trim()) await onAddNote(point.id, newNote.trim())
      onOpenChange(false)
      toast.success('Point mis à jour')
      if (becameRdv) onRdvNeeded?.({ ...point, status: 'rdv_pris' })
    } catch (e) {
      console.error('Modification du point :', e)
      toast.error('Modification impossible — réseau, ou point d’un autre commercial')
    } finally {
      setSaving(false)
    }
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
    // Non modale : la carte reste visible et manipulable derrière (le point
    // sélectionné est recadré au-dessus de la sheet, voir MapView).
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Drawer.Portal>
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

          <p className="eyebrow field-label">Client</p>
          <input
            className="field-input"
            type="text"
            placeholder="Nom (facultatif)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />

          <p className="eyebrow field-label">Notes</p>
          {shownNotes.length > 0 && (
            <ul className="note-history">
              {shownNotes.map((n) => (
                <li key={n.id} className="note-entry">
                  <span className="note-meta">
                    {n.author_name ?? 'Note'}
                    {n.created_at ? ` · ${formatDate(n.created_at)}` : ''}
                  </span>
                  <span className="note-body">{n.body}</span>
                </li>
              ))}
            </ul>
          )}
          <textarea
            className="field-input"
            placeholder={
              shownNotes.length
                ? 'Ajouter une note (la précédente est conservée)…'
                : 'Ex : repasser en soirée, portail bleu…'
            }
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
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
