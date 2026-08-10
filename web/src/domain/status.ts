// Statuts d'un point de prospection (voir docs/SPEC.md §5).
// Les valeurs correspondent exactement au type SQL `point_status`
// (db/schema.sql + migrations db/0013 hors_cible, db/0015 ancien_client).
// « Refus » est le LIBELLÉ de la valeur SQL `impossible` (renommage métier
// 25/07/2026 — la valeur en base ne change pas, historique intact).

export type PointStatus =
  | 'absent'
  | 'a_revoir'
  | 'impossible'
  | 'hors_cible'
  | 'rdv_pris'
  | 'vendu'
  | 'ancien_client'

export interface StatusMeta {
  value: PointStatus
  label: string
  /** Couleur du marqueur sur la carte + pastille dans l'UI. */
  color: string
  /** Courte description métier. */
  description: string
}

// Couleurs assombries pour tenir un contraste ≥ 3:1 avec le glyphe blanc
// (lisibilité en plein soleil). Doit rester aligné avec --st-* (index.css).
// FUSION « Client » (29/07/2026, retour chef des ventes) : `vendu` et
// `ancien_client` restent DEUX valeurs en base (le journal garde la vérité :
// vente pendant la prospection vs client d'avant) mais UN seul statut à
// l'écran — l'état dit « cette maison est un client », la VENTE est un
// événement (l'issue RDV « Vendu », seul chemin qui écrit `vendu` et compte
// au tunnel). Poser/basculer « Client » à la main écrit `ancien_client`
// (une porte, jamais une vente).
export const STATUSES: StatusMeta[] = [
  { value: 'absent', label: 'Absent', color: '#7d8898', description: 'Personne / pas d’ouverture' },
  { value: 'a_revoir', label: 'À revoir', color: '#d97706', description: 'Repasser plus tard' },
  { value: 'impossible', label: 'Refus', color: '#344054', description: 'A refusé : inutile d’y retourner' },
  { value: 'hors_cible', label: 'Hors cible', color: '#6d4fa1', description: 'Pas notre cible (locataire…)' },
  { value: 'rdv_pris', label: 'RDV pris', color: '#2f6bff', description: 'Rendez-vous obtenu' },
  { value: 'vendu', label: 'Client', color: '#17b26a', description: 'Client : vente conclue' },
  { value: 'ancien_client', label: 'Client', color: '#17b26a', description: 'Client de l’agence : on y a déjà vendu' },
]

export const STATUS_BY_VALUE: Record<PointStatus, StatusMeta> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s]),
) as Record<PointStatus, StatusMeta>

/** Les deux valeurs du statut affiché « Client ». */
export const CLIENT_STATUSES: readonly PointStatus[] = ['vendu', 'ancien_client']

export const isClientStatus = (s: PointStatus): boolean =>
  s === 'vendu' || s === 'ancien_client'

/** Équivalence À L'AFFICHAGE (chip active, filtres) : les deux valeurs
    « Client » sont le même statut aux yeux du commercial. */
export const sameDisplayStatus = (a: PointStatus, b: PointStatus): boolean =>
  a === b || (isClientStatus(a) && isClientStatus(b))

/** Entrées des listes de chips (pose, filtres, fiche, formulaire contact) :
    une seule chip « Client », qui écrit `ancien_client` — `vendu` n'est
    jamais posable à la main, il n'arrive que par l'issue RDV. */
export const DISPLAY_STATUSES: StatusMeta[] = STATUSES.filter((s) => s.value !== 'vendu')

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
