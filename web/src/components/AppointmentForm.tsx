import { useEffect, useState } from 'react'
import { Sheet } from './ui/Sheet'
import { toast } from 'sonner'
import { CalendarX, MapPin, Trash2 } from 'lucide-react'
import { FormGroup, FormRow } from './ui/Form'
import { bookRdvFor, createAppointment, deleteAppointment, updateAppointment } from '../data/appointments'
import { addPointNote, syncPointClient } from '../data/points'
import { searchAddresses, type AddressResult } from './AddressSearch'
import type { Appointment, AppointmentKind } from '../domain/appointments'
import { isSecretaireRole, isSupervisorRole, type Profile } from '../domain/types'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'

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
  /** Titulaire proposé à la secrétaire (matrice v2, 20/09) : le propriétaire
      du point (fiche) ou celui du RDV annulé (Replanifier). */
  defaultCommercialId?: string | null
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
  defaultCommercialId,
  onSaved,
}: Props) {
  const isTache = (existing?.kind ?? kind) === 'tache'
  // Secrétaire (matrice v2, db/0024) : elle prend, décale, réattribue et
  // annule des RDV AU NOM d'un commercial — sélecteur obligatoire, comme
  // dans « Nouveau contact ». Jamais d'issue terrain ni de tâche.
  const secretaire = isSecretaireRole(profile.role)
  const [ownerId, setOwnerId] = useState(existing?.commercial_id ?? defaultCommercialId ?? '')
  const [team, setTeam] = useState<OrgProfile[]>([])
  useEffect(() => {
    if (!secretaire) return
    fetchOrgProfiles()
      .then((profs) =>
        setTeam(
          profs
            .filter((p) => !p.disabled_at && p.role !== 'secretaire')
            .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')),
        ),
      )
      .catch((e) => console.error('Profils :', e))
  }, [secretaire])
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
  // « Annuler ce RDV » (20/09) : un RDV « à venir » s'annule depuis l'édition,
  // quelle que soit sa date — avant, hors du jour J, la seule issue était la
  // suppression (historique perdu). Titulaire, superviseur, secrétaire.
  const [confirmCancel, setConfirmCancel] = useState(false)
  const canCancel =
    !!existing && !isTache && existing.status === 'a_venir' && (canDelete || secretaire)

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
    if (secretaire && !isTache && !ownerId) {
      toast.error('Choisissez le commercial du rendez-vous')
      return
    }
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
        // Réattribution (secrétaire, 20/09) : le RDV change de titulaire —
        // la RLS exige un membre de l'agence (db/0024).
        const reassign: { commercial_id?: string } =
          secretaire && ownerId && ownerId !== existing.commercial_id ? { commercial_id: ownerId } : {}
        if (Object.keys(changes).length || reassign.commercial_id) {
          await updateAppointment(existing.id, { ...changes, ...reassign })
        }
      } else if (secretaire && pointId) {
        // Client existant : RDV + bascule « RDV pris » + journal AU NOM du
        // commercial, en UNE transaction (book_rdv_for, db/0024).
        await bookRdvFor({
          point_id: pointId,
          commercial_id: ownerId,
          scheduled_at,
          ...payload,
        })
      } else {
        await createAppointment(profile, {
          point_id: pointId ?? null,
          scheduled_at,
          ...payload,
          ...(isTache ? { kind: 'tache' as const } : {}),
          ...(secretaire && ownerId ? { commercial_id: ownerId } : {}),
        })
      }
      // Le point lié hérite du contexte saisi ici (fiche maison cohérente) :
      // nom du client synchronisé, note du RDV ajoutée au journal de la
      // maison (à la création seulement, pour ne pas dupliquer à chaque
      // modification). Best effort : un échec n'annule pas le RDV.
      // Secrétaire : la synchro nom/téléphone est faite par book_rdv_for à la
      // création ; ensuite elle n'a aucun droit d'UPDATE sur le point, et la
      // note reste celle du RDV (pas une note terrain signée d'elle).
      const linkedPointId = existing ? existing.point_id : (pointId ?? null)
      if (linkedPointId && !secretaire) {
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isTache
                ? existing
                  ? 'Modifier la tâche'
                  : 'Nouvelle tâche'
                : existing
                  ? 'Modifier le RDV'
                  : 'Nouveau rendez-vous'}
    >
      {/* Tâche : la note EST le titre — elle ouvre le formulaire et
          s'affiche en gras dans l'agenda. */}
      {isTache && (
        <>
          <FormGroup title="Quoi faire">
            <textarea
              className="form-input"
              rows={2}
              placeholder="Ex : aller chercher l’acompte, récupérer le panneau…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormGroup>
        </>
      )}
      {/* Les presets « Demain / Après-demain / Samedi » (A15) ont été
          RETIRÉS (décision briac 25/07) : de la place pour rien — la
          roue iOS suffit. */}
      {secretaire && !isTache && (
        <FormGroup
          hint={
            existing
              ? 'Changer de commercial déplace le RDV dans son agenda.'
              : 'Le RDV appartiendra à ce commercial (son agenda, ses stats).'
          }
        >
          <FormRow label="Commercial" select>
          <select
            className="form-input"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {team.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? 'Sans nom'}
              </option>
            ))}
          </select>
          </FormRow>
        </FormGroup>
      )}
      <FormGroup title="Quand">
        <FormRow label="Date">
          <input
            className="form-input"
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </FormRow>
        <FormRow label="Heure" select>
          <select
            className="form-input tnum"
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
        </FormRow>
      </FormGroup>

      <FormGroup title="Client">
        <FormRow label="Nom">
          <input
            className="form-input"
            type="text"
            placeholder={isTache ? 'Facultatif' : 'M. et Mme Dupont'}
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </FormRow>
        <FormRow label="Téléphone">
          <input
            className="form-input"
            type="tel"
            placeholder="06 …"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
          />
        </FormRow>
        <FormRow label="Adresse">
      <input
        className="form-input"
        type="text"
        placeholder="Rue, ville"
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
        </FormRow>
      </FormGroup>
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
          <FormGroup title="Note du RDV">
            <textarea
              className="form-input"
              rows={2}
              placeholder="Ex : sonner 2 fois, passer par l’arrière, devis à préparer…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormGroup>
        </>
      )}

      {canCancel && (
        <button
          type="button"
          className="text-btn drawer-delete"
          disabled={saving}
          onClick={async () => {
            if (!confirmCancel) {
              setConfirmCancel(true)
              window.setTimeout(() => setConfirmCancel(false), 4000)
              return
            }
            setSaving(true)
            try {
              await updateAppointment(existing!.id, { status: 'annule' })
              toast('RDV annulé : il reste dans l’historique, « Replanifier » est proposé')
              onOpenChange(false)
              onSaved()
            } catch (e) {
              console.error('Annulation :', e)
              toast.error('Annulation impossible : vérifiez le réseau')
            } finally {
              setSaving(false)
            }
          }}
        >
          <CalendarX size={14} strokeWidth={1.8} />{' '}
          {confirmCancel ? 'Confirmer l’annulation ?' : 'Annuler ce RDV'}
        </button>
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
              toast.error('Suppression impossible : vérifiez le réseau')
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
          disabled={saving || (isTache && !notes.trim()) || (secretaire && !isTache && !ownerId)}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </Sheet>
  )
}
