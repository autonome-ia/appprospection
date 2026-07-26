import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { CalendarClock, MapPin, Navigation, Pencil, Phone, StickyNote, Trash2, X } from 'lucide-react'
import { fetchPoint, fetchPointNotes, fetchPointPans, type PointNote } from '../data/points'
import { deleteAppointment, fetchPointAppointments, setAppointmentOutcome } from '../data/appointments'
import {
  lidarNeedsMeasure,
  suggestedWastePct,
  type RoofData,
} from '../domain/house'
import type { LidarResult } from '../data/lidar'
import type { MapPoint, Profile } from '../domain/types'
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_STATUS_META,
  type Appointment,
  type AppointmentStatus,
} from '../domain/appointments'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import { firstNameOf } from '../domain/names'

// -----------------------------------------------------------------------------
// Fiche CLIENT de l'agenda (vue « Clients ») : tout ce qu'un commercial doit
// avoir sous la main avant de sonner — coordonnées, RDV, notes, et la maison
// (badges, maquette 3D, plan coté, rapport). Réutilise les mêmes briques que
// la fiche point de la carte ; la mesure se backfille toute seule au besoin.
// -----------------------------------------------------------------------------

interface Props {
  appt: Appointment
  profile: Profile
  onOpenChange: (open: boolean) => void
  /** Ferme la fiche et ouvre le formulaire de modification du RDV. */
  onEdit: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  /** Une issue a été donnée depuis la fiche : l'agenda doit se recharger. */
  onChanged?: () => void
}

/**
 * Lien universel Waze (ouvre l'app en navigation, repli site web) : les
 * coordonnées du point priment sur l'adresse texte — c'est LA maison, pas
 * le géocodage approximatif du numéro de rue.
 */
export function wazeUrl(
  point: { lng: number; lat: number } | null | undefined,
  address: string | null,
): string | null {
  if (point) return `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`
  if (address) return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`
  return null
}

const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const fmtShort = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** Fin de la journée courante — les issues ne sont tapables que le jour J
    (même règle que la carte RDV de l'agenda, audit UX A11). */
function endOfToday(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function ClientSheet({ appt, profile, onOpenChange, onEdit, onShowOnMap, onChanged }: Props) {
  const [point, setPoint] = useState<MapPoint | null>(null)
  const [pans, setPans] = useState<RoofData | null>(null)
  const [liveLidar, setLiveLidar] = useState<LidarResult | null>(null)
  const [lidarPending, setLidarPending] = useState(false)
  // Historique client (audit UX B11) : TOUS les RDV du point + le journal de
  // notes de la maison — la fiche n'affichait qu'un RDV « représentatif » et
  // la dernière note, l'historique client était amputé.
  const [history, setHistory] = useState<Appointment[]>([])
  const [notes, setNotes] = useState<PointNote[]>([])
  // Issue donnée depuis CETTE fiche : reflétée sans attendre le reload
  // (l'objet appt du parent est figé tant que l'agenda n'a pas rechargé).
  const [statusOverride, setStatusOverride] = useState<AppointmentStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // Suppression en deux taps (audit UX A32), déplacée ici depuis la carte RDV
  // (refonte rail 26/07 : le bloc du jour reste léger, la gestion vit ici).
  const [confirmDel, setConfirmDel] = useState(false)
  // La RLS ne laisse supprimer que le titulaire ou un manager : proposer le
  // bouton aux autres produisait un faux « RDV supprimé » (audit).
  const canDelete = profile.role === 'manager' || appt.commercial_id === profile.id
  const pointId = appt.point?.id ?? null

  useEffect(() => {
    setStatusOverride(null)
  }, [appt.id])

  useEffect(() => {
    setPoint(null)
    setPans(null)
    setLiveLidar(null)
    setLidarPending(false)
    setHistory([])
    setNotes([])
    if (!pointId) return
    let active = true
    fetchPointAppointments(pointId)
      .then((as) => {
        if (active) setHistory([...as].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)))
      })
      .catch((e) => console.error('Historique des RDV :', e))
    fetchPointNotes(pointId)
      .then((ns) => {
        if (active) setNotes(ns)
      })
      .catch((e) => console.error('Journal de notes :', e))
    fetchPoint(pointId)
      .then((p) => {
        if (!active || !p) return
        setPoint(p)
        if (p.toit_lidar_statut === 'ok') {
          fetchPointPans(p.id)
            .then((ps) => {
              if (active) setPans(ps)
            })
            .catch((e) => console.error('Pans du point :', e))
        }
        // Mesure absente, périmée ou en erreur : backfill paresseux (même
        // pattern que la fiche point — cache par coordonnées partagé).
        if (lidarNeedsMeasure(p)) {
          setLidarPending(true)
          void import('../data/lidar')
            .then((m) => m.measurePointRoof(p.id, p.lng, p.lat))
            .then((r) => {
              // Une re-mesure en erreur ne masque pas un cache valide.
              if (active) {
                setLiveLidar(
                  r.toit_lidar_statut === 'error' && p.toit_lidar_statut === 'ok' ? null : r,
                )
              }
            })
            .catch((e) => console.error('Mesure LiDAR :', e))
            .finally(() => {
              if (active) setLidarPending(false)
            })
        }
      })
      .catch((e) => console.error('Fiche client :', e))
    return () => {
      active = false
    }
  }, [pointId])

  const shownStatus = statusOverride ?? appt.status
  const meta = APPOINTMENT_STATUS_META[shownStatus]
  const lidarStatut = liveLidar?.toit_lidar_statut ?? point?.toit_lidar_statut ?? null
  const lidarM2 =
    lidarStatut === 'ok'
      ? liveLidar
        ? liveLidar.toit_lidar_principal_m2 || liveLidar.toit_lidar_m2
        : (point?.toit_lidar_principal_m2 ?? null) || (point?.toit_lidar_m2 ?? null)
      : null
  const lidarTotal = liveLidar ? liveLidar.toit_lidar_m2 : (point?.toit_lidar_m2 ?? null)
  const lidarMillesime = liveLidar
    ? liveLidar.toit_lidar_millesime
    : (point?.toit_lidar_millesime ?? null)
  const roof = lidarStatut === 'ok' ? (liveLidar ? liveLidar.toit_lidar_pans : pans) : null
  const wastePct = suggestedWastePct(
    point?.mat_toit ?? null,
    point?.mat_toit_confirme ?? null,
    roof?.aretes,
  )
  const address = appt.address ?? point?.address ?? null

  return (
    // NON modale : un drawer modal vaul coupe les interactions hors de lui
    // (pointer-events) — le plein écran 3D et le rapport, portés dans <body>,
    // étaient totalement inertes (audit, bloquant).
    // repositionInputs={false} : voir PointDetailSheet (bug visualViewport iOS).
    <Drawer.Root open onOpenChange={onOpenChange} modal={false} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">{appt.client_name ?? address ?? 'Client'}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onOpenChange(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
          <div className="client-info">
            <div className="client-row">
              <CalendarClock size={15} strokeWidth={1.9} />
              <span>
                {fmtFull(appt.scheduled_at)}
                {'  '}
                <span
                  className="badge"
                  style={{ color: meta.color, background: `${meta.color}1a` }}
                >
                  {meta.label}
                </span>
              </span>
            </div>
            {appt.client_phone && (
              <div className="client-row">
                <Phone size={15} strokeWidth={1.9} />
                <a href={`tel:${appt.client_phone}`}>{appt.client_phone}</a>
              </div>
            )}
            {address && (
              <div className="client-row">
                <MapPin size={15} strokeWidth={1.9} />
                <a
                  href={wazeUrl(appt.point, address)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Itinéraire en voiture (Waze)"
                >
                  {address}
                  <Navigation size={13} strokeWidth={2} className="client-waze" />
                </a>
              </div>
            )}
            {appt.notes && (
              <div className="client-row">
                <StickyNote size={15} strokeWidth={1.9} />
                <span>{appt.notes}</span>
              </div>
            )}
            {appt.point?.notes && appt.point.notes.trim() !== (appt.notes ?? '').trim() && (
              <div className="client-row is-context">
                <StickyNote size={15} strokeWidth={1.9} />
                <span>{appt.point.notes}</span>
              </div>
            )}
          </div>

          {/* Issues du RDV du jour, accessibles SANS repasser par l'agenda
              (audit UX B11) — même règle jour J que la carte RDV. */}
          {shownStatus === 'a_venir' && Date.parse(appt.scheduled_at) <= endOfToday() && (
            <div className="appt-outcomes">
              {APPOINTMENT_OUTCOMES.map((o) => {
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
                        const { pointSynced } = await setAppointmentOutcome(profile, appt, o)
                        setStatusOverride(o)
                        onChanged?.()
                        toast.success(`RDV marqué « ${m.label} »`)
                        if (o === 'vendu' && appt.point_id && !pointSynced) {
                          toast.error(
                            'La maison n’a pas pu passer en « vendu » sur la carte — rouvrez sa fiche pour corriger',
                          )
                        }
                      } catch (e) {
                        console.error('Issue du RDV :', e)
                        toast.error('Issue non enregistrée — vérifiez le réseau')
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

          {/* Historique complet (audit UX B11) : les RDV du point (date +
              issue) et le journal de notes de la maison. */}
          {(history.length > 1 || notes.length > 0) && (
            <>
              <p className="eyebrow field-label">Historique</p>
              {history.length > 1 && (
                <div className="rdv-history">
                  {history.map((h) => {
                    const hm =
                      APPOINTMENT_STATUS_META[h.id === appt.id ? shownStatus : h.status]
                    return (
                      <div key={h.id} className="rdv-history-row">
                        <span className="rdv-history-when tnum">{fmtShort(h.scheduled_at)}</span>
                        <span
                          className="badge"
                          style={{ color: hm.color, background: `${hm.color}1a` }}
                        >
                          {hm.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {notes.length > 0 && (
                <ul className="note-history">
                  {notes.map((n) => {
                    // Date seule pour SES notes ; prénom (jamais l'email)
                    // pour celles d'un collègue (retour briac 25/07).
                    const who =
                      n.author_id && n.author_id !== profile.id
                        ? firstNameOf(n.author_name)
                        : null
                    const when = n.created_at ? fmtShort(n.created_at) : ''
                    return (
                      <li key={n.id} className="note-entry">
                        <span className="note-meta">{who ? `${who} · ${when}` : when}</span>
                        <span className="note-body">{n.body}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {point && (
            <>
              <p className="eyebrow field-label">La maison</p>
              <HouseBadges
                annee={point.annee_construction}
                matCode={point.mat_toit}
                matConfirme={point.mat_toit_confirme}
                toitM2={point.toit_surface_m2}
                lidarM2={lidarM2}
                lidarMillesime={lidarMillesime}
                lidarPending={lidarPending && lidarM2 == null}
                dpe={point.dpe_classe}
                extra={point.maison_extra}
                lidarStatut={lidarStatut}
                lidarDiag={liveLidar ? liveLidar.toit_lidar_diag : point.toit_lidar_diag}
                hideMeasured={roof !== null}
              />
              {roof && (
                // Repliée (audit UX B11) : les actions et l'historique
                // priment — le module s'ouvre en 1 tap pour argumenter.
                <RoofModule
                  roof={roof}
                  wastePct={wastePct}
                  address={address}
                  maisonM2={lidarM2}
                  totalM2={lidarTotal}
                  millesime={lidarMillesime}
                />
              )}
            </>
          )}

          {canDelete && (
            <button
              type="button"
              className="text-btn danger drawer-delete"
              disabled={busy}
              onClick={async () => {
                if (!confirmDel) {
                  setConfirmDel(true)
                  window.setTimeout(() => setConfirmDel(false), 4000)
                  return
                }
                setBusy(true)
                try {
                  await deleteAppointment(appt.id)
                  toast('RDV supprimé')
                  onChanged?.()
                  onOpenChange(false)
                } catch (e) {
                  console.error('Suppression du RDV :', e)
                  toast.error('Suppression impossible — vérifiez le réseau')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Trash2 size={14} strokeWidth={1.8} />{' '}
              {confirmDel ? 'Confirmer la suppression ?' : 'Supprimer le RDV'}
            </button>
          )}

          <div className="drawer-footer">
            {appt.point && onShowOnMap && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  onOpenChange(false)
                  onShowOnMap({
                    pointId: appt.point!.id,
                    lng: appt.point!.lng,
                    lat: appt.point!.lat,
                  })
                }}
              >
                <MapPin size={15} strokeWidth={1.9} /> Carte
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => onEdit(appt)}>
              <Pencil size={15} strokeWidth={1.9} /> Modifier le RDV
            </button>
          </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
