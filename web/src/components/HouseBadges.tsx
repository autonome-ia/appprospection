import { matToitLabel, SUSPECT_YEARS } from '../domain/house'

interface Props {
  annee: number | null
  matCode: string | null
  /** Matériau constaté sur le terrain : remplace la donnée fiscale. */
  matConfirme?: string | null
  toitM2: number | null
  dpe: string | null
}

/** Badges compacts de la fiche maison (année, toiture, surface, DPE). */
export function HouseBadges({ annee, matCode, matConfirme, toitM2, dpe }: Props) {
  const matToit = matToitLabel(matCode)
  if (annee === null && !matToit && !matConfirme && toitM2 === null && !dpe) return null

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
      {toitM2 !== null && (
        <span className="house-badge tnum" title="Estimation : emprise au sol × pente (altitudes IGN)">
          ~{toitM2} m² toit
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
