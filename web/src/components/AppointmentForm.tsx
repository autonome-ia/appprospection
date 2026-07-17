import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { createAppointment, updateAppointment } from '../data/appointments'
import { addPointNote, setPointClientName } from '../data/points'
import type { Appointment } from '../domain/appointments'
import type { Profile } from '../domain/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  existing?: Appointment | null
  pointId?: string | null
  coords?: { lng: number; lat: number } | null
  /** Note terrain du point lié (affichée en contexte, non éditable ici). */
  pointNote?: string | null
  onSaved: () => void
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultWhen(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return toLocalInput(d)
}

export function AppointmentForm({ open, onOpenChange, profile, existing, pointId, coords, pointNote, onSaved }: Props) {
  const [when, setWhen] = useState(existing ? toLocalInput(new Date(existing.scheduled_at)) : defaultWhen())
  const [clientName, setClientName] = useState(existing?.client_name ?? '')
  const [clientPhone, setClientPhone] = useState(existing?.client_phone ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  // Pré-remplit l'adresse depuis les coordonnées du point (géocodage inverse BAN).
  useEffect(() => {
    if (existing || address || !coords) return
    const ctrl = new AbortController()
    fetch(`https://data.geopf.fr/geocodage/reverse/?lon=${coords.lng}&lat=${coords.lat}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        const label = j.features?.[0]?.properties?.label
        if (label) setAddress(label)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [coords, existing, address])

  async function save() {
    setSaving(true)
    try {
      const scheduled_at = new Date(when).toISOString()
      const payload = {
        client_name: clientName.trim() || null,
        client_phone: clientPhone.trim() || null,
        address: address.trim() || null,
        // Nettoyée : la copie vers le journal de la maison l'est aussi, et
        // l'agenda masque le contexte du point quand les textes sont égaux.
        notes: notes.trim() || null,
      }
      if (existing) {
        await updateAppointment(existing.id, { scheduled_at, ...payload })
      } else {
        await createAppointment(profile, { point_id: pointId ?? null, scheduled_at, ...payload })
      }
      // Le point lié hérite du contexte saisi ici (fiche maison cohérente) :
      // nom du client synchronisé, note du RDV ajoutée au journal de la
      // maison (à la création seulement, pour ne pas dupliquer à chaque
      // modification). Best effort : un échec n'annule pas le RDV.
      const linkedPointId = existing ? existing.point_id : (pointId ?? null)
      if (linkedPointId) {
        if (clientName) {
          setPointClientName(linkedPointId, clientName).catch((e) =>
            console.error('Synchro client du point :', e),
          )
        }
        if (!existing && notes.trim()) {
          addPointNote(profile, linkedPointId, notes.trim()).catch((e) =>
            console.error('Note du RDV vers le journal :', e),
          )
        }
      }
      onOpenChange(false)
      onSaved()
      toast.success(existing ? 'RDV modifié' : 'RDV enregistré')
    } catch (e) {
      console.error('Enregistrement RDV :', e)
      toast.error('Erreur lors de l’enregistrement du RDV')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">{existing ? 'Modifier le RDV' : 'Nouveau rendez-vous'}</span>
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          <p className="eyebrow field-label">Date et heure</p>
          <input className="field-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />

          <div className="field-grid">
            <div>
              <p className="eyebrow field-label">Client</p>
              <input
                className="field-input"
                type="text"
                placeholder="Nom"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div>
              <p className="eyebrow field-label">Téléphone</p>
              <input
                className="field-input"
                type="tel"
                placeholder="06 …"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
              />
            </div>
          </div>

          <p className="eyebrow field-label">Adresse</p>
          <input
            className="field-input"
            type="text"
            placeholder="Adresse"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          {(pointNote ?? existing?.point?.notes) && (
            <>
              <p className="eyebrow field-label">Note du point (terrain)</p>
              <p className="form-context-note">{pointNote ?? existing?.point?.notes}</p>
            </>
          )}

          <p className="eyebrow field-label">Note du RDV</p>
          <textarea
            className="field-input"
            rows={2}
            placeholder="Ex : sonner 2 fois, passer par l’arrière, devis à préparer…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="drawer-actions">
            <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
