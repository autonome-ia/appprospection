import { useEffect, useRef, useState } from 'react'
import { Search, X, MapPin, History } from 'lucide-react'

export interface AddressResult {
  label: string
  context: string
  lng: number
  lat: number
}

interface Props {
  onSelect: (result: AddressResult) => void
}

const BAN_URL = 'https://data.geopf.fr/geocodage/search/'

// Point de référence des recherches (retour briac 24/09 : « 24 rue du
// Rétalaire » doit d'abord proposer celle d'à côté, pas celle à 500 km) :
// le CENTRE DE LA CARTE — là où l'on prospecte, ou la zone qu'on prépare
// depuis le canapé ; marche sans GPS. Tenu à jour par MapView à chaque arrêt
// de la caméra ; repli sur la dernière caméra mémorisée (formulaires ouverts
// hors carte).
let bias: { lng: number; lat: number } | null = null
export function setSearchBias(lng: number, lat: number) {
  bias = { lng, lat }
}
function currentBias(): { lng: number; lat: number } | null {
  if (bias) return bias
  try {
    const cam = JSON.parse(localStorage.getItem('map-camera-v1') ?? 'null') as { lng?: number; lat?: number } | null
    if (cam && Number.isFinite(cam.lng) && Number.isFinite(cam.lat)) return { lng: cam.lng!, lat: cam.lat! }
  } catch {
    /* stockage indisponible : recherche sans préférence */
  }
  return null
}

/** Distance approchée en km (équirectangulaire : largement assez pour trier). */
function distKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const y = ((b.lat - a.lat) * Math.PI) / 180
  return Math.sqrt(x * x + y * y) * 6371
}

/** « 24 Rue du Rétalaire 29260 Lesneven » → « 24 rue du retalaire » (sans
    ville ni accents) : ce qui distingue deux homonymes, c'est la commune. */
const streetKey = (label: string) =>
  label
    .replace(/\s+\d{5}\s.*$/, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

// Code postal ET département de la zone regardée (géocodage inverse du point
// de référence), en cache par maille de ~2 km : une requête par secteur, pas
// par frappe. Département : 1er terme du contexte BAN (« 29, Finistère,
// Bretagne ») — gère 2A/2B et les DOM à 3 chiffres.
type Zone = { postcode: string | null; depcode: string | null }
const zoneCache = new Map<string, Promise<Zone | null>>()
function zoneNear(near: { lng: number; lat: number }): Promise<Zone | null> {
  const key = `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`
  let p = zoneCache.get(key)
  if (!p) {
    p = fetch(`https://data.geopf.fr/geocodage/reverse/?lat=${near.lat}&lon=${near.lng}&limit=1`)
      .then((r) => r.json())
      .then((j) => {
        const props = j.features?.[0]?.properties as { postcode?: string; context?: string } | undefined
        if (!props) return null
        const dep = props.context?.split(',')[0]?.trim()
        return { postcode: props.postcode ?? null, depcode: dep && /^[0-9AB]{2,3}$/.test(dep) ? dep : null }
      })
      .catch(() => {
        zoneCache.delete(key) // échec réseau : on retentera
        return null
      })
    zoneCache.set(key, p)
  }
  return p
}

type BanFeature = {
  geometry: { coordinates: [number, number] }
  properties: { label: string; context?: string; score?: number }
}
const toResult = (f: BanFeature): AddressResult & { score: number } => ({
  label: f.properties.label,
  context: f.properties.context ?? '',
  lng: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  score: f.properties.score ?? 0,
})

async function banSearch(q: string, extra: string, signal?: AbortSignal) {
  const res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&autocomplete=1${extra}`, { signal })
  const json = await res.json()
  return ((json.features ?? []) as BanFeature[]).map(toResult)
}

// Pertinence minimale d'un résultat LOCAL pour passer devant : sous ce seuil,
// on cherchait sans doute ailleurs (« 24 rue de la paix nantes » ne remonte
// qu'à 0,62 dans le 29260, contre 0,96 sans la ville).
const LOCAL_MIN_SCORE = 0.7

/** Recherche BAN — partagée avec les champs adresse des formulaires RDV et
    contact (audit UX B12). L'appelant gère debounce et annulation.
    Proximité (retours briac 24/09) : la préférence lat/lon de la BAN est trop
    faible (« 24 rue de la paix » depuis Lesneven : Quimper, Cherbourg… et
    pas Le Folgoët, pourtant à 2 km, même dans les 20 premiers). Trois
    requêtes en parallèle : CODE POSTAL de la zone regardée, DÉPARTEMENT
    (Lesneven → Brest avant Paris), et nationale (avec préférence). Les
    résultats locaux pertinents passent devant, triés par distance ; les
    homonymes restants sont rangés du plus proche au plus lointain. */
export async function searchAddresses(q: string, signal?: AbortSignal): Promise<AddressResult[]> {
  const near = currentBias()
  const nearParams = near ? `&lat=${near.lat.toFixed(5)}&lon=${near.lng.toFixed(5)}` : ''
  const zone = near ? zoneNear(near) : Promise.resolve(null)
  const [global, byPostcode, byDep] = await Promise.all([
    banSearch(q, `&limit=8${nearParams}`, signal),
    zone.then((z) => (z?.postcode ? banSearch(q, `&limit=5&postcode=${z.postcode}`, signal).catch(() => []) : [])),
    zone.then((z) =>
      z?.depcode ? banSearch(q, `&limit=10&depcode=${z.depcode}${nearParams}`, signal).catch(() => []) : [],
    ),
  ])
  const local = [...byPostcode, ...byDep.filter((r) => !byPostcode.some((x) => x.label === r.label))]
  const byDistance = (a: AddressResult, b: AddressResult) => (near ? distKm(near, a) - distKm(near, b) : 0)
  // Numéro tapé (« 24 rue… ») : les adresses qui PORTENT ce numéro passent
  // devant les rues nues (« rue de la Paix, Landerneau » n'est pas un 24),
  // puis la distance départage.
  const num = q.match(/^\s*(\d+)/)?.[1]
  const hasNum = (r: AddressResult) => (num && r.label.startsWith(`${num} `) ? 0 : 1)
  const localFirst = local
    .filter((r) => r.score >= LOCAL_MIN_SCORE)
    .sort((a, b) => hasNum(a) - hasNum(b) || byDistance(a, b))
  const seen = new Set(localFirst.map((r) => r.label))
  const rest = global.filter((r) => !seen.has(r.label))
  if (near) {
    // Homonymes (même numéro + même rue, communes différentes) : chaque groupe
    // garde la place de son premier représentant, le plus proche devant.
    const firstIdx = new Map<string, number>()
    rest.forEach((r, i) => {
      const k = streetKey(r.label)
      if (!firstIdx.has(k)) firstIdx.set(k, i)
    })
    rest.sort((a, b) => firstIdx.get(streetKey(a.label))! - firstIdx.get(streetKey(b.label))! || byDistance(a, b))
  }
  return [...localFirst, ...rest].slice(0, 6).map(({ label, context, lng, lat }) => ({ label, context, lng, lat }))
}

// Dernières adresses CHOISIES (pas les frappes), mémorisées sur l'appareil :
// proposées quand on touche le champ vide — retour rapide sur ses secteurs.
const RECENT_KEY = 'recent-addresses'
const MAX_RECENT = 5

function loadRecents(): AddressResult[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as AddressResult[]) : []
    return Array.isArray(list) ? list.filter((r) => r && typeof r.label === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(r: AddressResult): AddressResult[] {
  const next = [r, ...loadRecents().filter((x) => x.label !== r.label)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* stockage plein ou privé : tant pis, les récentes sont un confort */
  }
  return next
}

/** Barre de recherche d'adresse française via la BAN (Base Adresse Nationale). */
export function AddressSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressResult[]>([])
  const [recents, setRecents] = useState<AddressResult[]>(loadRecents)
  const [open, setOpen] = useState(false)
  // Évite de relancer une recherche après avoir choisi un résultat.
  const skipNextRef = useRef(false)

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      return
    }
    const q = query.trim()
    if (q.length < 3) {
      setResults([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const rs = await searchAddresses(q, controller.signal)
        setResults(rs)
        setOpen(true)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error('Recherche adresse :', e)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  function choose(r: AddressResult) {
    skipNextRef.current = true
    setQuery(r.label)
    setResults([])
    setOpen(false)
    setRecents(saveRecent(r))
    // Ferme le clavier iOS : les résultats empêchent le blur (onMouseDown
    // preventDefault) pour gagner contre le onBlur différé — sans blur
    // explicite, le clavier restait déployé sur la moitié basse de l'écran,
    // pile là où atterrit la maison cherchée.
    ;(document.activeElement as HTMLElement | null)?.blur()
    onSelect(r)
  }

  // Champ (quasi) vide : on propose les dernières adresses visitées.
  const showRecents = query.trim().length < 3 && recents.length > 0
  const shown = showRecents ? recents : results

  return (
    <div className="address-search">
      <div className="address-field">
        <Search size={17} strokeWidth={1.9} className="address-icon" />
        <input
          className="address-input"
          type="text"
          placeholder="Rechercher une adresse…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => (results.length > 0 || showRecents) && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        {query && (
          <button
            type="button"
            className="address-clear"
            aria-label="Effacer"
            onClick={() => {
              setQuery('')
              setResults([])
              setOpen(false)
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {open && shown.length > 0 && (
        <ul className="address-results">
          {showRecents && <li className="address-caption eyebrow">Récentes</li>}
          {shown.map((r, i) => (
            <li key={i}>
              {/* onMouseDown : le tap doit gagner contre le blur du champ. */}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
                {showRecents ? (
                  <History size={15} strokeWidth={1.8} className="address-result-icon" />
                ) : (
                  <MapPin size={15} strokeWidth={1.8} className="address-result-icon" />
                )}
                <span className="address-texts">
                  <span className="address-label">{r.label}</span>
                  {r.context && <span className="address-context">{r.context}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
