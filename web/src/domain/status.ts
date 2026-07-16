// Statuts d'un point de prospection — liste FIGÉE (voir docs/SPEC.md §5).
// Les valeurs correspondent exactement au type SQL `point_status` (db/schema.sql).

export type PointStatus =
  | 'absent'
  | 'a_revoir'
  | 'impossible'
  | 'rdv_pris'
  | 'vendu'

export interface StatusMeta {
  value: PointStatus
  label: string
  /** Couleur du marqueur sur la carte + pastille dans l'UI. */
  color: string
  /** Courte description métier. */
  description: string
}

export const STATUSES: StatusMeta[] = [
  { value: 'absent', label: 'Absent', color: '#98a2b3', description: 'Personne / pas d’ouverture' },
  { value: 'a_revoir', label: 'À revoir', color: '#f0a93b', description: 'Repasser plus tard' },
  { value: 'impossible', label: 'Impossible', color: '#344054', description: 'Inutile d’y retourner' },
  { value: 'rdv_pris', label: 'RDV pris', color: '#2f6bff', description: 'Rendez-vous obtenu' },
  { value: 'vendu', label: 'Vendu', color: '#17b26a', description: 'Vente conclue' },
]

export const STATUS_BY_VALUE: Record<PointStatus, StatusMeta> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s]),
) as Record<PointStatus, StatusMeta>

/**
 * Expression MapLibre `match` : statut -> couleur.
 * Utilisée par la couche de cercles (data-driven styling).
 */
export const statusColorExpression = (): unknown => [
  'match',
  ['get', 'status'],
  ...STATUSES.flatMap((s) => [s.value, s.color]),
  '#000000', // fallback
]
