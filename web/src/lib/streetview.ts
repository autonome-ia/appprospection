import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

// Google Street View (360° navigable). Nécessite une clé Google Maps
// (VITE_GOOGLE_MAPS_KEY) avec l'API "Maps JavaScript API" activée.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
export const hasGoogleStreetView = !!KEY

let configured = false
function ensureConfigured() {
  if (!configured && KEY) {
    setOptions({ key: KEY, v: 'weekly' })
    configured = true
  }
}

/** Cap (heading) du point `from` vers le point `to`, en degrés. */
function headingBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLng = (to.lng - from.lng) * rad
  const lat1 = from.lat * rad
  const lat2 = to.lat * rad
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

/**
 * Ouvre une vue Street View navigable dans `container`, orientée vers le point.
 * Élargit le rayon si aucune image proche. Retourne false si rien trouvé.
 */
export async function openGoogleStreetView(
  container: HTMLElement,
  lng: number,
  lat: number,
): Promise<boolean> {
  if (!KEY) return false
  ensureConfigured()
  const { StreetViewService, StreetViewPanorama } = await importLibrary('streetView')
  const service = new StreetViewService()

  for (const radius of [50, 150, 500]) {
    try {
      const { data } = await service.getPanorama({ location: { lat, lng }, radius })
      const loc = data.location
      if (loc?.pano && loc.latLng) {
        const from = { lat: loc.latLng.lat(), lng: loc.latLng.lng() }
        new StreetViewPanorama(container, {
          pano: loc.pano,
          pov: { heading: headingBetween(from, { lat, lng }), pitch: 0 },
          zoom: 0,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
        })
        return true
      }
    } catch {
      // ZERO_RESULTS : on tente un rayon plus large.
    }
  }
  return false
}
