// Météo du jour à la position du commercial — MET Norway (api.met.no,
// Locationforecast 2.0) : gratuit Y COMPRIS commercial (CC BY 4.0), sans clé,
// CORS ouvert — même philosophie que BAN/IGN. Remplace Open-Meteo dont le
// palier gratuit est réservé au non-commercial (bascule 10/08/2026).
// Conditions met.no : GET nu SANS header custom (préflight CORS non
// supporté — l'identification passe par le header Origin, automatique),
// lat/lon ≤ 4 décimales, cache ~30 min, attribution « MET Norway ».
//
// Contrat UX : la météo est un bonus SILENCIEUX. Géoloc refusée, indisponible,
// API en panne → null, jamais d'erreur visible, l'Accueil ne l'attend pas.

export type Weather = {
  /** °C, arrondie à l'affichage. */
  temp: number
  /** symbol_code met.no (ex. « clearsky_day », « lightrainshowers_night »). */
  symbol: string
}

const CACHE_KEY = 'meteo-cache-v2'
const CACHE_TTL = 30 * 60 * 1000 // 30 min : pas une app météo.

function readCache(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Weather & { at: number }
    if (Date.now() - c.at > CACHE_TTL) return null
    return { temp: c.temp, symbol: c.symbol }
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

type MetNoResponse = {
  properties?: {
    timeseries?: Array<{
      data?: {
        instant?: { details?: { air_temperature?: number } }
        next_1_hours?: { summary?: { symbol_code?: string } }
        next_6_hours?: { summary?: { symbol_code?: string } }
      }
    }>
  }
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
    // 3 décimales (~100 m) : assez pour la météo, sous la limite met.no (4).
    const lat = pos.coords.latitude.toFixed(3)
    const lon = pos.coords.longitude.toFixed(3)
    const r = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
    )
    if (!r.ok) return null
    const json = (await r.json()) as MetNoResponse
    const now = json.properties?.timeseries?.[0]?.data
    const temp = now?.instant?.details?.air_temperature
    // next_1_hours couvre les ~60 premières heures — présent pour l'instant
    // courant, next_6_hours en filet.
    const symbol = now?.next_1_hours?.summary?.symbol_code ?? now?.next_6_hours?.summary?.symbol_code
    if (typeof temp !== 'number' || !symbol) return null
    const w: Weather = { temp, symbol }
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
