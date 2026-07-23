import { matToitLabel, SUSPECT_YEARS } from '../domain/house'

interface Props {
  annee: number | null
  matCode: string | null
  /** Matériau constaté sur le terrain : remplace la donnée fiscale. */
  matConfirme?: string | null
  toitM2: number | null
  /** Surface MESURÉE au LiDAR (statut ok uniquement) : remplace l'estimation. */
  lidarM2?: number | null
  lidarMillesime?: string | null
  dpe: string | null
}

/** Badges compacts de la fiche maison (année, toiture, surface, DPE). */
export function HouseBadges({
  annee,
  matCode,
  matConfirme,
  toitM2,
  lidarM2,
  lidarMillesime,
  dpe,
}: Props) {
  const matToit = matToitLabel(matCode)
  if (annee === null && !matToit && !matConfirme && toitM2 === null && lidarM2 == null && !dpe)
    return null

  return (
    <div className="house-badges">
      {annee !== null && (
        <span
          className="house-badge tnum"
          title={
            SUSPECT_YEARS.has(annee)
              ? 'Année approximative (valeur par défaut fréquente du cadastre)'
              : 'Année de construction (données fiscales, BDNB)'
          }
        >
          ~{annee}
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
          title={`Surface mesurée au laser (nuage de points LiDAR HD IGN${
            lidarMillesime ? `, survol ${lidarMillesime.slice(0, 4)}` : ''
          })`}
        >
          {lidarM2} m² toit
        </span>
      ) : toitM2 !== null ? (
        <span className="house-badge tnum" title="Estimation : emprise au sol × pente (altitudes IGN)">
          ~{toitM2} m² toit
        </span>
      ) : null}
      {dpe && (
        <span className={`house-badge dpe dpe-${dpe.toLowerCase()}`} title="Classe DPE (BDNB)">
          DPE {dpe}
        </span>
      )}
    </div>
  )
}
