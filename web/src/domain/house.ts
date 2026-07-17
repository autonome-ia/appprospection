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

/**
 * Code « Autres » sur une maison d'avant l'interdiction de l'amiante (1997) :
 * signal fibrociment possible — catégorie fourre-tout du fisc où il tombe.
 */
export function fibroSuspect(code: string | null, annee: number | null): boolean {
  return code?.charAt(0) === '9' && annee !== null && annee <= 1997
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
