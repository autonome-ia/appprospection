/** Prénom affichable — JAMAIS un email brut (retour briac 25/07, même
    esprit que displayName de l'agenda, audit UX A11). */
export function firstNameOf(name: string | null | undefined): string | null {
  const raw = name?.trim()
  if (!raw) return null
  const base = raw.includes('@') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw
  const first = base.split(/\s+/).filter(Boolean)[0]
  if (!first) return null
  return first.charAt(0).toUpperCase() + first.slice(1)
}
