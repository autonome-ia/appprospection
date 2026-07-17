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

export function matToitLabel(code: string | null): string | null {
  if (!code) return null
  return MAT_TOIT_LABELS[code.charAt(0)] ?? null
}

/** Années suspectes : valeurs de reprise/défaut connues des Fichiers fonciers. */
export const SUSPECT_YEARS = new Set([1900, 1970, 2002, 2003])

export interface HouseEnrichment {
  annee_construction: number | null
  mat_toit: string | null
  toit_surface_m2: number | null
  dpe_classe: string | null
}
