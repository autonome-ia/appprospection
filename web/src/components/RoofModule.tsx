import { useEffect, useState } from 'react'
import { Box, ChevronDown } from 'lucide-react'
import type { RoofData } from '../domain/house'
import { Roof3D, defaultExcluded } from './Roof3D'
import { RoofDiagram } from './RoofDiagram'
import { RoofReport } from './RoofReport'

interface Props {
  roof: RoofData
  /** % de chutes suggéré (suggestedWastePct). */
  wastePct: number
  address: string | null
  maisonM2: number | null
  totalM2: number | null
  millesime: string | null
}

/**
 * Module « Toiture mesurée » : UN seul bloc repliable qui regroupe la
 * maquette 3D, le plan coté et le rapport client (segmented 1 tap) — avant,
 * trois blocs empilés s'intercalaient entre le statut et les notes de la
 * fiche point (audit UX, B2).
 */
export function RoofModule({ roof, wastePct, address, maisonM2, totalM2, millesime }: Props) {
  // TOUJOURS replié à l'ouverture (décision briac 25/07) : dans les trois
  // fiches, c'est le commercial qui déplie — la 3D ne surgit jamais seule.
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'3d' | 'plan'>('3d')
  // Le rapport est un overlay plein écran : le segment « Rapport » l'ouvre
  // directement (1 tap) sans changer la vue courante.
  const [reportOpen, setReportOpen] = useState(false)
  // Sélection de pans (Σ) : détenue ICI, pas dans la 3D (audit UX B3) — ce
  // qu'on coche avec le client alimente aussi le plan (pans grisés) et le
  // rapport (surface retenue, chutes sur la sélection).
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => defaultExcluded(roof.pans))
  // `roof` change d'identité quand une NOUVELLE mesure arrive (backfill,
  // montée de version) : les index d'exclusion pointeraient sur les anciens
  // pans — on repart de la présélection « maison » du nouveau toit.
  useEffect(() => {
    setExcluded(defaultExcluded(roof.pans))
  }, [roof])
  const togglePan = (idx: number) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  const m2 = maisonM2 ?? totalM2

  return (
    <section className="roof-module">
      <button
        type="button"
        className="roof-module-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Box size={15} strokeWidth={1.9} />
        <span className="roof-module-title">Toiture mesurée</span>
        {m2 != null && <span className="roof-module-m2 tnum">{m2} m²</span>}
        <ChevronDown
          size={16}
          strokeWidth={1.9}
          className={`roof-module-chevron ${open ? 'is-open' : ''}`}
        />
      </button>

      {open && (
        <>
          <div className="roof-module-seg" role="group" aria-label="Vue du toit mesuré">
            <button
              type="button"
              className={view === '3d' ? 'is-active' : ''}
              onClick={() => setView('3d')}
            >
              3D
            </button>
            <button
              type="button"
              className={view === 'plan' ? 'is-active' : ''}
              onClick={() => setView('plan')}
            >
              Plan
            </button>
            <button type="button" onClick={() => setReportOpen(true)}>
              Rapport
            </button>
          </div>

          {/* Les deux vues restent montées : la scène 3D (WebGL) n'est pas
              reconstruite à chaque aller-retour 3D ↔ Plan. */}
          <div style={{ display: view === '3d' ? undefined : 'none' }}>
            <Roof3D
              roof={roof}
              wastePct={wastePct}
              embedded
              excluded={excluded}
              onTogglePan={togglePan}
            />
          </div>
          {view === 'plan' && <RoofDiagram roof={roof} embedded excluded={excluded} />}
        </>
      )}

      {reportOpen && (
        <RoofReport
          roof={roof}
          address={address}
          maisonM2={maisonM2}
          totalM2={totalM2}
          millesime={millesime}
          wastePct={wastePct}
          excluded={excluded}
          embedded
          onClose={() => setReportOpen(false)}
        />
      )}
    </section>
  )
}
