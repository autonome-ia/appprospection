// Couleur stable par commercial (agenda, stats). Choisie par le manager dans
// l'écran Équipe (refonte couleurs agenda, retour Alexis 10/08), sinon
// attribuée automatiquement SANS doublon dans l'agence (garde-fou, 20/09).

/** Palette FERMÉE des couleurs de commerciaux : teintes distinctes entre
    elles ET éloignées des couleurs sémantiques (orange accent, ambre
    « à revoir », vert « vendu », bleu « RDV pris », rouge danger) — l'ancienne
    palette auto contenait orange/ambre/vert/rouge, source de confusion.
    Étendue de 8 à 15 le 20/09/2026 (demande briac, équipe qui grandit) :
    les 7 dernières restent hors des familles réservées (marine et pétrole
    volontairement très sombres pour ne pas se confondre avec le bleu RDV,
    brique brune et sombre, loin de l'orange signal). */
export const TEAM_PALETTE = [
  '#4263eb', // indigo
  '#7048e8', // violet
  '#c2255c', // framboise
  '#0e9384', // canard
  '#0c8599', // lagon
  '#66a80f', // olive
  '#9c36b5', // pourpre
  '#5f6b7a', // ardoise
  '#8a5a2b', // tabac
  '#8b1e3f', // bordeaux
  '#e64980', // rose
  '#1b4f9c', // marine
  '#6d597a', // mauve
  '#264653', // pétrole
  '#a34a28', // brique
]

/** Les 8 teintes historiques : teinte PRÉFÉRÉE d'un profil sans couleur
    (même hachage qu'avant le garde-fou) — un commercial qui n'entrait en
    collision avec personne garde exactement sa couleur d'avant. */
const AUTO_COUNT = 8

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export interface ColorSeed {
  id: string
  color: string | null
  /** Ordre d'arrivée dans l'agence : un nouveau membre prend une teinte
      libre SANS déplacer celles des anciens. */
  created_at?: string | null
}

/**
 * Attribution garde-fou (20/09/2026, demande briac) : personne n'a la même
 * couleur tant que la palette n'est pas épuisée.
 *  1. Les couleurs CHOISIES (écran Équipe) sont réservées telles quelles.
 *  2. Chaque profil sans couleur, par ordre d'arrivée, prend sa teinte
 *     préférée (hachage historique) si elle est libre, sinon la première
 *     libre en tournant dans la palette.
 * Déterministe : tous les appareils de l'agence calculent la même table.
 */
export function assignTeamColors(profiles: ColorSeed[]): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const p of profiles) {
    if (p.color) {
      out.set(p.id, p.color)
      taken.add(p.color.toLowerCase())
    }
  }
  const auto = profiles
    .filter((p) => !p.color)
    .sort(
      (a, b) =>
        (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
    )
  for (const p of auto) {
    const pref = hash(p.id) % AUTO_COUNT
    let chosen = TEAM_PALETTE[pref] // palette épuisée (> 15 sans couleur) : collision inévitable
    for (let k = 0; k < TEAM_PALETTE.length; k++) {
      const c = TEAM_PALETTE[(pref + k) % TEAM_PALETTE.length]
      if (!taken.has(c)) {
        chosen = c
        break
      }
    }
    out.set(p.id, chosen)
    taken.add(chosen)
  }
  return out
}

// Table de l'agence, remplie à chaque chargement des profils
// (data/profiles.ts) — TOUS les profils, support et désactivés compris, pour
// que chaque appareil obtienne la même attribution.
const registry = new Map<string, string>()

export function registerTeamColors(profiles: ColorSeed[]): void {
  registry.clear()
  for (const [id, c] of assignTeamColors(profiles)) registry.set(id, c)
}

export function colorForCommercial(id: string, explicit?: string | null): string {
  if (explicit) return explicit
  return registry.get(id) ?? TEAM_PALETTE[hash(id) % AUTO_COUNT]
}

// Palette des pans de toiture mesurés (harmonisée DA : teintes franches mais
// posées) — partagée entre le dessin sur l'ortho (MapView) et la maquette 3D
// de la fiche (Roof3D), pour que « le pan orange » soit le même partout.
export const PAN_COLORS = ['#2f6bff', '#e8913a', '#1fa294', '#8b6fe8', '#d96a9b', '#5aa845']
