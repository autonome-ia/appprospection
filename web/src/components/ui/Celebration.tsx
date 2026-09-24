import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CELEBRATE_EVENT } from '../../lib/celebrate'
import { EASE_OUT, SPRING_CELEBRATE } from '../../lib/motion'

/** Pastille de célébration : cercle vert qui éclôt, coche qui se trace,
    libellé, puis fondu (~1,4 s). Ne capte aucun tap. */
export function Celebration() {
  const [shown, setShown] = useState<{ id: number; label: string } | null>(null)
  useEffect(() => {
    let timer: number | undefined
    const on = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      setShown({ id: Date.now(), label })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setShown(null), 1400)
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
          aria-live="polite"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: SPRING_CELEBRATE }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.25, ease: EASE_OUT } }}
        >
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
            <motion.path
              d="M16 29 L24.5 37.5 L40 20"
              fill="none"
              stroke="#ffffff"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1, transition: { delay: 0.15, duration: 0.35, ease: EASE_OUT } }}
            />
          </svg>
          <span className="celebration-label">{shown.label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
