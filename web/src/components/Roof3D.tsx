import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Maximize2, X } from 'lucide-react'
import type { LidarPan, RoofData } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'
import type { RoofSceneHandle } from '../lib/roof3d'

interface Props {
  /** Toit mesuré (statut ok). La maquette exige les altitudes (v6+). */
  roof: RoofData
}

// Même filtre que lib/roof3d.isPan3D — dupliqué ici (3 conditions) pour ne pas
// charger le chunk three juste pour savoir s'il faut afficher le bouton.
function pans3d(pans: LidarPan[]): { pan: LidarPan; idx: number }[] {
  return pans
    .map((pan, idx) => ({ pan, idx }))
    .filter(
      ({ pan }) =>
        pan.contour &&
        pan.contour.length >= 4 &&
        pan.alts &&
        pan.alts.length === pan.contour.length &&
        pan.m2 >= 10,
    )
}

// Présélection = « la maison » (drapeau v17) ; à défaut : tout sauf les plats.
function defaultExcluded(pans: LidarPan[]): Set<number> {
  const hasFlags = pans.some((p) => p.maison !== undefined)
  const out = new Set<number>()
  for (const [i, p] of pans.entries()) {
    if (hasFlags ? !p.maison : p.type === 'plat') out.add(i)
  }
  return out
}

/**
 * Maquette 3D du toit mesuré, dans la fiche maison. Niveau 3 : chaque pan est
 * COCHABLE (tap sur le pan, sa pastille ou sa puce de légende) — le total
 * « sélection » suit en direct. Présélection : le corps principal (« la
 * maison », hors annexes/extensions) ; le commercial ajuste devant le client.
 */
export function Roof3D({ roof }: Props) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [failed, setFailed] = useState(false)
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => defaultExcluded(roof.pans))
  const holderRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RoofSceneHandle | null>(null)
  // Le toggle est lu par la scène via une ref : pas de re-montage à chaque tap.
  const toggleRef = useRef<(idx: number) => void>(() => {})
  toggleRef.current = (idx) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  const drawable = pans3d(roof.pans)

  useEffect(() => {
    if (!open) return
    const holder = holderRef.current
    if (!holder) return
    let disposed = false
    let handle: RoofSceneHandle | null = null
    const excludedAtMount = excluded
    import('../lib/roof3d')
      .then((m) => {
        if (disposed || !holder.isConnected) return
        handle = m.mountRoofScene(holder, roof, {
          onTogglePan: (idx) => toggleRef.current(idx),
        })
        handle.setExcluded(excludedAtMount)
        handleRef.current = handle
      })
      .catch((e) => {
        console.error('Maquette 3D :', e)
        setFailed(true)
      })
    return () => {
      disposed = true
      handle?.dispose()
      handleRef.current = null
    }
    // `full` déplace le canvas dans le portal : on remonte la scène (rapide).
    // `excluded` est appliqué via setExcluded, sans re-montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, full, roof])

  useEffect(() => {
    handleRef.current?.setExcluded(excluded)
  }, [excluded])

  if (drawable.length === 0 || failed) return null

  if (!open) {
    return (
      <button type="button" className="roof3d-btn" onClick={() => setOpen(true)}>
        <Box size={15} strokeWidth={1.9} />
        Voir le toit en 3D
      </button>
    )
  }

  const selectionM2 = roof.pans.reduce((s, p, i) => (excluded.has(i) ? s : s + p.m2), 0)

  const legend = (
    <div className="roof3d-legend">
      <span className="pan-chip tnum roof3d-total" title="Somme des pans sélectionnés">
        Σ {selectionM2} m²
      </span>
      {drawable.map(({ pan, idx }, i) => (
        <button
          key={idx}
          type="button"
          className={`pan-chip tnum roof3d-toggle ${excluded.has(idx) ? 'is-off' : ''}`}
          style={{ borderColor: PAN_COLORS[i % PAN_COLORS.length] }}
          onClick={() => toggleRef.current(idx)}
          title={excluded.has(idx) ? 'Exclu — taper pour inclure' : 'Inclus — taper pour exclure'}
        >
          {pan.m2} m² · {pan.pente_deg}°
        </button>
      ))}
    </div>
  )

  // Le drag du canvas pilote la caméra : on bloque la REMONTÉE (bulle) vers la
  // sheet vaul — jamais la descente (capture), qui empêchait OrbitControls de
  // recevoir le geste.
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
