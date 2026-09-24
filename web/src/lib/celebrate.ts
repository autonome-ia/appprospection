// Célébration (chantier design 24/09) : moment RARE — une vente, l'objectif
// de la semaine. Déclenchée de n'importe où par un événement, rendue une
// seule fois par <Celebration /> (App.tsx). Retenue voulue : pas de
// confettis, une coche qui se dessine (le « Terminé » d'Apple Pay).
export const CELEBRATE_EVENT = 'app:celebrate'

export function celebrate(label: string) {
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: label }))
  // Retour haptique là où il existe (Android) ; iOS l'ignore.
  try {
    navigator.vibrate?.(12)
  } catch {
    // API absente : rien
  }
}
