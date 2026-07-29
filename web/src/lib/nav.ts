/**
 * Lien universel Waze (ouvre l'app en navigation, repli site web) : les
 * coordonnées du point priment sur l'adresse texte — c'est LA maison, pas
 * le géocodage approximatif du numéro de rue (règle du 25/07).
 * (Vivait dans ClientSheet ; extrait ici à la fusion des fiches, 29/07.)
 */
export function wazeUrl(
  point: { lng: number; lat: number } | null | undefined,
  address: string | null,
): string | null {
  if (point) return `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`
  if (address) return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`
  return null
}
