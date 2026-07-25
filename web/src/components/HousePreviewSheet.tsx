import { Drawer } from 'vaul'
import { X, Home } from 'lucide-react'
import { StatusPicker } from './StatusPicker'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import { STATUS_BY_VALUE, type PointStatus } from '../domain/status'
import type { HouseInfo } from '../data/enrich'
import type { LidarResult } from '../data/lidar'
import { suggestedWastePct } from '../domain/house'

interface Props {
  open: boolean
  /** Adresse (géocodage inverse), null pendant le chargement. */
  address: string | null
  /** Infos maison, null pendant le chargement. */
  info: HouseInfo | null
  /** Mesure LiDAR de la toiture, null pendant le calcul. */
  lidar: LidarResult | null
  activeStatus: PointStatus
  onStatusChange: (s: PointStatus) => void
  onOpenChange: (open: boolean) => void
  /** Pose un point sur cette maison avec le statut choisi. */
  onPose: (status: PointStatus) => void
}

/**
 * Fiche maison AVANT prospection : on tape une maison sans marqueur, on voit
 * son contexte (année, toiture, surface, DPE), et on peut poser le point
 * directement — ou refermer sans rien écrire.
 */
export function HousePreviewSheet({
  open,
  address,
  info,
  lidar,
  activeStatus,
  onStatusChange,
  onOpenChange,
  onPose,
}: Props) {
  const lidarOk = lidar?.toit_lidar_statut === 'ok'
  const hasInfo =
    info !== null &&
    (info.annee_construction !== null ||
      info.mat_toit !== null ||
      info.toit_surface_m2 !== null ||
      info.dpe_classe !== null ||
      info.maison_extra !== null)

  return (
    // Non modale : la carte reste visible (la maison est surlignée dessous).
    // repositionInputs={false} : voir PointDetailSheet (bug visualViewport iOS).
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={false} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">
              <Home size={16} strokeWidth={1.9} />
              {address ?? 'Maison'}
            </span>
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
          {info === null ? (
            <p className="house-loading">Recherche des informations…</p>
          ) : hasInfo || lidar !== null ? (
            <HouseBadges
              annee={info.annee_construction}
              matCode={info.mat_toit}
              toitM2={info.toit_surface_m2}
              lidarM2={lidarOk ? lidar.toit_lidar_principal_m2 || lidar.toit_lidar_m2 : null}
              lidarMillesime={lidarOk ? lidar.toit_lidar_millesime : null}
              lidarPending={lidar === null}
              dpe={info.dpe_classe}
              extra={info.maison_extra}
              lidarStatut={lidar?.toit_lidar_statut}
              lidarDiag={lidar?.toit_lidar_diag}
              hideMeasured={Boolean(lidarOk && lidar.toit_lidar_pans)}
            />
          ) : (
            <p className="house-loading">Pas d’informations pour ce bâtiment.</p>
          )}

          {/* Picker AVANT le bloc toiture (audit UX A2) : les chips passaient
              hors champ sous la 3D — l'acte principal reste au-dessus du pli. */}
          <p className="eyebrow field-label">Poser un point</p>
          <StatusPicker active={activeStatus} onChange={onStatusChange} />

          {lidarOk && lidar.toit_lidar_pans && (
            // Ouvert d'emblée : la fiche AVANT prospection est un moment
            // d'argumentaire (audit UX, B2).
            <RoofModule
              roof={lidar.toit_lidar_pans}
              wastePct={suggestedWastePct(
                info?.mat_toit ?? null,
                null,
                lidar.toit_lidar_pans.aretes,
              )}
              address={address}
              maisonM2={lidar.toit_lidar_principal_m2 || lidar.toit_lidar_m2}
              totalM2={lidar.toit_lidar_m2}
              millesime={lidar.toit_lidar_millesime}
              defaultOpen
            />
          )}

          <p className="data-attribution">Données IGN (BD TOPO, LiDAR HD) · BDNB (CSTB)</p>

          <div className="drawer-footer">
            {/* Libellé dynamique (audit UX A2) : le bouton disait « Poser le
                point » sans refléter le statut — risque de poser le statut
                resté actif de la maison précédente. */}
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: STATUS_BY_VALUE[activeStatus].color }}
              onClick={() => onPose(activeStatus)}
            >
              Poser · {STATUS_BY_VALUE[activeStatus].label}
            </button>
          </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
