import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { CalendarClock, MapPin, Navigation, Pencil, Phone, StickyNote, X } from 'lucide-react'
import { fetchPoint, fetchPointPans } from '../data/points'
import {
  lidarNeedsMeasure,
  suggestedWastePct,
  type RoofData,
} from '../domain/house'
import type { LidarResult } from '../data/lidar'
import type { MapPoint } from '../domain/types'
import { APPOINTMENT_STATUS_META, type Appointment } from '../domain/appointments'
import { HouseBadges } from './HouseBadges'
import { Roof3D } from './Roof3D'
import { RoofDiagram } from './RoofDiagram'
import { RoofReport } from './RoofReport'

// -----------------------------------------------------------------------------
// Fiche CLIENT de l'agenda (vue « Clients ») : tout ce qu'un commercial doit
// avoir sous la main avant de sonner — coordonnées, RDV, notes, et la maison
// (badges, maquette 3D, plan coté, rapport). Réutilise les mêmes briques que
// la fiche point de la carte ; la mesure se backfille toute seule au besoin.
// -----------------------------------------------------------------------------

interface Props {
  appt: Appointment
  onOpenChange: (open: boolean) => void
  /** Ferme la fiche et ouvre le formulaire de modification du RDV. */
  onEdit: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
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

export function ClientSheet({ appt, onOpenChange, onEdit, onShowOnMap }: Props) {
  const [point, setPoint] = useState<MapPoint | null>(null)
  const [pans, setPans] = useState<RoofData | null>(null)
  const [liveLidar, setLiveLidar] = useState<LidarResult | null>(null)
  const [lidarPending, setLidarPending] = useState(false)
  const pointId = appt.point?.id ?? null

  useEffect(() => {
    setPoint(null)
    setPans(null)
    setLiveLidar(null)
    setLidarPending(false)
    if (!pointId) return
    let active = true
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

  const meta = APPOINTMENT_STATUS_META[appt.status]
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
    <Drawer.Root open onOpenChange={onOpenChange} modal={false}>
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
              />
              {roof && (
                <>
                  <Roof3D roof={roof} wastePct={wastePct} />
                  <RoofDiagram roof={roof} />
                  <RoofReport
                    roof={roof}
                    address={address}
                    maisonM2={lidarM2}
                    totalM2={lidarTotal}
                    millesime={lidarMillesime}
                    wastePct={wastePct}
                  />
                </>
              )}
            </>
          )}

          <div className="drawer-actions">
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
