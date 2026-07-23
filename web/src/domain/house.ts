// Helpers d'affichage de la fiche maison enrichie (légers, sans dépendance —
// le module data/enrich.ts, qui embarque proj4, est importé dynamiquement).

/** Libellé du matériau de toiture (1er caractère du code fiscal dmatto). */
export const MAT_TOIT_LABELS: Record<string, string> = {
  '1': 'Tuiles',
  '2': 'Ardoise',
  '3': 'Zinc/alu',
  '4': 'Béton',
  '9': 'Autre',
}

/**
 * Libellé du matériau : principal + secondaire quand il existe (« Tuiles +
 * zinc/alu ») — le code fiscal a deux chiffres.
 */
export function matToitLabel(code: string | null): string | null {
  if (!code) return null
  const main = MAT_TOIT_LABELS[code.charAt(0)] ?? null
  if (!main) return null
  const sec = code.length > 1 ? MAT_TOIT_LABELS[code.charAt(1)] : undefined
  if (sec && code.charAt(1) !== code.charAt(0)) return `${main} + ${sec.toLowerCase()}`
  return main
}

/** Liste métier des matériaux confirmables sur le terrain (à affiner avec le chef des ventes). */
export const CONFIRMED_MAT_OPTIONS = [
  'Tuile mécanique',
  'Tuile canal',
  'Tuile plate',
  'Ardoise naturelle',
  'Ardoise fibrociment',
  'Fibrociment',
  'Bac acier',
  'Zinc',
  'Chaume',
  'Toit plat / étanchéité',
  'Autre',
]

/** Années suspectes : valeurs de reprise/défaut connues des Fichiers fonciers. */
export const SUSPECT_YEARS = new Set([1900, 1970, 2002, 2003])

export interface HouseEnrichment {
  annee_construction: number | null
  mat_toit: string | null
  toit_surface_m2: number | null
  dpe_classe: string | null
}

/**
 * Version courante de l'algorithme de mesure LiDAR (voir data/lidar.ts).
 * Déclarée ici (module léger) pour décider d'un re-calcul SANS charger le
 * chunk lidar : un recalibrage incrémente la version, les points déjà
 * mesurés se re-mesurent paresseusement à l'ouverture de leur fiche.
 * v2 : ajout des contours de pans (dessin sur l'ortho, phase 3).
 * v3 : contours lissés plus fort (1 m) — formes franches, sans crénelures.
 * v4 : enveloppe morphologique avant traçage (ardoises sombres = points épars,
 *      les contours ne couvraient qu'un îlot), traçage robuste aux pincements,
 *      garde de cohérence (pas de dessin si le polygone couvre < 60 % du pan).
 */
export const LIDAR_VERSION = 4

/** Un pan de toiture mesuré (stocké en jsonb sur le point). */
export interface LidarPan {
  type: 'principal' | 'secondaire' | 'plat'
  pente_deg: number
  azimut_deg: number
  m2: number
  /** Contour du pan (lng/lat), lissé — pour le dessin sur l'ortho. */
  contour?: [number, number][]
  /** Point d'ancrage de l'étiquette (lng/lat). */
  centre?: [number, number]
}

/** La mesure LiDAR du point est-elle absente, périmée ou à re-tenter ? */
export function lidarNeedsMeasure(p: {
  toit_lidar_statut: string | null
  toit_lidar_version: number | null
}): boolean {
  if (!p.toit_lidar_statut || p.toit_lidar_statut === 'error') return true
  return (p.toit_lidar_version ?? 0) < LIDAR_VERSION
}
