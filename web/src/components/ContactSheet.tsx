import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { CalendarClock, History, MapPin, Navigation, Phone, StickyNote, X } from 'lucide-react'
import { fetchPointNotes, fetchPointPans, type PointNote } from '../data/points'
import { lidarNeedsMeasure, suggestedWastePct, type RoofData } from '../domain/house'
import type { LidarResult } from '../data/lidar'
import type { MapPoint, Profile } from '../domain/types'
import type { Appointment } from '../domain/appointments'
import { STATUS_BY_VALUE } from '../domain/status'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import { firstNameOf } from '../domain/names'
import { wazeUrl } from './ClientSheet'

// -----------------------------------------------------------------------------
// Fiche CONTACT (vue « Contacts » de l'agenda, 27/07) : le prospect vu depuis
// son POINT — nom, téléphone (appel direct), adresse (Waze), prochain RDV ou
// relance, journal de notes, maison (badges + toiture mesurée). Contrairement
// à ClientSheet (fiche d'un RDV, flux planning du jour), elle existe pour les
// « À revoir » sans aucun RDV ; la gestion des RDV reste dans le flux agenda.
// -----------------------------------------------------------------------------

interface Props {
  point: MapPoint
  profile: Profile
  /** Prochain RDV « à venir » du point (calculé par l'écran), null sinon. */
  nextRdv: Appointment | null
  onOpenChange: (open: boolean) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}

const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

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

export function ContactSheet({ point, profile, nextRdv, onOpenChange, onShowOnMap }: Props) {
  const [notes, setNotes] = useState<PointNote[]>([])
  const [pans, setPans] = useState<RoofData | null>(null)
  const [liveLidar, setLiveLidar] = useState<LidarResult | null>(null)
  const [lidarPending, setLidarPending] = useState(false)

  useEffect(() => {
    setNotes([])
    setPans(null)
    setLiveLidar(null)
    setLidarPending(false)
    let active = true
    fetchPointNotes(point.id)
      .then((ns) => {
        if (active) setNotes(ns)
      })
      .catch((e) => console.error('Journal de notes :', e))
    if (point.toit_lidar_statut === 'ok') {
      fetchPointPans(point.id)
        .then((ps) => {
          if (active) setPans(ps)
        })
        .catch((e) => console.error('Pans du point :', e))
    }
    // Mesure absente, périmée ou en erreur : backfill paresseux (même pattern
    // que ClientSheet — cache par coordonnées partagé).
    if (lidarNeedsMeasure(point)) {
      setLidarPending(true)
      void import('../data/lidar')
        .then((m) => m.measurePointRoof(point.id, point.lng, point.lat))
        .then((r) => {
          if (active) {
            setLiveLidar(
              r.toit_lidar_statut === 'error' && point.toit_lidar_statut === 'ok' ? null : r,
            )
          }
        })
        .catch((e) => console.error('Mesure LiDAR :', e))
        .finally(() => {
          if (active) setLidarPending(false)
        })
    }
    return () => {
      active = false
    }
  }, [point])

  const status = STATUS_BY_VALUE[point.status]
  const lidarStatut = liveLidar?.toit_lidar_statut ?? point.toit_lidar_statut ?? null
  const lidarM2 =
    lidarStatut === 'ok'
      ? liveLidar
        ? liveLidar.toit_lidar_principal_m2 || liveLidar.toit_lidar_m2
        : (point.toit_lidar_principal_m2 ?? null) || (point.toit_lidar_m2 ?? null)
      : null
  const lidarTotal = liveLidar ? liveLidar.toit_lidar_m2 : (point.toit_lidar_m2 ?? null)
  const lidarMillesime = liveLidar
    ? liveLidar.toit_lidar_millesime
    : (point.toit_lidar_millesime ?? null)
  const roof = lidarStatut === 'ok' ? (liveLidar ? liveLidar.toit_lidar_pans : pans) : null
  const wastePct = suggestedWastePct(point.mat_toit, point.mat_toit_confirme, roof?.aretes)

  return (
    // NON modale + repositionInputs={false} : mêmes raisons que ClientSheet
    // (3D/rapport portés dans <body>, bug visualViewport iOS).
    <Drawer.Root open onOpenChange={onOpenChange} modal={false} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">{point.client_name ?? point.address ?? 'Contact'}</span>
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
              {/* L'échéance d'abord : c'est ce qu'on vient chercher dans une
                  liste de prospects. RDV pris -> prochain RDV ; À revoir ->
                  date de relance (ou statut seul si non datée). */}
              {nextRdv ? (
                <div className="client-row">
                  <CalendarClock size={15} strokeWidth={1.9} />
                  <span>
                    {fmtFull(nextRdv.scheduled_at)}{' '}
                    <span
                      className="badge"
                      style={{ color: status.color, background: `${status.color}1a` }}
                    >
                      {status.label}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="client-row">
                  <History size={15} strokeWidth={1.9} />
                  <span>
                    {point.status === 'a_revoir' && point.revisit_at
                      ? `À revoir le ${fmtDay(point.revisit_at)}`
                      : null}{' '}
                    <span
                      className="badge"
                      style={{ color: status.color, background: `${status.color}1a` }}
                    >
                      {status.label}
                    </span>
                  </span>
                </div>
              )}
              {point.client_phone && (
                <div className="client-row">
                  <Phone size={15} strokeWidth={1.9} />
                  <a href={`tel:${point.client_phone}`}>{point.client_phone}</a>
                </div>
              )}
              {point.address && (
                <div className="client-row">
                  <MapPin size={15} strokeWidth={1.9} />
                  <a
                    href={wazeUrl(point, point.address)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Itinéraire en voiture (Waze)"
                  >
                    {point.address}
                    <Navigation size={13} strokeWidth={2} className="client-waze" />
                  </a>
                </div>
              )}
              {/* Repli local : journal vide mais note portée par le point
                  (mode hors Supabase). */}
              {notes.length === 0 && point.note && (
                <div className="client-row">
                  <StickyNote size={15} strokeWidth={1.9} />
                  <span>{point.note}</span>
                </div>
              )}
            </div>

            {notes.length > 0 && (
              <>
                <p className="eyebrow field-label">Notes</p>
                <ul className="note-history">
                  {notes.map((n) => {
                    // Date seule pour SES notes ; prénom (jamais l'email)
                    // pour celles d'un collègue (retour briac 25/07).
                    const who =
                      n.author_id && n.author_id !== profile.id ? firstNameOf(n.author_name) : null
                    const when = n.created_at ? fmtShort(n.created_at) : ''
                    return (
                      <li key={n.id} className="note-entry">
                        <span className="note-meta">{who ? `${who} · ${when}` : when}</span>
                        <span className="note-body">{n.body}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

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
                address={point.address}
                maisonM2={lidarM2}
                totalM2={lidarTotal}
                millesime={lidarMillesime}
              />
            )}

            {onShowOnMap && (
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
