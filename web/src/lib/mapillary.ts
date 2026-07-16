// Imagerie de rue Mapillary (gratuit, ouvert). Nécessite un jeton client
// (VITE_MAPILLARY_TOKEN) créé sur mapillary.com/dashboard/developers.

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN

export const hasMapillary = !!TOKEN
export const MAPILLARY_TOKEN = TOKEN ?? ''

interface MapillaryImage {
  id: string
  computed_geometry?: { coordinates: [number, number] }
}

async function queryNearest(lng: number, lat: number, d: number): Promise<string | null> {
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`
  const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,computed_geometry&bbox=${bbox}&limit=50`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { data?: MapillaryImage[] }
  const imgs = json.data ?? []
  if (!imgs.length) return null

  let bestId: string | null = null
  let bestDist = Infinity
  for (const im of imgs) {
    const c = im.computed_geometry?.coordinates
    if (!c) continue
    const dist = (c[0] - lng) ** 2 + (c[1] - lat) ** 2
    if (dist < bestDist) {
      bestDist = dist
      bestId = im.id
    }
  }
  return bestId ?? imgs[0].id
}

/**
 * Trouve l'image Mapillary la plus proche d'un point, en élargissant
 * progressivement la recherche (~130 m → ~450 m → ~1,1 km). null si aucune.
 */
export async function findNearestImage(lng: number, lat: number): Promise<string | null> {
  if (!TOKEN) return null
  for (const d of [0.0012, 0.004, 0.01]) {
    const id = await queryNearest(lng, lat, d)
    if (id) return id
  }
  return null
}
