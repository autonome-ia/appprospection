import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Segmented } from '../ui/Segmented'
import {
  NUMBERS_PERIODS,
  periodBounds,
  periodLabel,
  shiftPeriod,
  type NumbersPeriod,
} from '../../domain/sales'

/** Période des écrans Numbers (D10) : semaine · mois · trimestre · année,
    avec navigation ‹ › vers le passé — mêmes contrôles que les Stats. */
export function usePeriod(initial: NumbersPeriod = 'mois') {
  const [period, setPeriodRaw] = useState<NumbersPeriod>(initial)
  const [offset, setOffset] = useState(0)
  return useMemo(() => {
    const now = shiftPeriod(period, offset)
    const prevNow = shiftPeriod(period, offset - 1)
    return {
      period,
      offset,
      setPeriod: (p: NumbersPeriod) => {
        setPeriodRaw(p)
        setOffset(0) // « trimestre -2 » n'a pas de sens transposé en semaines
      },
      setOffset,
      bounds: periodBounds(period, now),
      previous: periodBounds(period, prevNow),
      label: periodLabel(period, now),
    }
  }, [period, offset])
}

export type PeriodState = ReturnType<typeof usePeriod>

export function PeriodBar({ p }: { p: PeriodState }) {
  return (
    <>
      <Segmented options={NUMBERS_PERIODS} value={p.period} onChange={p.setPeriod} />
      <div className="stats-rangebar">
        <button type="button" className="range-nav" onClick={() => p.setOffset((o) => o - 1)} aria-label="Période précédente">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <p className="stats-range">{p.label}</p>
        <button
          type="button"
          className="range-nav"
          onClick={() => p.setOffset((o) => Math.min(0, o + 1))}
          disabled={p.offset === 0}
          aria-label="Période suivante"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
        {p.offset < 0 && (
          <button type="button" className="text-btn range-today" onClick={() => p.setOffset(0)}>
            Aujourd’hui
          </button>
        )}
      </div>
    </>
  )
}

/** « vs mois dernier »… : libellé de comparaison des deltas. */
export const PREV_LABEL: Record<NumbersPeriod, string> = {
  semaine: 'vs sem. dernière',
  mois: 'vs mois dernier',
  trimestre: 'vs trim. dernier',
  annee: 'vs année dernière',
}
