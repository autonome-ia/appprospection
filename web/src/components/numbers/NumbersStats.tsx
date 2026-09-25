import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { Num } from '../ui/Num'
import { useNumbers } from './NumbersData'
import { PREV_LABEL, PeriodBar, usePeriod } from './PeriodBar'
import { EuroDelta } from './SaleRow'
import {
  PRESTATIONS,
  commissionSum,
  commissionTotal,
  formatCount,
  formatEuros,
  formatRate,
  inPeriod,
  isSellerOf,
  objectiveFor,
  rankSellers,
  summarize,
} from '../../domain/sales'

/**
 * Stats de Numbers (plan §4.3) : mêmes codes que les Stats de prospection
 * (héros + ruban, objectif, classement, drill-down superviseur) appliqués
 * au CA. Le commercial voit SES chiffres et le classement de CA ; le
 * superviseur voit l'agence et descend sur un commercial.
 */
export function NumbersStats() {
  const { me, isSupervisor, profiles, sales, board, rankable, loading, error, reload, nameOf } = useNumbers()
  const p = usePeriod('mois')
  const [drillId, setDrillId] = useState<string | null>(null)

  // Qui regarde-t-on ? Le commercial : lui. Le superviseur : l'agence, ou le
  // commercial choisi dans le classement.
  const focusId = isSupervisor ? drillId : me.id
  const curRows = board.filter((s) => inPeriod(s, p.bounds))
  const prevRows = board.filter((s) => inPeriod(s, p.previous))
  const cur = summarize(curRows, focusId ?? undefined)
  const prev = summarize(prevRows, focusId ?? undefined)

  // Commission : sur les lignes complètes (les miennes, ou toutes pour un
  // superviseur). Vue agence : total à verser.
  const fullCur = sales.filter((s) => inPeriod(s, p.bounds))
  const commission = focusId
    ? commissionSum(fullCur.filter((s) => isSellerOf(s, focusId)), focusId)
    : fullCur.reduce((sum, s) => sum + commissionTotal(s), 0)
  const showCommission = focusId === me.id || isSupervisor

  const ranked = rankSellers(curRows, rankable, p.period).filter((r) => r.ca > 0 || r.objectif)
  const myIdx = ranked.findIndex((r) => r.id === me.id)

  const focusProfile = focusId ? profiles.find((x) => x.id === focusId) : null
  const target = focusId
    ? objectiveFor(focusProfile?.monthly_ca_target ?? 0, p.period)
    : objectiveFor(rankable.reduce((s, x) => s + (x.monthly_ca_target || 0), 0), p.period)

  const maxPrest = Math.max(1, ...PRESTATIONS.map((x) => cur.caParPrestation[x.value]))
  const financePct = cur.ca > 0 ? (cur.caFinancement / cur.ca) * 100 : 0

  return (
    <div className="screen stats-screen numbers-screen">
      <PeriodBar p={p} />

      {error && (
        <div className="load-error">
          <span>Statistiques impossibles à charger : vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {isSupervisor && drillId && (
        <button type="button" className="drill-back" onClick={() => setDrillId(null)}>
          <ChevronLeft size={16} /> Retour agence
        </button>
      )}

      {loading ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-hero" />
          <span className="sk sk-block" />
          <span className="sk sk-block sk-block-tall" />
        </div>
      ) : (
        <>
          <section className="card stats-hero">
            <div className="hero-top">
              <div className="hero-main">
                <p className="eyebrow">{focusId ? nameOf(focusId) : 'Agence'} · CA HT</p>
                <div className="hero-line">
                  <span className="hero-value tnum">
                    <Num value={Math.round(cur.ca)} />
                  </span>
                  <span className="hero-unit">€</span>
                </div>
                <EuroDelta value={cur.ca - prev.ca} label={PREV_LABEL[p.period]} />
              </div>
              <div className="hero-mark">
                {focusId ? (
                  <Avatar id={focusId} name={nameOf(focusId)} color={focusProfile?.color} size={72} />
                ) : (
                  <OrgLogo size={72} />
                )}
              </div>
            </div>
            <div className="hero-ribbon">
              <div className="ribbon-stat">
                <span className="ribbon-value tnum">{formatCount(cur.ventes)}</span>
                <span className="ribbon-label">vente{cur.ventes > 1 ? 's' : ''}</span>
              </div>
              <div className="ribbon-stat">
                <span className="ribbon-value tnum">{cur.panierMoyen == null ? '…' : formatEuros(cur.panierMoyen)}</span>
                <span className="ribbon-label">panier moyen</span>
              </div>
              {!isSupervisor && myIdx >= 0 ? (
                <div className="ribbon-stat">
                  <span className="ribbon-value tnum">{`${myIdx + 1}${myIdx === 0 ? 'ᵉʳ' : 'ᵉ'}`}</span>
                  <span className="ribbon-label">sur {ranked.length}</span>
                </div>
              ) : showCommission ? (
                <div className="ribbon-stat">
                  <span className="ribbon-value tnum">{formatEuros(commission)}</span>
                  <span className="ribbon-label">{focusId ? 'commission' : 'commissions'}</span>
                </div>
              ) : null}
            </div>
          </section>

          {target != null && (
            <div className="card obj-card">
              <div className="obj-head">
                <span className="eyebrow">{focusId ? 'Objectif de CA' : 'Objectif de CA agence'}</span>
                <span className="obj-big tnum">
                  {formatEuros(cur.ca)} / {formatEuros(target)}
                </span>
              </div>
              <div className="obj-bar-bg">
                <div
                  className={`obj-bar ${cur.ca >= target ? 'is-done' : ''}`}
                  style={{ width: `${Math.min(100, (cur.ca / target) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Les trois indicateurs d'Alexis : toitures, TRC, part toiture. */}
          <section className="card">
            <div className="kpi-grid is-three">
              <div className="kpi-cell">
                <span className="kpi-value tnum">{formatCount(cur.toitures)}</span>
                <span className="kpi-label">Toitures vendues</span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-value tnum">{cur.trc == null ? '…' : formatRate(cur.trc)}</span>
                <span className="kpi-label">TRC</span>
              </div>
              <div className="kpi-cell">
                <span className="kpi-value tnum">{cur.partToiture == null ? '…' : formatRate(cur.partToiture)}</span>
                <span className="kpi-label">Part toiture</span>
              </div>
            </div>
            <p className="kpi-foot">TRC : montant financé ÷ CA. Part toiture : CA des toitures ÷ CA total.</p>
          </section>

          <section className="card">
            <p className="eyebrow">CA par prestation</p>
            <div className="prest-bars">
              {PRESTATIONS.map((x) => {
                const v = cur.caParPrestation[x.value]
                return (
                  <div key={x.value} className={`prest-bar ${x.value === 'toiture' ? 'is-lead' : ''}`}>
                    <span className="prest-label">{x.label}</span>
                    <span className="prest-track">
                      <span className="prest-fill" style={{ width: `${(v / maxPrest) * 100}%` }} />
                    </span>
                    <span className="prest-value tnum">{formatEuros(v)}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card">
            <p className="eyebrow">Comptant et financement</p>
            <div className="pay-split" aria-hidden="true">
              <span className="pay-split-cash" style={{ width: `${100 - financePct}%` }} />
              <span className="pay-split-fin" style={{ width: `${financePct}%` }} />
            </div>
            <div className="pay-legend">
              <span>
                <i className="pay-dot is-cash" /> Comptant <span className="tnum">{formatEuros(cur.caComptant)}</span>
              </span>
              <span>
                <i className="pay-dot is-fin" /> Financement <span className="tnum">{formatEuros(cur.caFinancement)}</span>
              </span>
            </div>
          </section>

          {!drillId && (
            <section className="card">
              <p className="eyebrow">Classement du CA</p>
              {ranked.length === 0 && <p className="screen-empty">Aucune vente sur cette période.</p>}
              {ranked.map((r, i) => {
                const prof = profiles.find((x) => x.id === r.id)
                const pct = r.avancement == null ? null : Math.min(100, r.avancement * 100)
                const content = (
                  <>
                    <div className="rank-line">
                      <span className="rank-name">
                        <Avatar id={r.id} name={prof?.full_name} color={prof?.color} size={24} />
                        {prof?.full_name ?? 'Commercial'}
                      </span>
                      <span className="rank-sales tnum">{formatEuros(r.ca)}</span>
                    </div>
                    <div className="rank-metrics">
                      <span className="tnum">{formatCount(r.ventes)}</span> vente{r.ventes > 1 ? 's' : ''}
                    </div>
                    {pct != null && (
                      <div className="rank-obj">
                        <div className="obj-bar-bg">
                          <div className={`obj-bar ${pct >= 100 ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="obj-text tnum">{Math.round(r.avancement! * 100)} %</span>
                      </div>
                    )}
                  </>
                )
                return (
                  <div key={r.id} className={`rank ${r.id === me.id ? 'is-me' : ''}`}>
                    <span className="rank-pos tnum">{i + 1}</span>
                    {isSupervisor ? (
                      <>
                        <button type="button" className="rank-body rank-clickable" onClick={() => setDrillId(r.id)}>
                          {content}
                        </button>
                        <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
                      </>
                    ) : (
                      <div className="rank-body">{content}</div>
                    )}
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}
    </div>
  )
}
