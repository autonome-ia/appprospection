// Jour relatif (chantier design 24/09) : « Aujourd'hui », « Demain »,
// « Hier », sinon « Lun. 28 sept. » — une seule façon de dire une date dans
// les listes (Contacts affichait « jeu. 24 sept., 17:30 », le popup du
// matin « Mer. 23 sept. · 18:00 »).
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function relativeDay(d: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000)
  if (diff === 0) return 'Aujourd’hui'
  if (diff === 1) return 'Demain'
  if (diff === -1) return 'Hier'
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « 17:30 » */
export const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)
