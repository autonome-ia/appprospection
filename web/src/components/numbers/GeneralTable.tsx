import { useMemo } from 'react'
import { Avatar } from '../ui/Avatar'
import { Money, Pct } from './Money'
import { useNumbers } from './NumbersData'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  commissionSum,
  commissionTotal,
  formatCount,
  formatDayNum,
  inPeriod,
  isComplete,
  isSellerOf,
  objectiveFor,
  paymentLabel,
  prestationLabel,
  summarize,
  type NumbersPeriod,
} from '../../domain/sales'

/**
 * LE TABLEAU GÉNÉRAL de l'agence (brief Alexis, retour briac 26/09 : « l'onglet
 * Équipe doit vraiment être un tableau global ») :
 *  1. par vendeur ET pour l'agence : ventes, CA HT, toitures, financé, TRC,
 *     part toiture (+ objectif, commission, à compléter pour le manager et
 *     le chef des ventes) ;
 *  2. toutes les ventes : date, vendeur(s), prestation, montant total HT,
 *     comptant ou financement, montant financé.
 * Vrai tableau façon tableur : défilement horizontal, 1re colonne figée
 * (9 colonnes ne tiennent pas sur 390 px). Lecture seule : on modifie une
 * vente dans le cahier (le tableau n'est que leur somme, D8).
 */
export function GeneralTable({
  bounds,
  period,
  withPay,
}: {
  bounds: { start: string; end: string }
  period: NumbersPeriod
  /** Manager / chef des ventes : objectifs, commissions, à compléter. */
  withPay: boolean
}) {
  const { board, sales, rankable, profiles, nameOf, openSeller } = useNumbers()

  const inRange = useMemo(
    () => board.filter((s) => inPeriod(s, bounds) && s.status === 'active'),
    [board, bounds],
  )
  const full = useMemo(() => sales.filter((s) => inPeriod(s, bounds)), [sales, bounds])

  const perSeller = rankable
    .map((prof) => {
      const s = summarize(inRange, prof.id)
      const target = objectiveFor(prof.monthly_ca_target, period)
      return {
        prof,
        s,
        obj: target ? s.ca / target : null,
        com: commissionSum(full, prof.id),
        todo: full.filter((x) => x.status === 'active' && !isComplete(x) && isSellerOf(x, prof.id)).length,
      }
    })
    .filter((r) => r.s.ventes > 0 || r.todo > 0 || (withPay && r.obj != null))
    .sort((a, b) => b.s.ca - a.s.ca)

  const agency = summarize(inRange)
  const months = period === 'semaine' ? 0 : period === 'mois' ? 1 : period === 'trimestre' ? 3 : 12
  const agencyTarget = months * rankable.reduce((sum, p) => sum + (p.monthly_ca_target || 0), 0)
  const agencyCom = full.reduce((sum, x) => sum + commissionTotal(x), 0)
  const agencyTodo = full.filter((x) => x.status === 'active' && !isComplete(x)).length

  const rows = [...inRange].sort((a, b) => (a.sold_on < b.sold_on ? 1 : a.sold_on > b.sold_on ? -1 : 0))
  const counted = rows.filter((x) => isComplete(x))
  const totalHT = counted.reduce((sum, x) => sum + (x.amount_ht ?? 0), 0)
  const totalFin = counted.reduce((sum, x) => sum + (x.payment === 'financement' ? (x.financed_ht ?? 0) : 0), 0)
  const first = (id: string | null) => (id ? nameOf(id).split(/\s/)[0] : '')
  const pct = (v: number | null) => (v == null ? <span className="is-muted">-</span> : <Pct value={v} />)

  return (
    <>
      <section className="card gt-card">
        <p className="eyebrow">Par vendeur</p>
        <div className="gt-scroll">
          <table className="gt">
            <thead>
              <tr>
                <th>Vendeur</th>
                <th>Ventes</th>
                <th>CA HT</th>
                <th>Toitures</th>
                <th>Financé</th>
                <th>TRC</th>
                <th>Part toiture</th>
                {withPay && (
                  <>
                    <th>Objectif</th>
                    <th>Commission</th>
                    <th>À compléter</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {perSeller.length === 0 && (
                <tr>
                  <td colSpan={withPay ? 10 : 7} className="gt-empty">
                    Aucune vente sur cette période.
                  </td>
                </tr>
              )}
              {perSeller.map(({ prof, s, obj, com, todo }) => (
                <tr key={prof.id} className={withPay ? 'is-clickable' : ''} onClick={withPay ? () => openSeller(prof.id) : undefined}>
                  <th scope="row">
                    <span className="gt-seller">
                      <Avatar id={prof.id} name={prof.full_name} color={prof.color} size={20} />
                      {prof.full_name ?? 'Commercial'}
                    </span>
                  </th>
                  <td className="tnum">{formatCount(s.ventes)}</td>
                  <td>
                    <Money value={s.ca} />
                  </td>
                  <td className="tnum">{formatCount(s.toitures)}</td>
                  <td>
                    <Money value={s.finance} />
                  </td>
                  <td>{pct(s.trc)}</td>
                  <td>{pct(s.partToiture)}</td>
                  {withPay && (
                    <>
                      <td>{pct(obj)}</td>
                      <td>
                        <Money value={com} />
                      </td>
                      <td className={`tnum ${todo ? 'is-warn' : ''}`}>{todo}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Agence</th>
                <td className="tnum">{formatCount(agency.ventes)}</td>
                <td>
                  <Money value={agency.ca} />
                </td>
                <td className="tnum">{formatCount(agency.toitures)}</td>
                <td>
                  <Money value={agency.finance} />
                </td>
                <td>{pct(agency.trc)}</td>
                <td>{pct(agency.partToiture)}</td>
                {withPay && (
                  <>
                    <td>{pct(agencyTarget > 0 ? agency.ca / agencyTarget : null)}</td>
                    <td>
                      <Money value={agencyCom} />
                    </td>
                    <td className={`tnum ${agencyTodo ? 'is-warn' : ''}`}>{agencyTodo}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="gt-foot">
          Une vente à deux compte pour moitié à chaque vendeur, et une fois pour l’agence. TRC : financé ÷ CA.
        </p>
      </section>

      <section className="card gt-card">
        <p className="eyebrow">Toutes les ventes</p>
        <div className="gt-scroll">
          <table className="gt">
            <thead>
              <tr>
                <th>Date</th>
                <th className="is-text">Vendeur(s)</th>
                <th className="is-text">Prestation</th>
                <th>Montant HT</th>
                <th className="is-text">Paiement</th>
                <th>Financé</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="gt-empty">
                    Aucune vente sur cette période.
                  </td>
                </tr>
              )}
              {rows.map((x) => {
                const p1 = profiles.find((p) => p.id === x.seller1_id)
                // Le superviseur ouvre la vente (lignes complètes) ; le
                // commercial ne lit que le tableau (D9).
                const open = withPay ? () => openSaleFlow({ kind: 'open', saleId: x.id }) : undefined
                return (
                  <tr key={x.id} className={open ? 'is-clickable' : ''} onClick={open}>
                    <th scope="row" className="tnum">
                      {formatDayNum(x.sold_on)}
                    </th>
                    <td className="is-text">
                      <span className="gt-seller">
                        <Avatar id={x.seller1_id} name={p1?.full_name} color={p1?.color} size={18} />
                        {first(x.seller1_id)}
                        {x.seller2_id ? ` et ${first(x.seller2_id)}` : ''}
                      </span>
                    </td>
                    <td className="is-text">{x.prestation ? prestationLabel(x.prestation) : <span className="is-warn">à compléter</span>}</td>
                    <td>{x.amount_ht == null ? <span className="is-warn">à compléter</span> : <Money value={x.amount_ht} />}</td>
                    <td className="is-text">{x.payment ? paymentLabel(x.payment) : <span className="is-muted">-</span>}</td>
                    <td>
                      {x.payment === 'financement' && x.financed_ht != null ? (
                        <Money value={x.financed_ht} />
                      ) : (
                        <span className="is-muted">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="is-text">
                  <span className="tnum">{counted.length}</span> vente{counted.length > 1 ? 's' : ''}
                </td>
                <td />
                <td>
                  <Money value={totalHT} />
                </td>
                <td />
                <td>
                  <Money value={totalFin} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="gt-foot">Faites glisser le tableau pour voir toutes les colonnes.</p>
      </section>
    </>
  )
}
