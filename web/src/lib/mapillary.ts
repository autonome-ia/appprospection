// Imagerie de rue Mapillary (gratuit, ouvert). Nécessite un jeton client
// (VITE_MAPILLARY_TOKEN) créé sur mapillary.com/dashboard/developers.
// On affiche la photo de rue la plus proche (approche simple et robuste,
// sans moteur WebGL qui entrerait en conflit avec la carte MapLibre).

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN

export const hasMapillary = !!TOKEN

interface MapillaryImage {
  id: string
  computed_geometry?: { coordinates: [number, number] }
  thumb_2048_url?: string
}

async function queryNearest(lng: number, lat: number, d: number): Promise<string | null> {
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`
  const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,computed_geometry,thumb_2048_url&bbox=${bbox}&limit=50`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { data?: MapillaryImage[] }
  const imgs = json.data ?? []
  if (!imgs.length) return null

  let best: MapillaryImage | null = null
  let bestDist = Infinity
  for (const im of imgs) {
    const c = im.computed_geometry?.coordinates
    if (!c || !im.thumb_2048_url) continue
    const dist = (c[0] - lng) ** 2 + (c[1] - lat) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = im
    }
  }
  return best?.thumb_2048_url ?? imgs.find((i) => i.thumb_2048_url)?.thumb_2048_url ?? null
}

/**
 * URL de la photo de rue la plus proche d'un point, en élargissant
 * progressivement la recherche (~130 m → ~450 m → ~1,1 km). null si aucune.
 */
export async function findNearestStreetImage(lng: number, lat: number): Promise<string | null> {
  if (!TOKEN) return null
  for (const d of [0.0012, 0.004, 0.01]) {
    const url = await queryNearest(lng, lat, d)
    if (url) return url
  }
  return null
}
