import { useMemo, useState } from 'react'
import { Segmented } from '../ui/Segmented'
import { Avatar } from '../ui/Avatar'
import { useNumbers } from './NumbersData'
import { PeriodBar, usePeriod } from './PeriodBar'
import { Sellers, sellersLabel, shortDay } from './SaleRow'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  commissionOf,
  commissionSum,
  commissionTotal,
  formatCount,
  formatEuros,
  formatRate,
  inPeriod,
  isCounted,
  isSellerOf,
  paymentLabel,
  prestationLabel,
  summarize,
  type NumbersSummary,
} from '../../domain/sales'

type Scope = 'moi' | 'agence'

/** Les totaux d'un tableau, en grille de chiffres. */
function Totals({ s, extra }: { s: NumbersSummary; extra?: { label: string; value: string }[] }) {
  const cells = [
    { label: 'CA HT', value: formatEuros(s.ca) },
    { label: 'Ventes', value: formatCount(s.ventes) },
    { label: 'Toitures', value: formatCount(s.toitures) },
    { label: 'Financé', value: formatEuros(s.finance) },
    { label: 'TRC', value: s.trc == null ? '…' : formatRate(s.trc) },
    { label: 'Part toiture', value: s.partToiture == null ? '…' : formatRate(s.partToiture) },
    ...(extra ?? []),
  ]
  return (
    <section className="card">
      <div className="kpi-grid">
        {cells.map((c) => (
          <div key={c.label} className="kpi-cell">
            <span className="kpi-value tnum">{c.value}</span>
            <span className="kpi-label">{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Tableaux (plan §4.3) : MON tableau (mes ventes, mes parts, ma commission)
 * et le tableau de l'AGENCE (toutes les ventes, sans client : vue
 * `sales_board`). Le tableau de l'agence n'est que la somme des ventes : il
 * se met à jour seul, personne ne l'édite en tant que tel (D8).
 */
export function SalesTables() {
  const { me, isSupervisor, profiles, sales, board, rankable, loading, error, reload, nameOf } = useNumbers()
  const p = usePeriod('mois')
  const [scope, setScope] = useState<Scope>('moi')

  const mine = useMemo(
    () => sales.filter((s) => isSellerOf(s, me.id) && inPeriod(s, p.bounds) && isCounted(s)),
    [sales, me.id, p.bounds],
  )
  const agency = useMemo(() => board.filter((s) => inPeriod(s, p.bounds) && isCounted(s)), [board, p.bounds])

  const mySum = summarize(mine, me.id)
  const agencySum = summarize(agency)
  const myCommission = commissionSum(mine, me.id)
  // Commissions à verser : le superviseur lit toutes les lignes complètes.
  const payout = isSupervisor
    ? sales.filter((s) => inPeriod(s, p.bounds) && isCounted(s)).reduce((sum, s) => sum + commissionTotal(s), 0)
    : null

  const partnerOf = (s: { seller1_id: string; seller2_id: string | null }) =>
    nameOf(s.seller1_id === me.id ? s.seller2_id : s.seller1_id).split(/\s/)[0]

  const perSeller = rankable
    .map((prof) => ({ prof, s: summarize(agency, prof.id) }))
    .filter((x) => x.s.ventes > 0)
    .sort((a, b) => b.s.ca - a.s.ca)

  return (
    <div className="screen numbers-screen">
      <Segmented
        options={[
          { value: 'moi', label: 'Mon tableau' },
          { value: 'agence', label: 'Agence' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <PeriodBar p={p} />

      {error && (
        <div className="load-error">
          <span>Impossible de charger les ventes : vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {loading ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-block" />
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : scope === 'moi' ? (
        <>
          <Totals s={mySum} extra={[{ label: 'Commission', value: formatEuros(myCommission) }]} />
          <section className="card ntable">
            <div className="ntable-head">
              <span>Date</span>
              <span>Vente</span>
              <span className="is-num">Montant</span>
              <span className="is-num">Commission</span>
            </div>
            {mine.length === 0 && <p className="screen-empty ntable-empty">Aucune vente sur cette période.</p>}
            {mine.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ntable-row is-mine"
                onClick={() => openSaleFlow({ kind: 'open', saleId: s.id })}
              >
                <span className="ntable-date tnum">{shortDay(s.sold_on)}</span>
                <span className="ntable-main">
                  <span className="ntable-title">{prestationLabel(s.prestation)}</span>
                  <span className="ntable-meta">
                    {[s.client_name, paymentLabel(s.payment), s.seller2_id ? `à deux avec ${partnerOf(s)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="ntable-num tnum">{formatEuros(s.amount_ht ?? 0)}</span>
                <span className="ntable-num tnum">{formatEuros(commissionOf(s, me.id))}</span>
              </button>
            ))}
          </section>
        </>
      ) : (
        <>
          <Totals
            s={agencySum}
            extra={payout != null ? [{ label: 'Commissions', value: formatEuros(payout) }] : undefined}
          />

          <section className="card ntable">
            <p className="eyebrow">Par vendeur</p>
            <div className="ntable-head is-sellers">
              <span>Vendeur</span>
              <span className="is-num">Ventes</span>
              <span className="is-num">CA HT</span>
              <span className="is-num">TRC</span>
            </div>
            {perSeller.length === 0 && <p className="screen-empty ntable-empty">Aucune vente sur cette période.</p>}
            {perSeller.map(({ prof, s }) => (
              <div key={prof.id} className="ntable-row is-sellers">
                <span className="ntable-seller">
                  <Avatar id={prof.id} name={prof.full_name} color={prof.color} size={22} />
                  <span className="ntable-title">{prof.full_name ?? 'Commercial'}</span>
                </span>
                <span className="ntable-num tnum">{formatCount(s.ventes)}</span>
                <span className="ntable-num tnum">{formatEuros(s.ca)}</span>
                <span className="ntable-num tnum">{s.trc == null ? '…' : formatRate(s.trc)}</span>
              </div>
            ))}
          </section>

          <section className="card ntable">
            <p className="eyebrow">Toutes les ventes</p>
            <div className="ntable-head">
              <span>Date</span>
              <span>Vente</span>
              <span className="is-num">Montant</span>
              <span className="is-num">Financé</span>
            </div>
            {agency.length === 0 && <p className="screen-empty ntable-empty">Aucune vente sur cette période.</p>}
            {agency.map((s) => (
              <div key={s.id} className="ntable-row">
                <span className="ntable-date tnum">{shortDay(s.sold_on)}</span>
                <span className="ntable-main">
                  <span className="ntable-title">
                    <Sellers sale={s} profiles={profiles} />
                    {prestationLabel(s.prestation)}
                  </span>
                  <span className="ntable-meta">
                    {sellersLabel(s, nameOf)} · {paymentLabel(s.payment)}
                  </span>
                </span>
                <span className="ntable-num tnum">{formatEuros(s.amount_ht ?? 0)}</span>
                <span className="ntable-num tnum is-muted">
                  {s.payment === 'financement' ? formatEuros(s.financed_ht ?? 0) : '·'}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
