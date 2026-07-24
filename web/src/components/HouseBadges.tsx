import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Scan } from 'lucide-react'
import {
  MAT_MURS_LABELS,
  matToitLabel,
  SUSPECT_YEARS,
  type HouseExtra,
  type LidarDiag,
} from '../domain/house'

/** Badge à provenance TAPPABLE (audit UX A7) : toute la pédagogie vivait
    dans des `title`, inexistants sur iPhone — un tap montre l'explication. */
function Badge({
  className = '',
  info,
  children,
}: {
  className?: string
  info: string
  children: ReactNode
}) {
  return (
    <span
      className={`house-badge ${className}`}
      title={info}
      role="button"
      tabIndex={0}
      onClick={() => toast(info)}
    >
      {children}
    </span>
  )
}

interface Props {
  annee: number | null
  matCode: string | null
  /** Matériau constaté sur le terrain : remplace la donnée fiscale. */
  matConfirme?: string | null
  toitM2: number | null
  /** Surface MESURÉE au LiDAR (statut ok uniquement) : remplace l'estimation. */
  lidarM2?: number | null
  lidarMillesime?: string | null
  /** Mesure en cours : on n'affiche PAS l'estimation en attendant (pas de
      « flash » estimation → mesure, retour briac). */
  lidarPending?: boolean
  dpe: string | null
  /** Attributs BD TOPO complémentaires (étages, murs, état…). */
  extra?: HouseExtra | null
  /** Statut de la mesure LiDAR (pour expliquer un échec) + diagnostic. */
  lidarStatut?: string | null
  lidarDiag?: LidarDiag | null
}

/** Explication d'une mesure LiDAR absente (verdicts parlants, v18). */
function lidarExcuse(
  statut: string | null | undefined,
  diag: LidarDiag | null | undefined,
): { label: string; title: string } | null {
  if (statut === 'grand_batiment') {
    return {
      label: 'collectif — pas de mesure',
      title:
        'Le polygone IGN couvre un bâtiment collectif (ou une bande de maisons fusionnées) : la mesure laser porterait sur tout le bloc.',
    }
  }
  if (statut !== 'no_data') return null
  switch (diag?.motif) {
    case 'hors_couverture':
      return {
        label: 'LiDAR : zone pas encore couverte',
        title:
          'Le survol laser IGN n’a pas encore couvert cette zone (programme complet fin 2026) — la mesure sera re-tentée automatiquement.',
      }
    case 'canopee':
      return {
        label: 'toit sous les arbres',
        title: `Végétation haute sur ~${diag?.vegetation_pct ?? '?'} % de l’emprise : le laser ne voit pas le toit.`,
      }
    case 'posterieur_survol':
      return {
        label: 'plus récente que le survol laser',
        title:
          'La maison est apparue après le passage de l’avion LiDAR : aucun point disponible — l’estimation reste affichée.',
      }
    default:
      return null
  }
}

/** Badges compacts de la fiche maison (année, toiture, surface, DPE). */
export function HouseBadges({
  annee,
  matCode,
  matConfirme,
  toitM2,
  lidarM2,
  lidarMillesime,
  lidarPending,
  dpe,
  extra,
  lidarStatut,
  lidarDiag,
}: Props) {
  const matToit = matToitLabel(matCode)
  const excuse = lidarExcuse(lidarStatut, lidarDiag)
  // Végétation surplombante : argument métier (mousse, gouttières) même
  // quand la mesure réussit.
  const vegBadge =
    lidarM2 != null && (lidarDiag?.vegetation_pct ?? 0) >= 30
      ? lidarDiag!.vegetation_pct!
      : null
  // Repli : l'année d'apparition BD TOPO quand la BDNB est muette (fréquent).
  const anneeShown = annee ?? extra?.annee_apparition ?? null
  const anneeFallback = annee === null && anneeShown !== null
  const murs = extra?.mat_murs ? MAT_MURS_LABELS[extra.mat_murs.charAt(0)] : null
  const enConstruction = extra?.etat != null && extra.etat !== 'En service'
  if (
    anneeShown === null &&
    !matToit &&
    !matConfirme &&
    toitM2 === null &&
    lidarM2 == null &&
    !lidarPending &&
    !dpe &&
    !murs &&
    !enConstruction &&
    (extra?.etages ?? 0) < 2 &&
    (extra?.logements ?? 0) < 2
  )
    return null

  // Tilde réservé au douteux (audit UX A19) : « ~1989 » systématique
  // affaiblissait l'accroche alors que l'année BDNB est fiable.
  const anneeDouteuse = anneeFallback || (anneeShown !== null && SUSPECT_YEARS.has(anneeShown))

  // Ordre = argumentaire (audit UX A20) : année · DPE · matériau · surface,
  // les badges secondaires (BD TOPO…) en fin de ligne.
  return (
    <div className="house-badges">
      {anneeShown !== null && (
        <Badge
          className="tnum"
          info={
            anneeFallback
              ? 'Année d’apparition du bâtiment (BD TOPO)'
              : SUSPECT_YEARS.has(anneeShown)
                ? 'Année approximative (valeur par défaut fréquente du cadastre)'
                : 'Année de construction (données fiscales, BDNB)'
          }
        >
          {anneeDouteuse ? '~' : ''}
          {anneeShown}
        </Badge>
      )}
      {dpe && (
        <Badge className={`dpe dpe-${dpe.toLowerCase()}`} info="Classe DPE (BDNB)">
          DPE {dpe}
        </Badge>
      )}
      {matConfirme ? (
        <Badge className="is-confirmed" info="Toiture confirmée sur le terrain">
          {matConfirme}
        </Badge>
      ) : matToit ? (
        <Badge info="Donnée fiscale — probable, une rénovation récente peut ne pas apparaître">
          {matToit}
        </Badge>
      ) : null}
      {lidarM2 != null ? (
        <Badge
          className="is-measured tnum"
          info={`Toit de la maison, hors annexes et extensions — mesuré au laser (nuage de points LiDAR HD IGN${
            lidarMillesime ? `, survol ${lidarMillesime.slice(0, 4)}` : ''
          })`}
        >
          <Scan size={11} strokeWidth={2} /> {lidarM2} m² · laser
        </Badge>
      ) : lidarPending ? (
        <Badge className="is-pending" info="Mesure de la toiture au laser en cours">
          mesure du toit…
        </Badge>
      ) : toitM2 !== null ? (
        <Badge className="tnum" info="Estimation : emprise au sol × pente (altitudes IGN)">
          ~{toitM2} m² · estimé
        </Badge>
      ) : null}
      {enConstruction && <Badge info="État du bâtiment (BD TOPO)">{extra!.etat}</Badge>}
      {excuse && (
        <Badge className="is-muted" info={excuse.title}>
          {excuse.label}
        </Badge>
      )}
      {vegBadge !== null && (
        <Badge
          className="is-muted"
          info={`Végétation haute sur ~${vegBadge} % de l’emprise (LiDAR) — mousse et gouttières à surveiller`}
        >
          végétation surplombante
        </Badge>
      )}
      {murs && (
        <Badge className="is-muted" info="Matériau des murs (donnée fiscale, BD TOPO)">
          Murs {murs}
        </Badge>
      )}
      {(extra?.etages ?? 0) >= 2 && (
        <Badge className="is-muted tnum" info="Nombre d’étages (BD TOPO)">
          {extra!.etages} étages
        </Badge>
      )}
      {(extra?.logements ?? 0) >= 2 && (
        <Badge
          className="is-muted tnum"
          info="Nombre de logements (BD TOPO) — bâtiment probablement collectif ou mitoyen"
        >
          {extra!.logements} logements
        </Badge>
      )}
    </div>
  )
}
