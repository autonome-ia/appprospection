import { useEffect, useRef, useState } from 'react'
import { Viewer } from 'mapillary-js'
import 'mapillary-js/dist/mapillary.css'
import { X } from 'lucide-react'
import { findNearestImage, MAPILLARY_TOKEN } from '../lib/mapillary'

interface Props {
  lng: number
  lat: number
  onClose: () => void
}

/** Vue rue immersive (Mapillary) autour d'un point. */
export function StreetView({ lng, lat, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')

  useEffect(() => {
    let viewer: Viewer | null = null
    let active = true
    const timers: number[] = []

    findNearestImage(lng, lat)
      .then((id) => {
        if (!active) return
        if (!id || !containerRef.current) {
          setState('none')
          return
        }
        setState('ok')
        viewer = new Viewer({
          accessToken: MAPILLARY_TOKEN,
          container: containerRef.current,
          imageId: id,
          component: { cover: false },
        })
        // Corrige le rendu noir : le conteneur n'a sa taille finale
        // qu'après l'affichage → on force un recalcul.
        for (const delay of [100, 400, 900]) {
          timers.push(
            window.setTimeout(() => {
              try {
                viewer?.resize()
              } catch {
                /* viewer déjà retiré */
              }
            }, delay),
          )
        }
      })
      .catch(() => active && setState('none'))

    return () => {
      active = false
      timers.forEach(clearTimeout)
      viewer?.remove()
    }
  }, [lng, lat])

  return (
    <div className="street-overlay">
      <button type="button" className="street-close" onClick={onClose} aria-label="Fermer">
        <X size={20} />
      </button>
      <div ref={containerRef} className="street-canvas" />
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
