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
 * v5 : azimut_deg passe en azimut BOUSSOLE (0 = nord, 90 = est) — les versions
 *      précédentes stockaient un angle mathématique depuis l'est (audit).
 * v6 : altitude de chaque sommet de contour (`alts`, relatif à la gouttière la
 *      plus basse) — alimente la maquette 3D du toit dans la fiche.
 * v7 : pans JOINTIFS reconstruits par partition de l'emprise (lidar-recon) —
 *      fini les trous/chevauchements entre pans ; le jsonb devient un objet
 *      { mur_m, pans } (hauteur de gouttière BD TOPO pour les murs de la
 *      maquette). Les anciens tableaux restent lisibles (parseRoofPans).
 * v8 : silhouette rectiligne ancrée sur le polygone BD TOPO (recon v3) +
 *      `emprise` stockée dans le jsonb — murs droits de la maquette, débord
 *      de toit réel, marches entre niveaux (annexe basse).
 * v9 : passe de finition (captures v3) — échardes absorbées par leur voisin,
 *      jonctions aimantées aux coins du polygone (noues des L), garde de
 *      silhouette sur les frontières redressées, murs = hauteur BD TOPO
 *      moins comble mesuré (fini les « maisons donjons »).
 * v10 : `toit_lidar_principal_m2` devient « LA MAISON » par connectivité
 *      (pans reliés au plus grand pan incliné par frontières SOUDÉES — un
 *      décroché coupe : extensions/annexes/garages exclus, même à pente
 *      égale). C'est lui que la fiche affiche (validation factures : Rosa
 *      Floch 219 vs 223 facturés). Le total reste stocké.
 * v11 : soudure au QUARTILE BAS des écarts de plans (la médiane classait les
 *      faîtages > ~42° en marche : zigzag de grille × pente raide — Rosa
 *      Floch affichait 110 au lieu de 219).
 * v12 : soudure évaluée sur TOUTE la frontière de la paire (un rognon de
 *      3 coins figeait le verdict d'un faîtage de 11 m) + règle métier :
 *      les pans PLATS ne rejoignent jamais le corps et ne font pas pont
 *      (dalle de garage « continue » avec le toit incliné = annexe quand
 *      même). Rosa Floch : badge 243 m² (facture 223, annexes exclues).
 * v13 : passe issue de la campagne d'audit (21 fixtures réelles) — altitudes
 *      BORNÉES au z observé des points du pan (fin des « voiles », F3/F4) ;
 *      soudures calculées pour toutes les paires riveraines même en repli
 *      (F5) ; garde « part inclinée significative » du corps principal ;
 *      redressement split-and-merge des frontières (F1) ; corde testée tous
 *      les 50 cm + ré-assemblage simple si auto-intersection (F2).
 * v14 : découpage des pans RANSAC en composantes spatialement connexes —
 *      deux faces COPLANAIRES d'ailes distinctes (lotissements en L/T, 2e
 *      série de captures briac) ne forment plus un « pan » unique en deux
 *      morceaux qui rendait le dessin chaotique. Pontage rayon 2 (les toits
 *      à points épars ne se sur-découpent pas), composante minimale 12 m².
 */
export const LIDAR_VERSION = 14

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
  /** Altitude (m) de chaque sommet du contour, relative au point le plus bas
      du toit — pour la maquette 3D (absente sur les mesures < v6). */
  alts?: number[]
}

/**
 * Données de toit stockées dans le jsonb `toit_lidar_pans`.
 * v7+ : objet `{ mur_m, pans }` ; < v7 : simple tableau de pans.
 */
export interface RoofData {
  /** Hauteur de gouttière au-dessus du sol (m, BD TOPO) — murs de la maquette. */
  mur_m: number | null
  /** Emprise murale BD TOPO (lng/lat, fermée) — extrusion des murs (v8+). */
  emprise: [number, number][] | null
  pans: LidarPan[]
}

/** Lit le jsonb `toit_lidar_pans`, quelle que soit sa génération. */
export function parseRoofPans(raw: unknown): RoofData | null {
  if (!raw) return null
  if (Array.isArray(raw)) return { mur_m: null, emprise: null, pans: raw as LidarPan[] }
  if (typeof raw === 'object' && Array.isArray((raw as { pans?: unknown }).pans)) {
    const o = raw as { mur_m?: unknown; emprise?: unknown; pans: LidarPan[] }
    return {
      mur_m: typeof o.mur_m === 'number' ? o.mur_m : null,
      emprise: Array.isArray(o.emprise) ? (o.emprise as [number, number][]) : null,
      pans: o.pans,
    }
  }
  return null
}

/** La mesure LiDAR du point est-elle absente, périmée ou à re-tenter ? */
export function lidarNeedsMeasure(p: {
  toit_lidar_statut: string | null
  toit_lidar_version: number | null
}): boolean {
  if (!p.toit_lidar_statut || p.toit_lidar_statut === 'error') return true
  return (p.toit_lidar_version ?? 0) < LIDAR_VERSION
}
