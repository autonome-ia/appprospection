import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { openGoogleStreetView, hasGoogleStreetView } from '../lib/streetview'
import { findNearestStreetImage, hasMapillary } from '../lib/mapillary'

interface Props {
  lng: number
  lat: number
  onClose: () => void
}

/** Vue rue : Google Street View (navigable) en priorité, photo Mapillary en secours. */
export function StreetView({ lng, lat, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'google' | 'photo' | 'none'>('loading')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      // 1) Google Street View (360° navigable)
      if (hasGoogleStreetView && containerRef.current) {
        try {
          const ok = await openGoogleStreetView(containerRef.current, lng, lat)
          if (!active) return
          if (ok) {
            setState('google')
            return
          }
        } catch (e) {
          console.error('Street View :', e)
        }
      }
      if (!active) return
      // 2) Secours : photo Mapillary la plus proche
      if (hasMapillary) {
        try {
          const u = await findNearestStreetImage(lng, lat)
          if (!active) return
          if (u) {
            setPhotoUrl(u)
            setState('photo')
            return
          }
        } catch (e) {
          console.error('Mapillary :', e)
        }
      }
      if (active) setState('none')
    })()
    return () => {
      active = false
    }
  }, [lng, lat])

  return (
    <div className="street-overlay">
      <button type="button" className="street-close" onClick={onClose} aria-label="Fermer">
        <X size={20} />
      </button>

      <div
        ref={containerRef}
        className="street-canvas"
        style={{ visibility: state === 'google' ? 'visible' : 'hidden' }}
      />
      {state === 'photo' && photoUrl && <img className="street-img" src={photoUrl} alt="Vue de la rue" />}
      {state === 'loading' && <div className="street-msg">Chargement de la vue rue…</div>}
      {state === 'none' && (
        <div className="street-msg">
          Pas d’imagerie de rue disponible ici.
          <br />
          <span className="street-msg-sub">(Aucune vue Google ni Mapillary sur ce secteur)</span>
        </div>
      )}
    </div>
  )
}
