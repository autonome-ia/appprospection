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

/** Libellé du matériau des murs (code fiscal dmatgm, BD TOPO materiaux_des_murs). */
export const MAT_MURS_LABELS: Record<string, string> = {
  '1': 'pierre',
  '2': 'meulière',
  '3': 'béton',
  '4': 'briques',
  '5': 'aggloméré',
  '6': 'bois',
  '9': 'autres',
}

/**
 * Attributs BD TOPO du bâtiment déjà présents dans les réponses WFS que l'on
 * télécharge — longtemps ignorés (audit + veille juillet 2026). Stockés en
 * jsonb `points.maison_extra` (migration db/0010), backfill paresseux.
 */
export interface HouseExtra {
  /** usage_1 (« Résidentiel », « Commercial et services »…). */
  usage: string | null
  /** usage_2 (« Annexe »…). */
  usage_2: string | null
  logements: number | null
  etages: number | null
  /** Année de date_d_apparition — repli quand la BDNB est muette. */
  annee_apparition: number | null
  /** etat_de_l_objet (« En service », « En construction »…). */
  etat: string | null
  /** construction_legere (abri, véranda, serre). */
  legere: boolean | null
  /** Code fiscal dmatgm (voir MAT_MURS_LABELS). */
  mat_murs: string | null
  /** Précision planimétrique du polygone (m) — au-delà de ~3 m, la
      silhouette BD TOPO « source de vérité » du dessin est douteuse. */
  precision_m: number | null
}

export interface HouseEnrichment {
  annee_construction: number | null
  mat_toit: string | null
  toit_surface_m2: number | null
  dpe_classe: string | null
  maison_extra: HouseExtra | null
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
 * v15 : régions MONO-BLOC (les lobes secondaires d'une région rejoignent le
 *      voisin le plus en contact — la garde d'aire ne fait plus échouer tout
 *      le pan), arcs extérieurs choisis par LONGUEUR attendue, et une boucle
 *      sans jonction ne prend le polygone entier que si elle le remplit.
 *      Banc : 15/23 → 21/23 maisons réelles propres.
 * v16 : chaînes de 2 coins (une arête entre deux jonctions) — le riverain se
 *      lit sur les cellules bordant l'arête (le « milieu » était la jonction
 *      elle-même : arête classée extérieure et projetée sur la silhouette,
 *      contours en vrille — danton130). Banc : 22/23 propres.
 * v17 : drapeau `maison` par pan (appartenance au corps principal) — nourrit
 *      les pans COCHABLES de la maquette 3D (niveau 3 : le commercial exclut
 *      du doigt un garage ou une extension, le total suit).
 * v18 : verdicts PARLANTS (veille juillet 2026) — diagnostic jsonb
 *      `toit_lidar_diag` (migration db/0011) : motif du no_data
 *      (hors_couverture / canopee / posterieur_survol / sans_batiment /
 *      sans_points), % de végétation haute sur l'emprise (classe 5, gratuite
 *      dans le flux déjà téléchargé), secours classe 67 « divers bâtis »
 *      plafonné à faible_confiance, classification de la dalle
 *      (IGN_AUTO_V5…) + date d'édition (re-mesure ciblée possible quand
 *      l'IGN réédite). `grand_batiment` croisé avec logements/étages/IDs RNB
 *      au lieu du seul seuil d'emprise (les grandes longères passaient à
 *      tort pour des collectifs).
 */
export const LIDAR_VERSION = 18

/** Diagnostic de la mesure (jsonb `toit_lidar_diag`, migration db/0011). */
export interface LidarDiag {
  /** Pourquoi pas de mesure : hors_couverture (dalle inexistante), canopee
      (toit sous les arbres), posterieur_survol (maison plus récente que le
      LiDAR), sans_batiment (aucun polygone à portée), sans_points. */
  motif?: 'hors_couverture' | 'canopee' | 'posterieur_survol' | 'sans_batiment' | 'sans_points'
  /** Part de l'emprise sous végétation haute (classe 5), 0-100 — argument
      démoussage même quand la mesure réussit. */
  vegetation_pct?: number
  /** Mesure complétée par la classe 67 « divers bâtis » (vérandas, annexes
      mal classées) : verdict plafonné à faible_confiance. */
  secours_67?: boolean
  /** Procédé de classification de la dalle (ex. IGN_AUTO_V5). */
  classif?: string
  /** Date d'édition de la dalle (réédition IGN = re-mesure possible). */
  edition?: string
}

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
  /** Pan du corps principal (« la maison », connectivité v10+) — présélection
      des pans cochables de la maquette (absent sur les mesures < v17). */
  maison?: boolean
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
