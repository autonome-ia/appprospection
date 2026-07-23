// Couleur stable par commercial (agenda, stats). Dérivée de l'id -> palette,
// sauf si le profil a une couleur explicite.

const PALETTE = [
  '#2563eb', '#db2777', '#16a34a', '#ea580c',
  '#7c3aed', '#0891b2', '#ca8a04', '#dc2626',
]

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
