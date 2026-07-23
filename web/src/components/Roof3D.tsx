import { useEffect, useRef, useState } from 'react'
import { Box, X } from 'lucide-react'
import type { LidarPan } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'

interface Props {
  /** Pans mesurés du toit (statut ok). La maquette exige les altitudes (v6+). */
  pans: LidarPan[]
}

// Même filtre que lib/roof3d.isPan3D — dupliqué ici (3 conditions) pour ne pas
// charger le chunk three juste pour savoir s'il faut afficher le bouton.
function pans3d(pans: LidarPan[]): LidarPan[] {
  return pans.filter(
    (p) =>
      p.contour &&
      p.contour.length >= 4 &&
      p.alts &&
      p.alts.length === p.contour.length &&
      p.m2 >= 10,
  )
}

/**
 * Maquette 3D du toit mesuré, dans la fiche maison : bouton « Voir le toit en
 * 3D » → canvas manipulable au doigt (three.js chargé à ce moment-là) +
 * légende par pan (couleurs partagées avec le dessin sur l'ortho).
 */
export function Roof3D({ pans }: Props) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const drawable = pans3d(pans)

  useEffect(() => {
    if (!open) return
    const holder = holderRef.current
    if (!holder) return
    let disposed = false
    let handle: { dispose(): void } | null = null
    import('../lib/roof3d')
      .then((m) => {
        if (disposed || !holder.isConnected) return
        handle = m.mountRoofScene(holder, pans)
      })
      .catch((e) => {
        console.error('Maquette 3D :', e)
        setFailed(true)
      })
    return () => {
      disposed = true
      handle?.dispose()
    }
    // Remonter la scène si les pans changent (re-mesure arrivée par realtime).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pans])

  if (drawable.length === 0 || failed) return null

  if (!open) {
    return (
      <button type="button" className="roof3d-btn" onClick={() => setOpen(true)}>
        <Box size={15} strokeWidth={1.9} />
        Voir le toit en 3D
      </button>
    )
  }

  return (
    <div className="roof3d">
      {/* Le drag du canvas pilote la caméra, pas la sheet (vaul). */}
      <div
        ref={holderRef}
        className="roof3d-canvas"
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchMoveCapture={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="icon-btn roof3d-close"
          onClick={() => setOpen(false)}
          aria-label="Fermer la maquette 3D"
        >
          <X size={16} />
        </button>
      </div>
      <div className="roof3d-legend">
        {drawable.map((p, i) => (
          <span
            key={i}
            className="pan-chip tnum"
            style={{ borderColor: PAN_COLORS[i % PAN_COLORS.length] }}
          >
            {p.m2} m² · {p.pente_deg}°
          </span>
        ))}
      </div>
    </div>
  )
}
