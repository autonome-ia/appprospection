import { useState } from 'react'
import { Segmented } from '../ui/Segmented'
import { useNumbers } from './NumbersData'
import { PeriodBar, usePeriod } from './PeriodBar'
import { Money } from './Money'
import { GeneralTable } from './GeneralTable'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  commissionOf,
  commissionSum,
  formatCount,
  formatDayNum,
  inPeriod,
  isCounted,
  isSellerOf,
  prestationLabel,
  shareOf,
  summarize,
} from '../../domain/sales'

/**
 * 3e onglet de Numbers (D19, puis retour briac 26/09 : « l'onglet Équipe
 * doit vraiment être un tableau global ») :
 *  - manager / chef des ventes : « Équipe » = LE TABLEAU GÉNÉRAL du brief
 *    (par vendeur + agence, puis toutes les ventes), avec objectifs,
 *    commissions et ventes à compléter ;
 *  - commercial : « Commissions » = ses commissions ligne à ligne, et le
 *    même tableau général en lecture (sans objectifs ni commissions des
 *    autres, D21).
 */
export function SalesTables() {
  const { isSupervisor } = useNumbers()
  return isSupervisor ? <TeamTable /> : <MyCommissions />
}

function LoadError() {
  const { reload } = useNumbers()
  return (
    <div className="load-error">
      <span>Impossible de charger les ventes : vérifiez le réseau.</span>
      <button type="button" className="text-btn" onClick={reload}>
        Réessayer
      </button>
    </div>
  )
}

/** Manager / chef des ventes : le tableau général de l'agence. */
function TeamTable() {
  const { loading, error } = useNumbers()
  const p = usePeriod('mois')
  return (
    <div className="screen numbers-screen">
      <PeriodBar p={p} />
      {error && <LoadError />}
      {loading ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : (
        <GeneralTable bounds={p.bounds} period={p.period} withPay />
      )}
    </div>
  )
}

type Scope = 'moi' | 'agence'

/** Commercial : mes commissions ligne à ligne, et le tableau général. */
function MyCommissions() {
  const { me, sales, loading, error, nameOf } = useNumbers()
  const p = usePeriod('mois')
  const [scope, setScope] = useState<Scope>('moi')

  const mine = sales.filter((s) => isSellerOf(s, me.id) && inPeriod(s, p.bounds) && isCounted(s))
  const my = summarize(mine, me.id)
  const total = commissionSum(mine, me.id)

  return (
    <div className="screen numbers-screen">
      <Segmented
        options={[
          { value: 'moi', label: 'Mes commissions' },
          { value: 'agence', label: 'Tableau général' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <PeriodBar p={p} />
      {error && <LoadError />}
      {loading ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : scope === 'moi' ? (
        <>
          <section className="card pay-total">
            <span className="eyebrow">Ma commission · {p.label}</span>
            <Money value={total} className="pay-total-value" />
            <span className="pay-total-meta">
              sur <Money value={my.ca} /> de CA HT · <span className="tnum">{formatCount(my.ventes)}</span> vente
              {my.ventes >= 2 ? 's' : ''}
            </span>
          </section>
          <section className="card ntable is-mine">
            <div className="ntable-head">
              <span>Date</span>
              <span>Vente</span>
              <span className="is-num">Ma part</span>
              <span className="is-num">Com.</span>
            </div>
            {mine.length === 0 && <p className="screen-empty ntable-empty">Aucune vente sur cette période.</p>}
            {mine.map((s) => {
              const share = shareOf(s, me.id)
              const partner = s.seller2_id ? (s.seller1_id === me.id ? s.seller2_id : s.seller1_id) : null
              return (
                <button key={s.id} type="button" className="ntable-row" onClick={() => openSaleFlow({ kind: 'open', saleId: s.id })}>
                  <span className="ntable-date tnum">{formatDayNum(s.sold_on)}</span>
                  <span className="ntable-main">
                    <span className="ntable-title">{s.client_name || prestationLabel(s.prestation)}</span>
                    <span className="ntable-meta">
                      {prestationLabel(s.prestation)}
                      {partner ? ` · avec ${nameOf(partner).split(/\s/)[0]}` : ''}
                    </span>
                  </span>
                  <Money value={(s.amount_ht ?? 0) * share} compact className="ntable-num" />
                  <Money value={commissionOf(s, me.id)} className="ntable-num is-strong" />
                </button>
              )
            })}
          </section>
        </>
      ) : (
        <GeneralTable bounds={p.bounds} period={p.period} withPay={false} />
      )}
    </div>
  )
}
