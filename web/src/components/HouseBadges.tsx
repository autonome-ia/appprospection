import { MAT_MURS_LABELS, matToitLabel, SUSPECT_YEARS, type HouseExtra } from '../domain/house'

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
}: Props) {
  const matToit = matToitLabel(matCode)
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

  return (
    <div className="house-badges">
      {anneeShown !== null && (
        <span
          className="house-badge tnum"
          title={
            anneeFallback
              ? 'Année d’apparition du bâtiment (BD TOPO)'
              : SUSPECT_YEARS.has(anneeShown)
                ? 'Année approximative (valeur par défaut fréquente du cadastre)'
                : 'Année de construction (données fiscales, BDNB)'
          }
        >
          ~{anneeShown}
        </span>
      )}
      {enConstruction && (
        <span className="house-badge" title="État du bâtiment (BD TOPO)">
          {extra!.etat}
        </span>
      )}
      {matConfirme ? (
        <span className="house-badge is-confirmed" title="Toiture confirmée sur le terrain">
          {matConfirme}
        </span>
      ) : matToit ? (
        <span
          className="house-badge"
          title="Donnée fiscale — probable, une rénovation récente peut ne pas apparaître"
        >
          {matToit}
        </span>
      ) : null}
      {lidarM2 != null ? (
        <span
          className="house-badge is-measured tnum"
          title={`Toit de la maison, hors annexes et extensions — mesuré au laser (nuage de points LiDAR HD IGN${
            lidarMillesime ? `, survol ${lidarMillesime.slice(0, 4)}` : ''
          })`}
        >
          {lidarM2} m² toit
        </span>
      ) : lidarPending ? (
        <span className="house-badge is-pending" title="Mesure de la toiture au laser en cours">
          mesure du toit…
        </span>
      ) : toitM2 !== null ? (
        <span className="house-badge tnum" title="Estimation : emprise au sol × pente (altitudes IGN)">
          ~{toitM2} m² toit
        </span>
      ) : null}
      {murs && (
        <span className="house-badge" title="Matériau des murs (donnée fiscale, BD TOPO)">
          Murs {murs}
        </span>
      )}
      {(extra?.etages ?? 0) >= 2 && (
        <span className="house-badge tnum" title="Nombre d’étages (BD TOPO)">
          {extra!.etages} étages
        </span>
      )}
      {(extra?.logements ?? 0) >= 2 && (
        <span
          className="house-badge tnum"
          title="Nombre de logements (BD TOPO) — bâtiment probablement collectif ou mitoyen"
        >
          {extra!.logements} logements
        </span>
      )}
      {dpe && (
        <span className={`house-badge dpe dpe-${dpe.toLowerCase()}`} title="Classe DPE (BDNB)">
          DPE {dpe}
        </span>
      )}
    </div>
  )
}
