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

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

function defaultDate(): Date {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

// Les RDV se prennent à l'heure pile ou à la demi-heure : un sélecteur de
// CRÉNEAUX (7 h → 21 h) remplace la roue des minutes du datetime-local natif
// (interminable au doigt, et iOS ignore l'attribut step). Un seul tap.
const TIME_SLOTS: string[] = []
for (let h = 7; h <= 21; h++) {
  TIME_SLOTS.push(`${pad(h)}:00`)
  if (h < 21) TIME_SLOTS.push(`${pad(h)}:30`)
}

export function AppointmentForm({ open, onOpenChange, profile, existing, pointId, coords, pointNote, onSaved }: Props) {
  const init = existing ? new Date(existing.scheduled_at) : defaultDate()
  const [dateStr, setDateStr] = useState(toDateInput(init))
  const [timeStr, setTimeStr] = useState(toTimeInput(init))
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
      const scheduled_at = new Date(`${dateStr}T${timeStr}`).toISOString()
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

          <div className="drawer-body" data-vaul-no-drag>
          <div className="field-grid">
            <div>
              <p className="eyebrow field-label">Date</p>
              <input
                className="field-input"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div>
              <p className="eyebrow field-label">Heure</p>
              <select
                className="field-input tnum"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
              >
                {/* RDV existant à une heure hors créneaux (ancien picker) :
                    son heure exacte reste proposée, rien ne se déplace. */}
                {!TIME_SLOTS.includes(timeStr) && <option value={timeStr}>{timeStr}</option>}
                {TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
