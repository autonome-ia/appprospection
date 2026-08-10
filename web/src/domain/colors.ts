// Couleur stable par commercial (agenda, stats). Dérivée de l'id -> palette,
// sauf si le profil a une couleur explicite (assignée par le manager dans
// l'écran Équipe — refonte couleurs agenda, retour Alexis 10/08).

/** Palette FERMÉE des couleurs de commerciaux : 8 teintes distinctes entre
    elles ET éloignées des couleurs sémantiques (orange accent, ambre
    « à revoir », vert « vendu », bleu « RDV pris », rouge danger) — l'ancienne
    palette auto contenait orange/ambre/vert/rouge, source de confusion. */
export const TEAM_PALETTE = [
  '#4263eb', // indigo
  '#7048e8', // violet
  '#c2255c', // framboise
  '#0e9384', // canard
  '#0c8599', // lagon
  '#66a80f', // olive
  '#9c36b5', // pourpre
  '#5f6b7a', // ardoise
]

const PALETTE = TEAM_PALETTE

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function colorForCommercial(id: string, explicit?: string | null): string {
  if (explicit) return explicit
  return PALETTE[hash(id) % PALETTE.length]
}

// Palette des pans de toiture mesurés (harmonisée DA : teintes franches mais
// posées) — partagée entre le dessin sur l'ortho (MapView) et la maquette 3D
// de la fiche (Roof3D), pour que « le pan orange » soit le même partout.
export const PAN_COLORS = ['#2f6bff', '#e8913a', '#1fa294', '#8b6fe8', '#d96a9b', '#5aa845']
