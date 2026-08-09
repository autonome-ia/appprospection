import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { MapPin, Trash2, X } from 'lucide-react'
import { createAppointment, deleteAppointment, updateAppointment } from '../data/appointments'
import { addPointNote, syncPointClient } from '../data/points'
import { searchAddresses, type AddressResult } from './AddressSearch'
import type { Appointment, AppointmentKind } from '../domain/appointments'
import { isSupervisorRole, type Profile } from '../domain/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  existing?: Appointment | null
  pointId?: string | null
  coords?: { lng: number; lat: number } | null
  /** Note terrain du point lié (affichée en contexte, non éditable ici). */
  pointNote?: string | null
  /** Nom client du point lié : pré-rempli à la création (audit UX A5 —
      la synchro existait dans l'autre sens mais le champ arrivait vide). */
  defaultClientName?: string | null
  /** Téléphone du point lié : même logique (audit UX B10). */
  defaultClientPhone?: string | null
  /** Date/heure proposée à la création (sheet du jour : RDV pré-daté). */
  defaultAt?: Date | null
  /** Tâche d'agenda (29/07) : la note devient le titre (« quoi faire »),
      client/adresse facultatifs, ni point ni issues, hors stats. En
      édition, la nature vient de `existing.kind`. */
  kind?: AppointmentKind
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
// Exporté : le formulaire « Nouveau contact » propose les mêmes créneaux.
export const TIME_SLOTS: string[] = []
for (let h = 7; h <= 21; h++) {
  TIME_SLOTS.push(`${pad(h)}:00`)
  if (h < 21) TIME_SLOTS.push(`${pad(h)}:30`)
}

export function AppointmentForm({
  open,
  onOpenChange,
  profile,
  existing,
  pointId,
  coords,
  pointNote,
  defaultClientName,
  defaultClientPhone,
  defaultAt,
  kind = 'rdv',
  onSaved,
}: Props) {
  const isTache = (existing?.kind ?? kind) === 'tache'
  const init = existing ? new Date(existing.scheduled_at) : (defaultAt ?? defaultDate())
  const [dateStr, setDateStr] = useState(toDateInput(init))
  const [timeStr, setTimeStr] = useState(toTimeInput(init))
  const [clientName, setClientName] = useState(existing?.client_name ?? defaultClientName ?? '')
  const [clientPhone, setClientPhone] = useState(existing?.client_phone ?? defaultClientPhone ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  // Autocomplétion BAN sur l'adresse (audit UX B12) : un RDV pris depuis
  // l'agenda partait avec une adresse libre, potentiellement fautive — Waze
  // géocodait au petit bonheur. Recherche seulement quand le champ a le
  // focus (les pré-remplissages ne déclenchent rien).
  const [addrFocus, setAddrFocus] = useState(false)
  const [addrResults, setAddrResults] = useState<AddressResult[]>([])
  const [addrOpen, setAddrOpen] = useState(false)
  // Suppression (RDV comme tâche) : le lien danger 2 taps vit dans
  // l'édition depuis la convergence 29/07 (l'ancienne fiche client, qui le
  // portait, a disparu — un seul endroit, cohérent). Titulaire/manager
  // seulement : la RLS refuse les autres, on ne leur propose pas.
  const [confirmDel, setConfirmDel] = useState(false)
  const canDelete =
    !!existing && (isSupervisorRole(profile.role) || existing.commercial_id === profile.id)

  useEffect(() => {
    if (!addrFocus) return
    const q = address.trim()
    if (q.length < 3) {
      setAddrResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      searchAddresses(q, ctrl.signal)
        .then((rs) => {
          setAddrResults(rs)
          setAddrOpen(true)
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') console.error('Recherche adresse :', e)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [address, addrFocus])

  const chooseAddress = (r: AddressResult) => {
    setAddress(r.label) // label normalisé BAN : Waze et la recherche tombent juste
    setAddrResults([])
    setAddrOpen(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

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
        // N'envoyer QUE les champs modifiés : l'agenda est partagé temps réel,
        // renvoyer tout l'instantané écrasait les modifications faites par un
        // collègue pendant que le formulaire était ouvert (audit).
        const changes: Partial<typeof payload & { scheduled_at: string }> = {}
        if (new Date(existing.scheduled_at).getTime() !== new Date(scheduled_at).getTime()) {
          changes.scheduled_at = scheduled_at
        }
        if (payload.client_name !== (existing.client_name ?? null)) changes.client_name = payload.client_name
        if (payload.client_phone !== (existing.client_phone ?? null)) changes.client_phone = payload.client_phone
        if (payload.address !== (existing.address ?? null)) changes.address = payload.address
        if (payload.notes !== (existing.notes ?? null)) changes.notes = payload.notes
        if (Object.keys(changes).length) await updateAppointment(existing.id, changes)
      } else {
        await createAppointment(profile, {
          point_id: pointId ?? null,
          scheduled_at,
          ...payload,
          ...(isTache ? { kind: 'tache' as const } : {}),
        })
      }
      // Le point lié hérite du contexte saisi ici (fiche maison cohérente) :
      // nom du client synchronisé, note du RDV ajoutée au journal de la
      // maison (à la création seulement, pour ne pas dupliquer à chaque
      // modification). Best effort : un échec n'annule pas le RDV.
      const linkedPointId = existing ? existing.point_id : (pointId ?? null)
      if (linkedPointId) {
        // Synchronisés SEULEMENT s'ils ont réellement changé dans CE
        // formulaire : décaler l'heure d'un RDV repoussait l'ancien nom sur
        // le point, écrasant une correction faite entre-temps sur la fiche
        // (contre-audit, bug 10). L'effacement (null) se propage aussi.
        const nameChanged = existing
          ? (clientName.trim() || null) !== (existing.client_name ?? null)
          : clientName.trim().length > 0
        const phoneChanged = existing
          ? (clientPhone.trim() || null) !== (existing.client_phone ?? null)
          : clientPhone.trim().length > 0 && (clientPhone.trim() || null) !== (defaultClientPhone ?? null)
        if (nameChanged || phoneChanged) {
          syncPointClient(linkedPointId, {
            ...(nameChanged ? { client_name: clientName.trim() || null } : {}),
            ...(phoneChanged ? { client_phone: clientPhone.trim() || null } : {}),
          }).catch((e) => console.error('Synchro client du point :', e))
        }
        if (!existing && notes.trim()) {
          addPointNote(profile, linkedPointId, notes.trim()).catch((e) =>
            console.error('Note du RDV vers le journal :', e),
          )
        }
      }
      onOpenChange(false)
      onSaved()
      toast.success(
        isTache ? (existing ? 'Tâche modifiée' : 'Tâche enregistrée') : existing ? 'RDV modifié' : 'RDV enregistré',
      )
    } catch (e) {
      console.error('Enregistrement RDV :', e)
      toast.error(isTache ? 'Erreur lors de l’enregistrement de la tâche' : 'Erreur lors de l’enregistrement du RDV')
    } finally {
      setSaving(false)
    }
  }

  return (
    // repositionInputs={false} : voir PointDetailSheet (bug visualViewport iOS).
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">
              {isTache
                ? existing
                  ? 'Modifier la tâche'
                  : 'Nouvelle tâche'
                : existing
                  ? 'Modifier le RDV'
                  : 'Nouveau rendez-vous'}
            </span>
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
          {/* Tâche : la note EST le titre — elle ouvre le formulaire et
              s'affiche en gras dans l'agenda. */}
          {isTache && (
            <>
              <p className="eyebrow field-label">Quoi faire</p>
              <textarea
                className="field-input"
                rows={2}
                placeholder="Ex : aller chercher l’acompte, récupérer le panneau…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </>
          )}
          {/* Les presets « Demain / Après-demain / Samedi » (A15) ont été
              RETIRÉS (décision briac 25/07) : de la place pour rien — la
              roue iOS suffit. */}
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
                placeholder={isTache ? 'Nom (facultatif)' : 'Nom'}
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
            autoComplete="off"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setAddrFocus(true)}
            onBlur={() => {
              setAddrFocus(false)
              // Différé : le tap sur une suggestion doit gagner contre le blur.
              window.setTimeout(() => setAddrOpen(false), 150)
            }}
          />
          {addrOpen && addrResults.length > 0 && (
            // Liste EN FLUX (pas de dropdown absolu : le corps de la sheet
            // défile, un overlay serait rogné) — même style que la carte.
            <ul className="address-results form-address-results">
              {addrResults.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseAddress(r)}
                  >
                    <MapPin size={15} strokeWidth={1.8} className="address-result-icon" />
                    <span className="address-texts">
                      <span className="address-label">{r.label}</span>
                      {r.context && <span className="address-context">{r.context}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(pointNote ?? existing?.point?.notes) && (
            <>
              <p className="eyebrow field-label">Note du point (terrain)</p>
              <p className="form-context-note">{pointNote ?? existing?.point?.notes}</p>
            </>
          )}

          {!isTache && (
            <>
              <p className="eyebrow field-label">Note du RDV</p>
              <textarea
                className="field-input"
                rows={2}
                placeholder="Ex : sonner 2 fois, passer par l’arrière, devis à préparer…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </>
          )}

          {canDelete && (
            <button
              type="button"
              className="text-btn danger drawer-delete"
              disabled={saving}
              onClick={async () => {
                if (!confirmDel) {
                  setConfirmDel(true)
                  window.setTimeout(() => setConfirmDel(false), 4000)
                  return
                }
                setSaving(true)
                try {
                  await deleteAppointment(existing!.id)
                  toast(isTache ? 'Tâche supprimée' : 'RDV supprimé')
                  onOpenChange(false)
                  onSaved()
                } catch (e) {
                  console.error('Suppression :', e)
                  toast.error('Suppression impossible — vérifiez le réseau')
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Trash2 size={14} strokeWidth={1.8} />{' '}
              {confirmDel
                ? 'Confirmer la suppression ?'
                : isTache
                  ? 'Supprimer la tâche'
                  : 'Supprimer le RDV'}
            </button>
          )}

          <div className="drawer-footer">
            <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || (isTache && !notes.trim())}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
