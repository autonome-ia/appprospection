import { useEffect, useState } from 'react'
import { Check, RotateCw, ScanLine } from 'lucide-react'
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

// Variante de planche (chantier design) : ?roofui=etapes, défaut « ligne »
// (une ligne, même hauteur que le module final : aucun saut de mise en page).
// À retirer une fois la variante choisie par briac.
const VARIANT: 'etapes' | 'ligne' =
  typeof location !== 'undefined' && /[?&]roofui=etapes/.test(location.search) ? 'etapes' : 'ligne'

type StepState = 'done' | 'active' | 'todo'

function stepStates(p: LidarProgress | null): [StepState, StepState, StepState] {
  switch (p?.stage) {
    case 'nuage':
      return ['done', 'active', 'todo']
    case 'pans':
    case 'fini':
      return ['done', 'done', 'active']
    default:
      return ['active', 'todo', 'todo']
  }
}

/** Part RÉELLE du travail fait : nœuds du nuage lus, bornée par étape. */
function fraction(p: LidarProgress | null): number {
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

function StepIcon({ state }: { state: StepState }) {
  return (
    <span className={`roof-step-icon is-${state}`} aria-hidden>
      {state === 'done' ? <Check size={12} strokeWidth={2.6} /> : null}
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
 * Carte « Mesure laser du toit » (chantier design 24/09) : remplace la
 * pastille « mesure du toit… ». Même gabarit que le module « Toiture
 * mesurée » qui prend sa place une fois la mesure faite. Montre l'avancement
 * RÉEL : bâtiment trouvé, points laser reçus (compteur), pans détectés.
 */
export function RoofProgress({ lng, lat, pending, failed, onRetry }: Props) {
  const p = useLidarProgress(lng, lat)
  const shown = useDelayed(pending, 400)

  if (failed && !pending) {
    return (
      <section className="roof-module roof-progress is-failed" aria-live="polite">
        <div className="roof-progress-head">
          <ScanLine size={15} strokeWidth={1.9} />
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

  const [s1, s2, s3] = stepStates(p)
  const points = p?.points ?? 0

  if (VARIANT === 'ligne') {
    // Même gabarit que l'en-tête replié de « Toiture mesurée » : la mesure
    // finie prend sa place SANS que rien ne bouge (titre et chiffre changent
    // sur place, le chiffre roule depuis 0). La progression réelle court sur
    // le filet du bas.
    return (
      <section className="roof-module roof-progress is-ligne" aria-live="polite" aria-busy="true">
        <div className="roof-module-head roof-progress-line">
          <ScanLine size={15} strokeWidth={1.9} className="roof-progress-scan" />
          <span className="roof-module-title">Mesure laser du toit</span>
          <span className="roof-progress-status">
            {s3 === 'active' ? (
              'Calcul des pans…'
            ) : points > 0 ? (
              <>
                <span className="tnum">
                  <Num value={points} />
                </span>{' '}
                points
              </>
            ) : s2 === 'active' ? (
              'Nuage laser…'
            ) : (
              'Bâtiment…'
            )}
          </span>
        </div>
        <span
          className="roof-progress-rail"
          role="progressbar"
          aria-label="Avancement de la mesure"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction(p) * 100)}
        >
          <span style={{ transform: `scaleX(${fraction(p)})` }} />
        </span>
      </section>
    )
  }

  return (
    <section
      className={`roof-module roof-progress is-${VARIANT}`}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="roof-progress-head">
        <ScanLine size={15} strokeWidth={1.9} className="roof-progress-scan" />
        <span className="roof-module-title">Mesure laser du toit</span>
        {points > 0 && (
          <span className="roof-progress-status">
            <span className="tnum">
              <Num value={points} />
            </span>{' '}
            points
          </span>
        )}
      </div>
      {
        <ol className="roof-steps">
          <li className={`is-${s1}`}>
            <StepIcon state={s1} />
            <span>Bâtiment</span>
          </li>
          <li className={`is-${s2}`}>
            <StepIcon state={s2} />
            <span>Nuage de points laser</span>
          </li>
          <li className={`is-${s3}`}>
            <StepIcon state={s3} />
            <span>Pans et surface</span>
          </li>
        </ol>
      }
    </section>
  )
}
