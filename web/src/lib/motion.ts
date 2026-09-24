// Tokens de mouvement côté JS (chantier design 24/09) — miroir des variables
// --ease-* / --dur-* d'index.css. Ressorts Motion en {duration, bounce} :
// bounce 0 par défaut (skill apple-design) ; du rebond seulement quand un
// geste porte un élan (release) ou pour un moment rare (celebrate).
import type { Transition } from 'motion/react'

export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

/** Segmentés, bascules : net, sans rebond. */
export const SPRING_SNAPPY: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
/** Mise en page, listes, apparition de barres. */
export const SPRING_SMOOTH: Transition = { type: 'spring', duration: 0.4, bounce: 0.1 }
/** Relâché d'un glisser (le doigt a donné un élan). */
export const SPRING_RELEASE: Transition = { type: 'spring', duration: 0.5, bounce: 0.15 }
/** Moment rare (vente, objectif atteint). */
export const SPRING_CELEBRATE: Transition = { type: 'spring', duration: 0.6, bounce: 0.35 }
