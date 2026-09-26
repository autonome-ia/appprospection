import { useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Segmented } from '../ui/Segmented'
import { useNumbers } from './NumbersData'
import { PeriodBar, usePeriod } from './PeriodBar'
import { SaleRow } from './SaleRow'
import { Money } from './Money'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  ORIGINS,
  PRESTATIONS,
  formatCount,
  inPeriod,
  isComplete,
  isSellerOf,
  originLabel,
  prestationLabel,
  summarize,
  type Prestation,
  type SaleOrigin,
} from '../../domain/sales'

type Scope = 'miennes' | 'agence'
type Filter = 'toutes' | 'a_completer' | 'annulees'

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const dayTitle = (d: string) => {
  const s = LONG_DAY.format(new Date(`${d}T12:00:00`))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Total HT du jour (ventes actives chiffrées, montant entier). */
const dayTotal = (list: { status: string; amount_ht: number | null }[]) =>
  list.reduce((sum, s) => sum + (s.status === 'active' ? (s.amount_ht ?? 0) : 0), 0)

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
  // Filtres prestation / origine (manque 2) : ils s'appliquent AUSSI au
  // résumé chiffré du haut (« mes toitures du mois », « mes leads »…).
  const [prest, setPrest] = useState<Prestation | ''>('')
  const [orig, setOrig] = useState<SaleOrigin | ''>('')

  const inScope = useMemo(
    () =>
      sales.filter(
        (s) =>
          inPeriod(s, p.bounds) &&
          (scope === 'agence' || isSellerOf(s, me.id)) &&
          (!prest || s.prestation === prest) &&
          (!orig || s.origin === orig),
      ),
    [sales, p.bounds, scope, me.id, prest, orig],
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
        <section className="card book-summary">
          <div className="kpi-grid">
            <div className="kpi-cell">
              <Money value={sum.ca} compact className="kpi-value" />
              <span className="kpi-label">CA HT</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-value tnum">{formatCount(sum.ventes)}</span>
              <span className="kpi-label">vente{sum.ventes > 1 ? 's' : ''}</span>
            </div>
            <div className="kpi-cell">
              <span className={`kpi-value tnum ${sum.aCompleter > 0 ? 'is-warn' : ''}`}>{sum.aCompleter}</span>
              <span className="kpi-label">à compléter</span>
            </div>
          </div>
        </section>
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
      <div className="book-selects">
        <label className={`chip chip-sm chip-select ${prest ? 'is-active' : ''}`}>
          <span>{prest ? prestationLabel(prest) : 'Prestation'}</span>
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          <select value={prest} onChange={(e) => setPrest(e.target.value as Prestation | '')} aria-label="Filtrer par prestation">
            <option value="">Toutes les prestations</option>
            {PRESTATIONS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`chip chip-sm chip-select ${orig ? 'is-active' : ''}`}>
          <span>{orig ? originLabel(orig) : 'Origine'}</span>
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          <select value={orig} onChange={(e) => setOrig(e.target.value as SaleOrigin | '')} aria-label="Filtrer par origine">
            <option value="">Toutes les origines</option>
            {ORIGINS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {(prest || orig) && (
          <button
            type="button"
            className="text-btn book-clear"
            onClick={() => {
              setPrest('')
              setOrig('')
            }}
          >
            Effacer
          </button>
        )}
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
            <div className="book-day-head">
              <p className="eyebrow">{dayTitle(day)}</p>
              <Money value={dayTotal(list)} className="book-day-total" />
            </div>
            {list.map((s) => (
              <SaleRow
                key={s.id}
                sale={s}
                profiles={profiles}
                nameOf={nameOf}
                forProfile={scope === 'miennes' ? me.id : undefined}
                onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })}
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}
