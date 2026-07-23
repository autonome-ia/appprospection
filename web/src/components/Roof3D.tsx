import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Maximize2, X } from 'lucide-react'
import type { LidarPan, RoofData } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'

interface Props {
  /** Toit mesuré (statut ok). La maquette exige les altitudes (v6+). */
  roof: RoofData
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
 * 3D » → maquette manipulable au doigt (three.js chargé à ce moment-là) +
 * légende par pan (couleurs partagées avec l'ortho). Mode plein écran (portal,
 * pas l'API Fullscreen : indisponible sur iPhone) pour la démo client.
 */
export function Roof3D({ roof }: Props) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [failed, setFailed] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const drawable = pans3d(roof.pans)

  useEffect(() => {
    if (!open) return
    const holder = holderRef.current
    if (!holder) return
    let disposed = false
    let handle: { dispose(): void } | null = null
    import('../lib/roof3d')
      .then((m) => {
        if (disposed || !holder.isConnected) return
        handle = m.mountRoofScene(holder, roof)
      })
      .catch((e) => {
        console.error('Maquette 3D :', e)
        setFailed(true)
      })
    return () => {
      disposed = true
      handle?.dispose()
    }
    // `full` déplace le canvas dans le portal : on remonte la scène (rapide).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, full, roof])

  if (drawable.length === 0 || failed) return null

  if (!open) {
    return (
      <button type="button" className="roof3d-btn" onClick={() => setOpen(true)}>
        <Box size={15} strokeWidth={1.9} />
        Voir le toit en 3D
      </button>
    )
  }

  const legend = (
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
  )

  // Le drag du canvas pilote la caméra : on bloque la REMONTÉE (bulle) vers la
  // sheet vaul — jamais la descente (capture), qui empêchait OrbitControls de
  // recevoir le geste (maquette figée, retour briac).
  const holder = (
    <div
      ref={holderRef}
      className="roof3d-canvas"
      onPointerDown={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="roof3d-tools">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setFull((v) => !v)}
          aria-label={full ? 'Réduire' : 'Plein écran'}
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setFull(false)
            setOpen(false)
          }}
          aria-label="Fermer la maquette 3D"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )

  if (full) {
    // Portal : la sheet vaul est transformée (translate), un position:fixed à
    // l'intérieur serait relatif à elle — on sort dans <body>.
    return createPortal(
      <div className="roof3d roof3d-full">
        {holder}
        {legend}
      </div>,
      document.body,
    )
  }

  return (
    <div className="roof3d">
      {holder}
      {legend}
    </div>
  )
}
