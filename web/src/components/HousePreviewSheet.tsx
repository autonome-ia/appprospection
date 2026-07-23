import { Drawer } from 'vaul'
import { X, Home } from 'lucide-react'
import { StatusPicker } from './StatusPicker'
import { HouseBadges } from './HouseBadges'
import type { PointStatus } from '../domain/status'
import type { HouseInfo } from '../data/enrich'
import type { LidarResult } from '../data/lidar'

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
      info.dpe_classe !== null)

  return (
    // Non modale : la carte reste visible (la maison est surlignée dessous).
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={false}>
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

          {info === null ? (
            <p className="house-loading">Recherche des informations…</p>
          ) : hasInfo || lidar !== null ? (
            <HouseBadges
              annee={info.annee_construction}
              matCode={info.mat_toit}
              toitM2={info.toit_surface_m2}
              lidarM2={lidarOk ? lidar.toit_lidar_m2 : null}
              lidarMillesime={lidarOk ? lidar.toit_lidar_millesime : null}
              lidarPending={lidar === null}
              dpe={info.dpe_classe}
            />
          ) : (
            <p className="house-loading">Pas d’informations pour ce bâtiment.</p>
          )}

          <p className="eyebrow field-label">Poser un point</p>
          <StatusPicker active={activeStatus} onChange={onStatusChange} />

          <div className="drawer-actions">
            <button type="button" className="btn btn-primary" onClick={() => onPose(activeStatus)}>
              Poser le point
            </button>
          </div>

          <p className="data-attribution">Données IGN (BD TOPO, LiDAR HD) · BDNB (CSTB)</p>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
