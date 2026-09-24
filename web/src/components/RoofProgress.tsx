import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { RotateCw, Scan } from 'lucide-react'
import {
  getLidarProgress,
  lidarKey,
  subscribeLidarProgress,
  type LidarProgress,
} from '../data/lidar-progress'
import { Num } from './ui/Num'

/** Avancement réel de la mesure LiDAR d'une maison (null = rien en cours). */
export function useLidarProgress(lng: number | null, lat: number | null): LidarProgress | null {
  const key = lng != null && lat != null ? lidarKey(lng, lat) : null
  const [p, setP] = useState<LidarProgress | null>(() => (key ? getLidarProgress(key) : null))
  useEffect(() => {
    if (!key) {
      setP(null)
      return
    }
    setP(getLidarProgress(key))
    return subscribeLidarProgress(key, setP)
  }, [key])
  return p
}

/** Vrai après `ms` d'attente continue : une réponse du cache (< 0,4 s) ne
    fait jamais clignoter de carte de progression. */
function useDelayed(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) {
      setOn(false)
      return
    }
    const id = setTimeout(() => setOn(true), ms)
    return () => clearTimeout(id)
  }, [active, ms])
  return on
}

/** Part RÉELLE du travail fait : nœuds du nuage lus, bornée par étape. */
export function progressFraction(p: LidarProgress | null): number {
  switch (p?.stage) {
    case 'nuage':
      return 0.12 + 0.78 * (p.nodesTotal ? p.nodesDone / p.nodesTotal : 0)
    case 'pans':
    case 'fini':
      return 0.94
    case 'batiment':
      return 0.08
    default:
      return 0.03
  }
}

/** « 2024-12-12 » -> « déc. 2024 ». */
function survol(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 4)
    : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

/** Le titre RACONTE la mesure, avec de vrais chiffres. L'analyse des pans
    ne dure que ~0,1 s : elle n'a pas de titre (il clignoterait) — ce sont
    les pans qui se matérialisent sur la photo qui l'annoncent. */
function phaseTitle(p: LidarProgress | null): string {
  if (p?.stage === 'pans' || p?.stage === 'fini') return 'Lecture laser'
  if (p?.stage === 'nuage') {
    if (p.points > 0) return 'Lecture laser'
    return p.millesime ? `Survol laser de ${survol(p.millesime)}` : 'Lecture laser'
  }
  return 'Repérage du bâtiment'
}

const SWAP = {
  initial: { opacity: 0, transform: 'translateY(4px)', filter: 'blur(2px)' },
  animate: { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
  exit: { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(2px)' },
  transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const },
}

/** Fondu enchaîné sur place (ancien et nouveau dans la même cellule de
    grille : aucun saut de mise en page). */
function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <span className={`roof-swap ${className ?? ''}`}>
      <AnimatePresence initial={false}>
        <motion.span key={id} {...SWAP}>
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

const RING_R = 7.25
const RING_C = 2 * Math.PI * RING_R

/** Anneau de progression RÉELLE (comme un téléchargement iOS) autour d'une
    ligne de scan qui balaie au rythme du faisceau de la carte (même
    période, même courbe). Remplace le filet du bas (retour briac). */
function ScanRing({ fraction }: { fraction: number }) {
  return (
    <span
      className="roof-scan-ring"
      role="progressbar"
      aria-label="Avancement de la mesure"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
        <circle className="roof-scan-ring-track" cx="9" cy="9" r={RING_R} />
        <circle
          className="roof-scan-ring-fill"
          cx="9"
          cy="9"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - fraction)}
        />
      </svg>
      <i aria-hidden />
    </span>
  )
}

interface Props {
  lng: number
  lat: number
  /** Mesure en cours (la carte se montre après 400 ms d'attente). */
  pending: boolean
  /** La dernière mesure a échoué (réseau) : la carte propose « Réessayer ». */
  failed: boolean
  onRetry?: () => void
}

/**
 * Carte « mesure laser » (chantier design 24/09) : remplace la pastille
 * « mesure du toit… ». Gabarit EXACT de l'en-tête replié de « Toiture
 * mesurée » (qui prend sa place sans que rien ne bouge) ; le titre raconte la
 * mesure réelle (repérage, survol, lecture laser), le compteur de points
 * roule, la progression réelle remplit l'anneau autour de l'icône de scan.
 */
export function RoofProgress({ lng, lat, pending, failed, onRetry }: Props) {
  const p = useLidarProgress(lng, lat)
  const shown = useDelayed(pending, 400)

  if (failed && !pending) {
    return (
      <section className="roof-module roof-progress is-failed" aria-live="polite">
        <div className="roof-progress-head">
          <Scan size={15} strokeWidth={1.9} />
          <span className="roof-module-title">Mesure laser indisponible</span>
          {onRetry && (
            <button type="button" className="roof-progress-retry" onClick={onRetry}>
              <RotateCw size={13} strokeWidth={2} /> Réessayer
            </button>
          )}
        </div>
        <p className="roof-progress-note">
          Les serveurs LiDAR de l’IGN n’ont pas répondu. Ce n’est pas la maison : réessayez dans
          un instant.
        </p>
      </section>
    )
  }
  if (!pending || !shown) return null

  const title = phaseTitle(p)
  const points = p?.points ?? 0
  const f = progressFraction(p)
  return (
    <section className="roof-module roof-progress" aria-live="polite" aria-busy="true">
      <div className="roof-module-head roof-progress-line">
        <ScanRing fraction={f} />
        <Swap id={title} className="roof-module-title">
          {title}
        </Swap>
        {points > 0 && (
          <span className="roof-progress-status">
            <span className="tnum">
              <Num value={points} />
            </span>{' '}
            points
          </span>
        )}
      </div>
    </section>
  )
}
