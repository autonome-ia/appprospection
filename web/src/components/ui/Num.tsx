import { useEffect, useState } from 'react'
import NumberFlow from '@number-flow/react'

/**
 * Chiffre animé (chantier design 24/09) : quand la valeur change, les
 * chiffres ROULENT vers la nouvelle (changement de période des Stats,
 * compteur du jour qui monte). `fromZero` : au premier affichage, part de 0
 * — réservé aux héros, une fois par session. Mouvement réduit respecté
 * (NumberFlow suit prefers-reduced-motion). Police : celle du parent
 * (.tnum → Geist Mono tabulaire).
 */
export function Num({ value, fromZero = false }: { value: number; fromZero?: boolean }) {
  const [shown, setShown] = useState(fromZero ? 0 : value)
  useEffect(() => {
    // Un tour de rendu d'écart : le 0 initial est peint, puis on roule.
    const id = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(id)
  }, [value])
  return (
    <NumberFlow
      value={shown}
      locales="fr-FR"
      transformTiming={{ duration: 650, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      spinTiming={{ duration: 650, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      opacityTiming={{ duration: 300, easing: 'ease-out' }}
    />
  )
}
