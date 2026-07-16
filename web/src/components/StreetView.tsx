import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { findNearestStreetImage } from '../lib/mapillary'

interface Props {
  lng: number
  lat: number
  onClose: () => void
}

/** Vue rue : photo Mapillary la plus proche du point (affichage simple et robuste). */
export function StreetView({ lng, lat, onClose }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    findNearestStreetImage(lng, lat)
      .then((u) => {
        if (!active) return
        if (u) {
          setUrl(u)
          setState('ok')
        } else {
          setState('none')
        }
      })
      .catch(() => active && setState('none'))
    return () => {
      active = false
    }
  }, [lng, lat])

  return (
    <div className="street-overlay">
      <button type="button" className="street-close" onClick={onClose} aria-label="Fermer">
        <X size={20} />
      </button>

      {state === 'ok' && url && <img className="street-img" src={url} alt="Vue de la rue" />}
      {state === 'loading' && <div className="street-msg">Recherche d’une vue de rue…</div>}
      {state === 'none' && (
        <div className="street-msg">
          Pas d’imagerie de rue disponible ici.
          <br />
          <span className="street-msg-sub">(Zone non couverte par Mapillary)</span>
        </div>
      )}
    </div>
  )
}
