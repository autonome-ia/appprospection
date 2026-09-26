import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Segmented } from '../ui/Segmented'
import { Avatar } from '../ui/Avatar'
import { useNumbers } from './NumbersData'
import { PeriodBar, usePeriod } from './PeriodBar'
import { Money, Pct } from './Money'
import { openSaleFlow } from '../../lib/sale-flow'
import type { OrgProfile } from '../../data/profiles'
import {
  commissionOf,
  commissionSum,
  commissionTotal,
  formatCount,
  formatDayNum,
  inPeriod,
  isComplete,
  isCounted,
  isSellerOf,
  objectiveFor,
  prestationLabel,
  shareOf,
  summarize,
  type BoardSale,
  type Sale,
} from '../../domain/sales'

/**
 * 3e onglet de Numbers — tour UI/UX du 26/09 (choix briac : « Tableaux
 * devient Équipe ») :
 *  - manager / chef des ventes : « Équipe », UN tableau par vendeur (la vue
 *    paie et suivi) — CA, % de l'objectif, commission, à compléter ; tap =
 *    détail du commercial dans Stats ;
 *  - commercial : « Commissions », ses ventes ligne à ligne (sa part, sa
 *    commission), et le tableau de l'agence (vendeurs, ventes, CA : le
 *    « tableau général » du brief, sans objectifs ni commissions des autres).
 * « Toutes les ventes » a disparu : c'est le cahier.
 */
export function SalesTables() {
  const { isSupervisor } = useNumbers()
  return isSupervisor ? <TeamTable /> : <MyCommissions />
}

/** « Thomas K. » : le tableau tient sur 390 px sans tronquer les noms. */
const shortName = (full: string | null) => {
  const parts = (full ?? 'Commercial').trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}

/** Tableau par vendeur, trié par CA ; ligne « Agence » en pied. */
function SellersTable({
  rows,
  agency,
  withPay,
  onOpen,
}: {
  rows: { prof: OrgProfile; ca: number; ventes: number; trc: number | null; obj: number | null; com: number; todo: number }[]
  agency: { ca: number; ventes: number; obj: number | null; com: number }
  withPay: boolean
  onOpen?: (id: string) => void
}) {
  return (
    <section className={`card ntable ${withPay ? 'is-pay' : 'is-light'}`}>
      <div className="ntable-head">
        <span>Vendeur</span>
        <span className="is-num">CA HT</span>
        {withPay ? (
          <>
            <span className="is-num">Obj.</span>
            <span className="is-num">Com.</span>
          </>
        ) : (
          <span className="is-num">Ventes</span>
        )}
      </div>
      {rows.length === 0 && <p className="screen-empty ntable-empty">Aucune vente sur cette période.</p>}
      {rows.map((r) => {
        const cells = (
          <>
            <span className="ntable-seller">
              <Avatar id={r.prof.id} name={r.prof.full_name} color={r.prof.color} size={24} />
              <span className="ntable-main">
                <span className="ntable-title">{shortName(r.prof.full_name)}</span>
                {withPay && (
                  <span className="ntable-meta">
                    <span className="tnum">{formatCount(r.ventes)}</span> vente{r.ventes > 1 ? 's' : ''}
                    {r.todo > 0 && (
                      <span className="ntable-warn">
                        {' · '}
                        <span className="tnum">{r.todo}</span> à compléter
                      </span>
                    )}
                  </span>
                )}
              </span>
            </span>
            <Money value={r.ca} className="ntable-num" />
            {withPay ? (
              <>
                <span className="ntable-num">{r.obj == null ? <span className="is-muted">-</span> : <Pct value={r.obj} whole />}</span>
                <Money value={r.com} className="ntable-num" />
              </>
            ) : (
              <span className="ntable-num tnum">{formatCount(r.ventes)}</span>
            )}
          </>
        )
        return onOpen ? (
          <button key={r.prof.id} type="button" className="ntable-row" onClick={() => onOpen(r.prof.id)}>
            {cells}
            <ChevronRight size={14} strokeWidth={1.9} className="ntable-chevron" />
          </button>
        ) : (
          <div key={r.prof.id} className="ntable-row">
            {cells}
          </div>
        )
      })}
      <div className="ntable-row is-total">
        <span className="ntable-title">Agence</span>
        <Money value={agency.ca} className="ntable-num" />
        {withPay ? (
          <>
            <span className="ntable-num">{agency.obj == null ? <span className="is-muted">-</span> : <Pct value={agency.obj} whole />}</span>
            <Money value={agency.com} className="ntable-num" />
          </>
        ) : (
          <span className="ntable-num tnum">{formatCount(agency.ventes)}</span>
        )}
      </div>
    </section>
  )
}

/** Ventes de la période : tableau de l'agence (comptées) et lignes
    complètes lisibles (commissions, à compléter). */
function usePeriodRows(board: BoardSale[], sales: Sale[], bounds: { start: string; end: string }) {
  return useMemo(
    () => ({
      rows: board.filter((s) => inPeriod(s, bounds) && isCounted(s)),
      full: sales.filter((s) => inPeriod(s, bounds)),
    }),
    [board, sales, bounds],
  )
}

/** Manager / chef des ventes : la vue équipe (paie et suivi). */
function TeamTable() {
  const { board, rankable, sales, loading, error, reload, openSeller } = useNumbers()
  const p = usePeriod('mois')
  const { rows, full } = usePeriodRows(board, sales, p.bounds)

  const months = p.period === 'semaine' ? 0 : p.period === 'mois' ? 1 : p.period === 'trimestre' ? 3 : 12
  const table = rankable
    .map((prof) => {
      const s = summarize(rows, prof.id)
      const target = objectiveFor(prof.monthly_ca_target, p.period)
      return {
        prof,
        ca: s.ca,
        ventes: s.ventes,
        trc: s.trc,
        obj: target ? s.ca / target : null,
        com: commissionSum(full, prof.id),
        todo: full.filter((x) => x.status === 'active' && !isComplete(x) && isSellerOf(x, prof.id)).length,
      }
    })
    .filter((r) => r.ventes > 0 || r.todo > 0 || r.obj != null)
    .sort((a, b) => b.ca - a.ca)
  const agencySum = summarize(rows)
  const agencyTarget = months ? rankable.reduce((s, x) => s + (x.monthly_ca_target || 0), 0) * months : 0

  return (
    <div className="screen numbers-screen">
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
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : (
        <>
          <SellersTable
            withPay
            rows={table}
            onOpen={openSeller}
            agency={{
              ca: agencySum.ca,
              ventes: agencySum.ventes,
              obj: agencyTarget > 0 ? agencySum.ca / agencyTarget : null,
              com: full.reduce((sum, s) => sum + commissionTotal(s), 0),
            }}
          />
          <p className="ntable-foot">
            Obj. : part de l’objectif de CA atteinte. Com. : commissions des ventes complètes. Touchez un vendeur
            pour son détail.
          </p>
        </>
      )}
    </div>
  )
}

type Scope = 'moi' | 'agence'

/** Commercial : mes commissions ligne à ligne, et le tableau de l'agence. */
function MyCommissions() {
  const { me, board, rankable, sales, loading, error, reload, nameOf } = useNumbers()
  const p = usePeriod('mois')
  const [scope, setScope] = useState<Scope>('moi')
  const { rows } = usePeriodRows(board, sales, p.bounds)

  const mine = sales.filter((s) => isSellerOf(s, me.id) && inPeriod(s, p.bounds) && isCounted(s))
  const my = summarize(mine, me.id)
  const total = commissionSum(mine, me.id)
  const agencySum = summarize(rows)
  const table = rankable
    .map((prof) => {
      const s = summarize(rows, prof.id)
      return { prof, ca: s.ca, ventes: s.ventes, trc: null, obj: null, com: 0, todo: 0 }
    })
    .filter((r) => r.ventes > 0)
    .sort((a, b) => b.ca - a.ca)

  return (
    <div className="screen numbers-screen">
      <Segmented
        options={[
          { value: 'moi', label: 'Mes commissions' },
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
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : scope === 'moi' ? (
        <>
          <section className="card pay-total">
            <span className="eyebrow">Ma commission · {p.label}</span>
            <Money value={total} className="pay-total-value" />
            <span className="pay-total-meta">
              sur <Money value={my.ca} /> de CA HT · <span className="tnum">{formatCount(my.ventes)}</span> vente
              {my.ventes > 1 ? 's' : ''}
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
        <>
          <section className="card">
            <div className="kpi-grid">
              <div className="kpi-cell">
                <Money value={agencySum.ca} compact className="kpi-value" />
                <span className="kpi-label">CA HT agence</span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-value tnum">{formatCount(agencySum.ventes)}</span>
                <span className="kpi-label">ventes</span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-value tnum">{formatCount(agencySum.toitures)}</span>
                <span className="kpi-label">toitures</span>
              </div>
            </div>
          </section>
          <SellersTable
            withPay={false}
            rows={table}
            agency={{ ca: agencySum.ca, ventes: agencySum.ventes, obj: null, com: 0 }}
          />
        </>
      )}
    </div>
  )
}
