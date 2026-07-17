import { matToitLabel, SUSPECT_YEARS } from '../domain/house'

interface Props {
  annee: number | null
  matCode: string | null
  toitM2: number | null
  dpe: string | null
}

/** Badges compacts de la fiche maison (année, toiture, surface, DPE). */
export function HouseBadges({ annee, matCode, toitM2, dpe }: Props) {
  const matToit = matToitLabel(matCode)
  if (annee === null && !matToit && toitM2 === null && !dpe) return null

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
      {matToit && (
        <span
          className="house-badge"
          title="Donnée fiscale — probable, une rénovation récente peut ne pas apparaître"
        >
          {matToit}
        </span>
      )}
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
