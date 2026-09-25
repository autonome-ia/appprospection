import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Segmented } from '../ui/Segmented'
import { useNumbers } from './NumbersData'
import { PeriodBar, usePeriod } from './PeriodBar'
import { SaleRow } from './SaleRow'
import { openSaleFlow } from '../../lib/sale-flow'
import { formatCount, formatEuros, inPeriod, isComplete, isSellerOf, summarize } from '../../domain/sales'

type Scope = 'miennes' | 'agence'
type Filter = 'toutes' | 'a_completer' | 'annulees'

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const dayTitle = (d: string) => {
  const s = LONG_DAY.format(new Date(`${d}T12:00:00`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Cahier des ventes (plan §4.3) : la liste des ventes, par jour. Le
 * commercial voit les siennes ; manager et chef des ventes basculent sur le
 * cahier de l'agence (client, adresse, note : la RLS ne les donne qu'à eux).
 */
export function SalesBook() {
  const { me, isSupervisor, profiles, sales, loading, error, reload, nameOf } = useNumbers()
  const p = usePeriod('mois')
  const [scope, setScope] = useState<Scope>('miennes')
  const [filter, setFilter] = useState<Filter>('toutes')

  const inScope = useMemo(
    () => sales.filter((s) => inPeriod(s, p.bounds) && (scope === 'agence' || isSellerOf(s, me.id))),
    [sales, p.bounds, scope, me.id],
  )
  const shown = inScope.filter((s) =>
    filter === 'toutes'
      ? true
      : filter === 'annulees'
        ? s.status === 'annulee'
        : s.status === 'active' && !isComplete(s),
  )
  const sum = summarize(inScope, scope === 'agence' ? undefined : me.id)
  const cancelled = inScope.filter((s) => s.status === 'annulee').length

  // Groupes par jour (la liste est déjà triée du plus récent au plus ancien).
  const days: { day: string; list: typeof shown }[] = []
  for (const s of shown) {
    const last = days[days.length - 1]
    if (last?.day === s.sold_on) last.list.push(s)
    else days.push({ day: s.sold_on, list: [s] })
  }

  return (
    <div className="screen numbers-screen">
      <div className="screen-head">
        <h2>Cahier des ventes</h2>
        <button type="button" className="head-action" onClick={() => openSaleFlow({ kind: 'new' })}>
          <Plus size={16} strokeWidth={2.2} /> Vente
        </button>
      </div>

      {isSupervisor && (
        <Segmented
          options={[
            { value: 'miennes', label: 'Mes ventes' },
            { value: 'agence', label: 'Agence' },
          ]}
          value={scope}
          onChange={setScope}
        />
      )}
      <PeriodBar p={p} />

      {error && (
        <div className="load-error">
          <span>Impossible de charger les ventes : vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {!loading && (
        <p className="book-summary">
          <span className="tnum">{formatCount(sum.ventes)}</span> vente{sum.ventes > 1 ? 's' : ''} ·{' '}
          <span className="tnum">{formatEuros(sum.ca)}</span> HT
          {sum.aCompleter > 0 && (
            <>
              {' · '}
              <span className="tnum">{sum.aCompleter}</span> à compléter
            </>
          )}
        </p>
      )}

      <div className="chip-row book-filters">
        {(
          [
            ['toutes', 'Toutes'],
            ['a_completer', 'À compléter'],
            ['annulees', `Annulées${cancelled ? ` · ${cancelled}` : ''}`],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`chip chip-sm ${filter === v ? 'is-active' : ''}`}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-row" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      ) : days.length === 0 ? (
        <div className="empty-state">
          <p>Aucune vente sur cette période.</p>
        </div>
      ) : (
        days.map(({ day, list }) => (
          <section key={day} className="home-section book-day">
            <p className="eyebrow section-title">{dayTitle(day)}</p>
            {list.map((s) => (
              <SaleRow
                key={s.id}
                sale={s}
                profiles={profiles}
                nameOf={nameOf}
                onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })}
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}
