// Météo du jour à la position du commercial — Open-Meteo (open-meteo.com),
// gratuit et sans clé comme BAN/IGN, données CC-BY 4.0 (attribution dans le
// title du chip). Palier gratuit NON-commercial : à re-vérifier si l'app
// devient un SaaS payant (plan API payant ou autre source).
//
// Contrat UX : la météo est un bonus SILENCIEUX. Géoloc refusée, indisponible,
// API en panne → null, jamais d'erreur visible, l'Accueil ne l'attend pas.

export type Weather = {
  /** °C, arrondie à l'affichage. */
  temp: number
  /** Code WMO (weather_code Open-Meteo). */
  code: number
  isDay: boolean
}

const CACHE_KEY = 'meteo-cache-v1'
const CACHE_TTL = 30 * 60 * 1000 // 30 min : pas une app météo.

function readCache(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Weather & { at: number }
    if (Date.now() - c.at > CACHE_TTL) return null
    return { temp: c.temp, code: c.code, isDay: c.isDay }
  } catch {
    return null
  }
}

function locate(): Promise<GeolocationPosition> {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 15 * 60 * 1000,
    }),
  )
}

async function fetchWeather(): Promise<Weather | null> {
  const cached = readCache()
  if (cached) return cached
  try {
    // On ne géolocalise QUE si la permission est déjà accordée (elle l'est
    // dès la première utilisation de la carte) : pas de prompt surprise sur
    // l'Accueil. Permissions API absente → on renonce, même silence.
    if (!('permissions' in navigator) || !('geolocation' in navigator)) return null
    const perm = await navigator.permissions.query({ name: 'geolocation' })
    if (perm.state !== 'granted') return null
    const pos = await locate()
    // 2 décimales (~1 km) : largement assez pour la météo.
    const lat = pos.coords.latitude.toFixed(2)
    const lon = pos.coords.longitude.toFixed(2)
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`,
    )
    if (!r.ok) return null
    const json = (await r.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number }
    }
    const c = json.current
    if (typeof c?.temperature_2m !== 'number' || typeof c.weather_code !== 'number') return null
    const w: Weather = { temp: c.temperature_2m, code: c.weather_code, isDay: c.is_day !== 0 }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...w, at: Date.now() }))
    } catch {
      /* stockage plein : tant pis, on re-fetchera */
    }
    return w
  } catch {
    return null
  }
}

// Une seule requête même si deux composants montent en même temps.
let inflight: Promise<Weather | null> | null = null
export function getWeather(): Promise<Weather | null> {
  inflight ??= fetchWeather().finally(() => {
    inflight = null
  })
  return inflight
}
