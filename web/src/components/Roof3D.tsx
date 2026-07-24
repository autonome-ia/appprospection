import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Maximize2, X } from 'lucide-react'
import type { LidarPan, RoofData } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'
import type { RoofSceneHandle } from '../lib/roof3d'

interface Props {
  /** Toit mesuré (statut ok). La maquette exige les altitudes (v6+). */
  roof: RoofData
  /** % de chutes suggéré (suggestedWastePct) — ligne « surface de commande ». */
  wastePct?: number | null
}

/** Ligne des longueurs d'arêtes (v19) — seules les non nulles. */
function edgesLine(roof: RoofData): string | null {
  const a = roof.aretes
  if (!a) return null
  const parts = (
    [
      ['Faîtage', a.faitage_m],
      ['Arêtiers', a.aretier_m],
      ['Noues', a.noue_m],
      ['Rives', a.rive_m],
      ['Égouts', a.egout_m],
      ['Solins', a.solin_m],
    ] as [string, number][]
  )
    .filter(([, v]) => v >= 1)
    .map(([k, v]) => `${k} ${v} m`)
  return parts.length ? parts.join(' · ') : null
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
export function Roof3D({ roof, wastePct }: Props) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [failed, setFailed] = useState(false)
  // Remontage forcé quand le contexte WebGL est perdu sans retour (iOS).
  const [retry, setRetry] = useState(0)
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => defaultExcluded(roof.pans))
  // `roof` change d'identité quand une NOUVELLE mesure arrive (backfill,
  // montée de version) : les index d'exclusion pointeraient sur les anciens
  // pans — on repart de la présélection « maison » du nouveau toit.
  useEffect(() => {
    setExcluded(defaultExcluded(roof.pans))
  }, [roof])
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
  }, [open, full, roof, retry])

  // Retour au premier plan avec un contexte WebGL resté mort (three n'a pas
  // reçu webglcontextrestored) : on remonte la scène — reconstruction en
  // quelques ms depuis RoofData, aucun asset réseau.
  useEffect(() => {
    if (!open) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      window.setTimeout(() => {
        if (handleRef.current?.isContextLost()) setRetry((v) => v + 1)
      }, 1000)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [open])

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

  // Couleur de légende alignée sur la scène (index dans les pans DESSINABLES).
  // Les pans trop petits pour la 3D restent listés — sans puce colorée — pour
  // que TOUT ce qui compte dans le Σ soit visible et cochable.
  const colorOf = new Map(drawable.map(({ idx }, i) => [idx, PAN_COLORS[i % PAN_COLORS.length]]))

  const edges = edgesLine(roof)

  const legend = (
    <>
      <div className="roof3d-legend">
        <span className="pan-chip tnum roof3d-total" title="Somme des pans sélectionnés">
          Σ {selectionM2} m²
        </span>
        {roof.pans.map((pan, idx) => (
          <button
            key={idx}
            type="button"
            className={`pan-chip tnum roof3d-toggle ${excluded.has(idx) ? 'is-off' : ''}`}
            style={{ borderColor: colorOf.get(idx) ?? 'var(--line)' }}
            onClick={() => toggleRef.current(idx)}
            title={excluded.has(idx) ? 'Exclu — taper pour inclure' : 'Inclus — taper pour exclure'}
          >
            {pan.m2} m² · {pan.pente_deg}°
          </button>
        ))}
        {wastePct != null && wastePct > 0 && selectionM2 > 0 && (
          <span
            className="pan-chip tnum roof3d-waste"
            title="Surface de commande estimée : sélection + chutes de coupe (selon matériau et complexité du toit) — pourcentage indicatif, à valider sur les factures"
          >
            + chutes ~{wastePct} % ≈ {Math.round(selectionM2 * (1 + wastePct / 100))} m²
          </span>
        )}
      </div>
      {edges && (
        <p
          className="roof3d-edges tnum"
          title="Longueurs mesurées au laser par type d'arête (faîtières, gouttières, rives…)"
        >
          {edges}
        </p>
      )}
    </>
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
