import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CELEBRATE_EVENT } from '../../lib/celebrate'
import { EASE_OUT } from '../../lib/motion'

// Chorégraphie (secondes) façon Apple Pay « Terminé » : l'anneau se TRACE,
// se REMPLIT, puis la coche se dessine ; petite pulsation à la fin. La
// pastille est une matière translucide qui suit le thème (verre clair /
// verre nuit), pas une boîte sombre posée sur l'écran.
const RING = { duration: 0.42, ease: EASE_OUT }
const FILL_AT = 0.36
const CHECK_AT = 0.46
const HOLD_MS = 1500

/** Pastille de célébration (vente, objectif atteint) — ne capte aucun tap. */
export function Celebration() {
  const [shown, setShown] = useState<{ id: number; label: string } | null>(null)
  useEffect(() => {
    let timer: number | undefined
    const on = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      setShown({ id: Date.now(), label })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setShown(null), HOLD_MS)
    }
    window.addEventListener(CELEBRATE_EVENT, on)
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, on)
      window.clearTimeout(timer)
    }
  }, [])
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          className="celebration"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }}
          animate={{
            opacity: 1,
            scale: 1,
            filter: 'blur(0px)',
            transition: { type: 'spring', duration: 0.45, bounce: 0.18 },
          }}
          exit={{
            opacity: 0,
            scale: 0.96,
            filter: 'blur(4px)',
            transition: { duration: 0.28, ease: EASE_OUT },
          }}
        >
          <motion.svg
            className="celebration-icon"
            width="64"
            height="64"
            viewBox="0 0 64 64"
            aria-hidden="true"
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.07, 1], transition: { delay: CHECK_AT + 0.28, duration: 0.32, ease: EASE_OUT } }}
          >
            {/* Remplissage vert qui monte sous l'anneau */}
            <motion.circle
              cx="32"
              cy="32"
              r="28"
              fill="var(--st-vendu)"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: { delay: FILL_AT, duration: 0.24, ease: EASE_OUT } }}
              style={{ transformOrigin: '32px 32px' }}
            />
            {/* Anneau tracé en tournant (départ en haut) */}
            <motion.circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="var(--st-vendu)"
              strokeWidth="3"
              strokeLinecap="round"
              transform="rotate(-90 32 32)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1, transition: RING }}
            />
            {/* Coche */}
            <motion.path
              d="M20.5 32.5 L28.5 40.5 L44 24.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1, transition: { delay: CHECK_AT, duration: 0.3, ease: EASE_OUT } }}
            />
          </motion.svg>
          <motion.span
            className="celebration-label"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.12, duration: 0.3, ease: EASE_OUT } }}
          >
            {shown.label}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
