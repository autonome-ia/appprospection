import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CalendarPlus, Navigation, Pencil, Phone } from 'lucide-react'
import { setAppointmentOutcome } from '../data/appointments'
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_STATUS_META,
  FOLLOW_UP_OUTCOMES,
  outcomeToastMessage,
  type Appointment,
  type AppointmentStatus,
} from '../domain/appointments'
import { wazeUrl } from '../lib/nav'
import { isSecretaireRole, isSupervisorRole, type MapPoint, type Profile } from '../domain/types'

// -----------------------------------------------------------------------------
// Section « Rendez-vous » STANDARD (fusion des fiches, 29/07 soir) : le même
// bloc partout — fiche prospect (Accueil, planning du jour, Contacts) ET fiche
// du point sur la carte. Date + issue éventuelle, BOUTONS D'ISSUE dès le jour
// J (le trou n° 1 de l'audit : impossible de solder depuis la carte),
// Modifier / Planifier, et le bandeau « Aucun RDV planifié » (filet
// anti-prospect-perdu). Le vocabulaire de statut du POINT vit dans la fiche ;
// ici on ne parle que du RDV (date, issue).
// -----------------------------------------------------------------------------

interface Props {
  /** Point lié (badge/coords) — null : RDV libre sans point. */
  point: MapPoint | null
  /** RDV du point, triés par date croissante — null = chargement en cours. */
  appts: Appointment[] | null
  profile: Profile
  /** Une issue a été donnée : les écrans parents rechargent. */
  onChanged?: () => void
  /** Décaler le RDV « à venir » (édition, jamais un 2e RDV). */
  onEdit?: (a: Appointment) => void
  /** Planifier un RDV pour un point « RDV pris » qui n'en a plus. */
  onPlan?: () => void
  /** Liens Appeler / Y aller dans le bloc (fiche carte : le téléphone et
      l'adresse ne sont pas affichés ailleurs — la fiche prospect, si). */
  showNav?: boolean
}

/** « Sam. 26 juil. · 16:00 » — l'heure séparée par un point médian. */
function formatRdvWhen(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`
}

/** Fin de la journée courante — les issues ne sont tapables que du jour J
    vers le passé (audit UX A11 : à J-15, un tap raté écrivait des stats). */
function endOfToday(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function RdvSection({ point, appts, profile, onChanged, onEdit, onPlan, showNav }: Props) {
  const [busy, setBusy] = useState(false)
  // Chacun ses RDV (retour chef des ventes, 10/08) : issues et « Modifier »
  // réservés au TITULAIRE du RDV et aux superviseurs — la secrétaire reste
  // en lecture partout. La RLS refuse déjà les autres ; on ne montre plus
  // des boutons qui échouent.
  const secretaire = isSecretaireRole(profile.role)
  const supervisor = isSupervisorRole(profile.role)
  // « Planifier » (point « RDV pris » sans RDV) : l'auteur du point ou un
  // superviseur — pas un collègue de passage sur la fiche.
  const canPlan =
    !secretaire &&
    (supervisor || !point || point.created_by === null || point.created_by === profile.id)
  // Issue donnée depuis CE bloc : reflétée sans attendre le reload du parent.
  const [override, setOverride] = useState<{ id: string; status: AppointmentStatus } | null>(null)
  useEffect(() => {
    setOverride(null)
  }, [point?.id])

  // RDV mis en avant : le prochain « à venir » (1 h de grâce : un RDV en
  // cours reste LE rendez-vous), sinon le plus récent avec son issue.
  const shownRdv = useMemo(() => {
    if (!appts?.length) return null
    const upcoming = appts.find(
      (a) => a.status === 'a_venir' && new Date(a.scheduled_at).getTime() >= Date.now() - 3_600_000,
    )
    return upcoming ?? appts[appts.length - 1]
  }, [appts])

  const shownStatus =
    shownRdv && override?.id === shownRdv.id ? override.status : (shownRdv?.status ?? null)
  // Trou silencieux (audit UX B1) : un point « RDV pris » sans AUCUN RDV « à
  // venir » — même quand un ancien RDV soldé s'affiche au-dessus.
  const missing =
    appts !== null &&
    point?.status === 'rdv_pris' &&
    !appts.some((a) => (override?.id === a.id ? override.status : a.status) === 'a_venir')
  const missingBanner = missing ? (
    <div className="rdv-missing">
      <span>Aucun RDV planifié pour ce point</span>
      {onPlan && canPlan && (
        <button type="button" className="text-btn" onClick={onPlan}>
          {/* « Replanifier » quand un ancien RDV existe (annulé, en attente…)
              — le mot dit le geste (retour briac 29/07). */}
          <CalendarPlus size={14} /> {appts?.length ? 'Replanifier' : 'Planifier'}
        </button>
      )}
    </div>
  ) : null

  if (!shownRdv || shownStatus === null) return missingBanner

  const canAct = !secretaire && (supervisor || shownRdv.commercial_id === profile.id)

  // RDV encore modifiable = « à venir » (même passé de date : un RDV oublié
  // se DÉCALE, on n'en recrée pas un deuxième — piège corrigé le 29/07).
  const editable = shownStatus === 'a_venir' ? shownRdv : null
  const phone = shownRdv.client_phone ?? point?.client_phone ?? null
  const waze = wazeUrl(point ?? shownRdv.point, shownRdv.address ?? point?.address ?? null)
  // Issues proposées : toutes dès le jour J sur un RDV « à venir » ; et
  // « EN ATTENTE » EST UN ÉTAT OUVERT (retour briac 29/07 soir) — le
  // prospect réfléchit, « Vendu » / « Refus » restent proposés SANS limite
  // de date (la relance J+7 de l'Accueil ramène ici, un tap conclut, la
  // vente différée est comptée sur CE RDV). Vendu / Refus / Annulé = fins.
  const outcomes =
    shownStatus === 'a_venir' && Date.parse(shownRdv.scheduled_at) <= endOfToday()
      ? APPOINTMENT_OUTCOMES
      : shownStatus === 'effectue'
        ? FOLLOW_UP_OUTCOMES
        : null

  return (
    <>
    <div className="rdv-block">
      <span className="rdv-block-head">
        <span className="rdv-when">
          <CalendarClock size={15} strokeWidth={2} />
          {formatRdvWhen(shownRdv.scheduled_at)}
        </span>
        {shownStatus !== 'a_venir' && (
          <span
            className="rdv-outcome"
            style={{ color: APPOINTMENT_STATUS_META[shownStatus].color }}
          >
            {APPOINTMENT_STATUS_META[shownStatus].label}
          </span>
        )}
      </span>

      {/* Solder SANS retraverser l'app (audit fusion) : mêmes issues, même
          règle jour J, quel que soit l'écran d'où la fiche est ouverte. */}
      {canAct && outcomes && (
        <div className="appt-outcomes">
          {outcomes.map((o) => {
            const m = APPOINTMENT_STATUS_META[o]
            return (
              <button
                key={o}
                type="button"
                className="outcome-btn"
                style={{ color: m.color, borderColor: `${m.color}55` }}
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    const { pointSynced } = await setAppointmentOutcome(profile, shownRdv, o)
                    setOverride({ id: shownRdv.id, status: o })
                    onChanged?.()
                    toast.success(outcomeToastMessage(o))
                    if (!pointSynced) {
                      toast.error(
                        'La maison n’a pas pu être mise à jour sur la carte : rouvrez sa fiche pour corriger',
                      )
                    }
                  } catch (e) {
                    console.error('Issue du RDV :', e)
                    toast.error('Issue non enregistrée : vérifiez le réseau')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      )}

      {((showNav && (phone || waze)) || (editable && onEdit && canAct)) && (
        <span className="rdv-actions">
          {showNav && phone && (
            <a className="text-btn" href={`tel:${phone}`}>
              <Phone size={14} /> Appeler
            </a>
          )}
          {showNav && waze && (
            <a className="text-btn" href={waze} target="_blank" rel="noopener noreferrer">
              <Navigation size={14} /> Y aller
            </a>
          )}
          {editable && onEdit && canAct && (
            <button type="button" className="text-btn" onClick={() => onEdit(editable)}>
              <Pencil size={14} /> Modifier
            </button>
          )}
        </span>
      )}
    </div>
    {missingBanner}
    </>
  )
}
