import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { History, MapPin, Navigation, Phone, StickyNote, Trash2, X } from 'lucide-react'
import { fetchPoint, fetchPointNotes, fetchPointPans, type PointNote } from '../data/points'
import { deleteAppointment, fetchPointAppointments } from '../data/appointments'
import { lidarNeedsMeasure, suggestedWastePct, type RoofData } from '../domain/house'
import type { LidarResult } from '../data/lidar'
import type { MapPoint, Profile } from '../domain/types'
import { APPOINTMENT_STATUS_META, type Appointment } from '../domain/appointments'
import { STATUS_BY_VALUE } from '../domain/status'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import { RdvSection } from './RdvSection'
import { firstNameOf } from '../domain/names'
import { wazeUrl } from '../lib/nav'

// -----------------------------------------------------------------------------
// Fiche PROSPECT unifiée (fusion ClientSheet + ContactSheet, 29/07 soir —
// audit briac : « plein de modals différents »). UNE seule fiche, ancrée sur
// le POINT, quelle que soit la porte d'entrée : Accueil (Mes RDV), planning
// du jour, vue Contacts. Section RDV standard (issues jour J comprises),
// badge au VOCABULAIRE DU POINT, coordonnées, journal, maison/toiture 3D.
// La fiche du point sur la carte (PointDetailSheet) reste distincte — elle
// ÉDITE le point — mais monte la même section RDV.
// -----------------------------------------------------------------------------

interface Props {
  /** Point du prospect (vue Contacts) — si absent, il est chargé depuis
      `appt.point` (peut rester null : RDV libre sans point). */
  point?: MapPoint | null
  /** RDV d'ancrage (Accueil, planning du jour) : Supprimer s'y rapporte. */
  appt?: Appointment | null
  profile: Profile
  onOpenChange: (open: boolean) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  /** Ferme la fiche et ouvre le formulaire RDV en édition (règle vaul iOS :
      pas d'empilement de drawers). */
  onEditRdv?: (a: Appointment) => void
  /** Planifier un RDV pour un point « RDV pris » qui n'en a plus. */
  onPlanRdv?: (point: MapPoint) => void
  /** Issue donnée / RDV supprimé : les écrans parents rechargent. */
  onChanged?: () => void
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  )

const fmtShort = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export function ProspectSheet({
  point: givenPoint,
  appt,
  profile,
  onOpenChange,
  onShowOnMap,
  onEditRdv,
  onPlanRdv,
  onChanged,
}: Props) {
  const pointId = givenPoint?.id ?? appt?.point?.id ?? null
  const [point, setPoint] = useState<MapPoint | null>(givenPoint ?? null)
  const [appts, setAppts] = useState<Appointment[] | null>(null)
  const [notes, setNotes] = useState<PointNote[]>([])
  const [pans, setPans] = useState<RoofData | null>(null)
  const [liveLidar, setLiveLidar] = useState<LidarResult | null>(null)
  const [lidarPending, setLidarPending] = useState(false)
  const [busy, setBusy] = useState(false)
  // Suppression en deux taps (audit UX A32) du RDV d'ancrage.
  const [confirmDel, setConfirmDel] = useState(false)
  const canDelete =
    !!appt && (profile.role === 'manager' || appt.commercial_id === profile.id)

  useEffect(() => {
    setPoint(givenPoint ?? null)
    setAppts(null)
    setNotes([])
    setPans(null)
    setLiveLidar(null)
    setLidarPending(false)
    if (!pointId) {
      // RDV libre sans point : la section RDV vit sur le RDV d'ancrage seul.
      if (appt) setAppts([appt])
      return
    }
    let active = true
    fetchPointAppointments(pointId)
      .then((as) => {
        if (active) setAppts(as)
      })
      .catch((e) => console.error('RDV du point :', e))
    fetchPointNotes(pointId)
      .then((ns) => {
        if (active) setNotes(ns)
      })
      .catch((e) => console.error('Journal de notes :', e))
    const withPoint = (p: MapPoint) => {
      if (p.toit_lidar_statut === 'ok') {
        fetchPointPans(p.id)
          .then((ps) => {
            if (active) setPans(ps)
          })
          .catch((e) => console.error('Pans du point :', e))
      }
      // Mesure absente, périmée ou en erreur : backfill paresseux (cache
      // par coordonnées partagé).
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
    }
    if (givenPoint) withPoint(givenPoint)
    else {
      fetchPoint(pointId)
        .then((p) => {
          if (!active || !p) return
          setPoint(p)
          withPoint(p)
        })
        .catch((e) => console.error('Fiche prospect :', e))
    }
    return () => {
      active = false
    }
    // Rejoue sur le prospect, pas sur l'identité des objets (realtime).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, appt?.id])

  const status = point ? STATUS_BY_VALUE[point.status] : null
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

  const clientName = point?.client_name ?? appt?.client_name ?? null
  const phone = point?.client_phone ?? appt?.client_phone ?? null
  const address = point?.address ?? appt?.address ?? null
  const waze = wazeUrl(point ?? appt?.point, address)
  // Note du RDV d'ancrage : contexte affiché si le journal ne la porte pas.
  const apptNote =
    appt?.notes && !notes.some((n) => n.body.trim() === appt.notes!.trim()) ? appt.notes : null

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
            <span className="drawer-title">{clientName ?? address ?? 'Contact'}</span>
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
            {/* Section RDV STANDARD (la même que la fiche carte) : date +
                issue, boutons d'issue dès le jour J, Modifier / Planifier. */}
            <RdvSection
              point={point}
              appts={appts}
              profile={profile}
              onChanged={onChanged}
              onEdit={onEditRdv}
              onPlan={point && onPlanRdv ? () => onPlanRdv(point) : undefined}
            />

            <div className="client-info">
              {/* Vocabulaire du POINT (décision briac, audit fusion) : le
                  badge dit l'état de la maison — l'issue du RDV vit dans la
                  section RDV. Relance datée affichée pour « À revoir ». */}
              {status && (
                <div className="client-row">
                  <History size={15} strokeWidth={1.9} />
                  <span>
                    {point?.status === 'a_revoir' && point.revisit_at
                      ? `À revoir le ${fmtDay(point.revisit_at)} `
                      : null}
                    <span
                      className="badge"
                      style={{ color: status.color, background: `${status.color}1a` }}
                    >
                      {status.label}
                    </span>
                  </span>
                </div>
              )}
              {phone && (
                <div className="client-row">
                  <Phone size={15} strokeWidth={1.9} />
                  <a href={`tel:${phone}`}>{phone}</a>
                </div>
              )}
              {address && waze && (
                <div className="client-row">
                  <MapPin size={15} strokeWidth={1.9} />
                  <a
                    href={waze}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Itinéraire en voiture (Waze)"
                  >
                    {address}
                    <Navigation size={13} strokeWidth={2} className="client-waze" />
                  </a>
                </div>
              )}
              {apptNote && (
                <div className="client-row">
                  <StickyNote size={15} strokeWidth={1.9} />
                  <span>{apptNote}</span>
                </div>
              )}
              {/* Repli local : journal vide mais note portée par le point. */}
              {notes.length === 0 && point?.note && (
                <div className="client-row is-context">
                  <StickyNote size={15} strokeWidth={1.9} />
                  <span>{point.note}</span>
                </div>
              )}
            </div>

            {/* Historique (audit UX B11) : les RDV du point (date + issue)
                et le journal de notes de la maison. */}
            {((appts?.length ?? 0) > 1 || notes.length > 0) && (
              <>
                <p className="eyebrow field-label">Historique</p>
                {(appts?.length ?? 0) > 1 && (
                  <div className="rdv-history">
                    {[...(appts ?? [])]
                      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
                      .map((h) => {
                        const hm = APPOINTMENT_STATUS_META[h.status]
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
                  // Repliée comme partout : la fiche sert d'abord à rappeler,
                  // la 3D s'ouvre en 1 tap pour argumenter.
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
                    await deleteAppointment(appt!.id)
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

            {point && onShowOnMap && (
              <div className="drawer-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onOpenChange(false)
                    onShowOnMap({ pointId: point.id, lng: point.lng, lat: point.lat })
                  }}
                >
                  <MapPin size={15} strokeWidth={1.9} /> Voir sur la carte
                </button>
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
