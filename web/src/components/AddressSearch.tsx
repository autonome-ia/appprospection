import { useEffect, useRef, useState } from 'react'
import { Search, X, MapPin } from 'lucide-react'

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

/** Barre de recherche d'adresse française via la BAN (Base Adresse Nationale). */
export function AddressSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressResult[]>([])
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
      setOpen(false)
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
    onSelect(r)
  }

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
          onFocus={() => results.length > 0 && setOpen(true)}
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
      {open && results.length > 0 && (
        <ul className="address-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(r)}>
                <MapPin size={15} strokeWidth={1.8} className="address-result-icon" />
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
