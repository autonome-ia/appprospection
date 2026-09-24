import { Drawer } from 'vaul'
import { X, Home, Navigation } from 'lucide-react'
import { wazeUrl } from '../lib/nav'
import { StatusPicker } from './StatusPicker'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import type { PointStatus } from '../domain/status'
import type { HouseInfo } from '../data/enrich'
import type { LidarResult } from '../data/lidar'
import { suggestedWastePct } from '../domain/house'

interface Props {
  open: boolean
  /** Adresse (géocodage inverse), null pendant le chargement. */
  address: string | null
  /** Coordonnées de la maison tapée — Waze y va au mètre (les coordonnées
      priment sur l'adresse texte, même règle que les fiches point/client). */
  coords: { lng: number; lat: number }
  /** Infos maison, null pendant le chargement. */
  info: HouseInfo | null
  /** Mesure LiDAR de la toiture, null pendant le calcul. */
  lidar: LidarResult | null
  onOpenChange: (open: boolean) => void
  /** Pose un point sur cette maison : un tap sur un statut suffit. */
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
  coords,
  info,
  lidar,
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
          {/* Pose en 1 tap (chantier design 24/09, décision briac) : le
              statut touché EST la pose — le toast « Annuler » sert de filet. */}
          <p className="eyebrow field-label">Poser un point</p>
          <StatusPicker onChange={onPose} />

          {lidarOk && lidar.toit_lidar_pans && (
            // REPLIÉ comme partout (décision briac 25/07) : quand la mesure
            // tombe, seule la ligne « Toiture mesurée · N m² » apparaît — la
            // 3D ne surgit plus toute seule, c'est le commercial qui déplie.
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
            />
          )}

          <p className="data-attribution">Données IGN (BD TOPO, LiDAR HD) · BDNB (CSTB)</p>

          <div className="drawer-footer">
            {/* « Y aller » AVANT tout point posé (demande briac 29/07) :
                repérer une maison sur la carte et s'y rendre — gabarit à
                deux boutons des autres fiches, libellé Waze de l'app. */}
            <a
              className="btn btn-ghost"
              href={wazeUrl(coords, address)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation size={15} strokeWidth={1.9} /> Y aller
            </a>
          </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
