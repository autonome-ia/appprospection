import { useState } from 'react'
import { Box, ChevronDown } from 'lucide-react'
import type { RoofData } from '../domain/house'
import { Roof3D } from './Roof3D'
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
  /** Ouvert d'emblée dans les fiches d'argumentaire (maison, client),
      replié dans la fiche point (la pose ne doit pas être taxée). */
  defaultOpen?: boolean
}

/**
 * Module « Toiture mesurée » : UN seul bloc repliable qui regroupe la
 * maquette 3D, le plan coté et le rapport client (segmented 1 tap) — avant,
 * trois blocs empilés s'intercalaient entre le statut et les notes de la
 * fiche point (audit UX, B2).
 */
export function RoofModule({
  roof,
  wastePct,
  address,
  maisonM2,
  totalM2,
  millesime,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [view, setView] = useState<'3d' | 'plan'>('3d')
  // Le rapport est un overlay plein écran : le segment « Rapport » l'ouvre
  // directement (1 tap) sans changer la vue courante.
  const [reportOpen, setReportOpen] = useState(false)
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
            <Roof3D roof={roof} wastePct={wastePct} embedded />
          </div>
          {view === 'plan' && <RoofDiagram roof={roof} embedded />}
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
          embedded
          onClose={() => setReportOpen(false)}
        />
      )}
    </section>
  )
}
