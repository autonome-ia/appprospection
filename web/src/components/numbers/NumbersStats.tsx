import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { MoneyHero } from './MoneyHero'
import { useNumbers } from './NumbersData'
import { PREV_LABEL, PeriodBar, usePeriod } from './PeriodBar'
import { EuroDelta } from './SaleRow'
import { Donut, Evolution, SellerBars } from './Charts'
import {
  ORIGINS,
  PRESTATIONS,
  caByBucket,
  caByOrigin,
  periodBuckets,
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

/** Origines en nuances d'encre : trois parts, la légende porte les chiffres. */
const ORIGIN_COLORS = ['var(--ink)', 'var(--ink-3)', 'var(--line-strong)']

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

  const buckets = periodBuckets(p.period, p.bounds)
  const evolution = caByBucket(curRows, buckets, focusId ?? undefined)
  // L'origine vit sur les lignes complètes (mes ventes ; toutes pour un superviseur).
  const origins = caByOrigin(fullCur, focusId ?? undefined)
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
          <MoneyHero
            eyebrow={`${focusId ? nameOf(focusId) : 'Agence'} · CA`}
            value={cur.ca}
            delta={<EuroDelta value={cur.ca - prev.ca} label={PREV_LABEL[p.period]} />}
            mark={
              focusId ? (
                <Avatar id={focusId} name={nameOf(focusId)} color={focusProfile?.color} size={56} />
              ) : (
                <OrgLogo size={56} />
              )
            }
            ribbon={[
              { value: formatCount(cur.ventes), label: `vente${cur.ventes > 1 ? 's' : ''}` },
              { value: cur.panierMoyen == null ? '…' : formatEuros(cur.panierMoyen), label: 'panier moyen' },
              ...(!isSupervisor && myIdx >= 0
                ? [{ value: `${myIdx + 1}${myIdx === 0 ? 'ᵉʳ' : 'ᵉ'}`, label: `sur ${ranked.length}` }]
                : showCommission
                  ? [{ value: formatEuros(commission), label: focusId ? 'commission' : 'commissions' }]
                  : []),
            ]}
          />

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

          <Evolution buckets={buckets} values={evolution} />

          <section className="card">
            <p className="eyebrow">CA par prestation</p>
            <Donut
              slices={PRESTATIONS.map((x) => ({
                key: x.value,
                label: x.label,
                value: cur.caParPrestation[x.value],
                color: `var(--pr-${x.value})`,
              }))}
            />
          </section>

          {!drillId && (
            <section className="card">
              <p className="eyebrow">CA par vendeur</p>
              <SellerBars
                meId={me.id}
                rows={ranked.map((r) => {
                  const prof = profiles.find((x) => x.id === r.id)
                  return {
                    id: r.id,
                    name: prof?.full_name ?? 'Commercial',
                    color: prof?.color ?? null,
                    ca: r.ca,
                    avancement: r.avancement,
                  }
                })}
                onOpen={isSupervisor ? setDrillId : undefined}
              />
            </section>
          )}

          <section className="card">
            <p className="eyebrow">Origine des ventes</p>
            <Donut
              slices={ORIGINS.map((o, i) => ({
                key: o.value,
                label: o.label,
                value: origins[o.value],
                color: ORIGIN_COLORS[i],
              }))}
            />
          </section>

          <section className="card">
            <p className="eyebrow">Comptant et financement</p>
            <div className="pay-figures">
              <div className="pay-figure">
                <span className="pay-figure-value tnum">{formatEuros(cur.caComptant)}</span>
                <span className="pay-figure-label">
                  <i className="pay-dot is-cash" /> Comptant
                </span>
              </div>
              <div className="pay-figure is-right">
                <span className="pay-figure-value tnum">{formatEuros(cur.caFinancement)}</span>
                <span className="pay-figure-label">
                  <i className="pay-dot is-fin" /> Financé
                </span>
              </div>
            </div>
            <div className="pay-split" aria-hidden="true">
              <span className="pay-split-cash" style={{ width: `${100 - financePct}%` }} />
              <span className="pay-split-fin" style={{ width: `${financePct}%` }} />
            </div>
            <p className="kpi-foot">
              {cur.ca > 0 ? (
                <>
                  <span className="tnum">{Math.round(financePct)} %</span> du CA est financé (TRC).
                </>
              ) : (
                'Aucune vente sur cette période.'
              )}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
