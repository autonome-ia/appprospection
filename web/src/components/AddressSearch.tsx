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
        const url = `${BAN_URL}?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`
        const res = await fetch(url, { signal: controller.signal })
        const json = await res.json()
        const rs: AddressResult[] = (json.features ?? []).map(
          (f: {
            geometry: { coordinates: [number, number] }
            properties: { label: string; context?: string }
          }) => ({
            label: f.properties.label,
            context: f.properties.context ?? '',
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }),
        )
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
