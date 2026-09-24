// « 6 Rue de Dixmude 29260 Lesneven » → rue + ville (chantier design 24/09) :
// la rue titre la fiche, la ville passe en ligne secondaire. Adresse BAN
// sans code postal reconnaissable : tout en rue, ville vide.
export function splitAddress(address: string | null | undefined): { street: string; city: string } {
  const a = (address ?? '').trim()
  const m = a.match(/^(.*?)[\s,]+(\d{5}\s+.+)$/)
  return m ? { street: m[1], city: m[2] } : { street: a, city: '' }
}
