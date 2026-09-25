/** Espace courant (chantier Numbers) : mémorisé par appareil — confort,
    jamais une donnée. Repli prospection si le stockage est indisponible. */
export type Space = 'prospection' | 'numbers'

const KEY = 'app-space'

export function readSpace(): Space {
  try {
    return localStorage.getItem(KEY) === 'numbers' ? 'numbers' : 'prospection'
  } catch {
    return 'prospection'
  }
}

export function writeSpace(space: Space) {
  try {
    localStorage.setItem(KEY, space)
  } catch {
    // stockage indisponible : l'espace ne sera pas retenu, sans gravité
  }
}
