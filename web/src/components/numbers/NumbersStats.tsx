import { useEffect, useState } from 'react'
import { ChevronLeft, NotebookText } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { useNumbers } from './NumbersData'
import { PREV_LABEL, PeriodBar, usePeriod } from './PeriodBar'
import { EuroDelta, SaleRow } from './SaleRow'
import { MoneyHero } from './MoneyHero'
import { Money, Pct } from './Money'
import { CumulChart, Evolution, GoalCard, MixBar, SellerBars } from './Charts'
import { openSaleFlow } from '../../lib/sale-flow'
import { fetchStatsRange, type CommercialStats } from '../../data/stats'
import {
  ORIGINS,
  PRESTATIONS,
  caByBucket,
  caByOrigin,
  commissionSum,
  commissionTotal,
  comparisonBounds,
  cumulativeByDay,
  formatCount,
  inPeriod,
  isComplete,
  isSellerOf,
  objectiveFor,
  paceOf,
  periodBuckets,
  rankSellers,
  summarize,
  toDateLabel,
  type NumbersPeriod,
} from '../../domain/sales'

/** Origines en nuances d'encre (la légende porte les chiffres). */
const ORIGIN_COLORS = ['var(--ink)', 'var(--ink-3)', 'var(--line-strong)']
const UNIT: Record<NumbersPeriod, string> = {
  semaine: 'de la semaine',
  mois: 'du mois',
  trimestre: 'du trimestre',
  annee: 'de l’année',
}
const parseDay = (k: string) => new Date(`${k}T00:00:00`)

/**
 * Stats de Numbers — « comprendre » (tour UI/UX du 26/09) : CA et
 * comparaison À DATE, objectif avec rythme et projection, CA cumulé face à
 * l'objectif (semaine, mois) ou par mois (trimestre, année), CA par vendeur,
 * puis la composition (toitures, part financée, prestations, origines).
 * Superviseur : l'agence, puis le détail d'un commercial (ses ventes et sa
 * prospection de la période).
 */
export function NumbersStats() {
  const { me, isSupervisor, profiles, sales, board, rankable, loading, error, reload, nameOf, drillId, setDrillId, goTo } =
    useNumbers()
  const p = usePeriod('mois')

  const focusId = isSupervisor ? drillId : me.id
  const who = focusId ?? undefined
  const cmp = comparisonBounds(p.bounds, p.previous)
  const cmpLabel = cmp.toDate ? toDateLabel(cmp) : PREV_LABEL[p.period]
  const curRows = board.filter((s) => inPeriod(s, p.bounds))
  const cur = summarize(curRows, who)
  const prev = summarize(board.filter((s) => inPeriod(s, cmp)), who)

  const fullCur = sales.filter((s) => inPeriod(s, p.bounds))
  const commission = focusId
    ? commissionSum(fullCur.filter((s) => isSellerOf(s, focusId)), focusId)
    : fullCur.reduce((sum, s) => sum + commissionTotal(s), 0)
  const showCommission = focusId === me.id || isSupervisor

  const focusProfile = focusId ? profiles.find((x) => x.id === focusId) : null
  const monthlyGoal = focusId
    ? (focusProfile?.monthly_ca_target ?? 0)
    : rankable.reduce((s, x) => s + (x.monthly_ca_target || 0), 0)
  const target = objectiveFor(monthlyGoal, p.period)

  const ranked = rankSellers(curRows, rankable, p.period).filter((r) => r.ca > 0 || r.objectif)

  // Évolution : cumul jour par jour (semaine, mois), barres par mois sinon.
  const daily = p.period === 'semaine' || p.period === 'mois'
  const cumul = cumulativeByDay(board, p.bounds, who)
  const cumulPrev = cumulativeByDay(board, p.previous, who, parseDay(p.previous.end))
  const buckets = periodBuckets(p.period, p.bounds)

  const origins = caByOrigin(fullCur, who)
  const financePct = cur.ca > 0 ? cur.finance / cur.ca : 0

  // Détail d'un commercial : sa prospection sur la même période.
  const [prospection, setProspection] = useState<CommercialStats | null>(null)
  const drillKey = drillId ? `${drillId}:${p.bounds.start}:${p.bounds.end}` : null
  useEffect(() => {
    if (!drillKey || !drillId) return
    let alive = true
    setProspection(null)
    fetchStatsRange(parseDay(p.bounds.start), parseDay(p.bounds.end))
      .then((r) => {
        if (alive) setProspection(r.byCommercial[drillId] ?? null)
      })
      .catch(() => {
        if (alive) setProspection(null)
      })
    return () => {
      alive = false
    }
    // drillKey résume drillId + bornes : pas de rechargement à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillKey])
  const drillSales = drillId
    ? fullCur.filter((s) => isSellerOf(s, drillId)).sort((a, b) => Number(isComplete(a)) - Number(isComplete(b)))
    : []

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
            delta={<EuroDelta value={cur.ca - prev.ca} label={cmpLabel} />}
            mark={
              focusId ? (
                <Avatar id={focusId} name={nameOf(focusId)} color={focusProfile?.color} size={56} />
              ) : (
                <OrgLogo size={56} />
              )
            }
            ribbon={[
              { value: formatCount(cur.ventes), label: `vente${cur.ventes > 1 ? 's' : ''}` },
              {
                value: cur.panierMoyen == null ? '…' : <Money value={cur.panierMoyen} compact />,
                label: 'panier moyen',
              },
              showCommission
                ? { value: <Money value={commission} compact />, label: focusId ? 'commission' : 'commissions' }
                : { value: formatCount(cur.toitures), label: 'toitures' },
            ]}
          />

          {target != null && (
            <GoalCard
              title={focusId ? (focusId === me.id ? 'Mon objectif' : 'Objectif de CA') : 'Objectif de l’agence'}
              ca={cur.ca}
              target={target}
              bounds={p.bounds}
              unit={UNIT[p.period]}
            />
          )}

          {drillId && (
            <section className="card">
              <p className="eyebrow">Prospection · même période</p>
              {prospection ? (
                <div className="kpi-grid">
                  <div className="kpi-cell">
                    <span className="kpi-value tnum">{prospection.portes}</span>
                    <span className="kpi-label">portes</span>
                  </div>
                  <div className="kpi-cell">
                    <span className="kpi-value tnum">{prospection.rdv_pris}</span>
                    <span className="kpi-label">RDV pris</span>
                  </div>
                  <div className="kpi-cell">
                    <span className="kpi-value tnum">{prospection.rdv_effectues}</span>
                    <span className="kpi-label">RDV effectués</span>
                  </div>
                </div>
              ) : (
                <p className="screen-empty">Aucune activité de prospection sur cette période.</p>
              )}
            </section>
          )}

          {daily ? (
            <CumulChart
              days={cumul.days}
              values={cumul.values}
              prev={cumulPrev.values}
              target={target}
              prevLabel={p.period === 'mois' ? 'Mois précédent' : 'Semaine précédente'}
            />
          ) : (
            <Evolution buckets={buckets} values={caByBucket(curRows, buckets, who)} goal={monthlyGoal > 0 ? monthlyGoal : null} />
          )}

          {!drillId && (
            <section className="card">
              <p className="eyebrow">CA par vendeur</p>
              <SellerBars
                meId={me.id}
                onOpen={isSupervisor ? setDrillId : undefined}
                rows={ranked.map((r) => {
                  const prof = profiles.find((x) => x.id === r.id)
                  // Un commercial ne voit l'objectif que le SIEN (choix briac 26/09).
                  const seesGoal = isSupervisor || r.id === me.id
                  const pace = seesGoal && r.objectif ? paceOf(r.ca, r.objectif, p.bounds) : null
                  return {
                    id: r.id,
                    name: prof?.full_name ?? 'Commercial',
                    color: prof?.color ?? null,
                    ca: r.ca,
                    ventes: r.ventes,
                    avancement: seesGoal ? r.avancement : null,
                    ecart: pace && pace.elapsed < 1 ? pace.ecart : null,
                  }
                })}
              />
            </section>
          )}

          {drillId && (
            <section className="home-section">
              <p className="eyebrow section-title">
                <NotebookText size={12} strokeWidth={2} /> Ses ventes · {p.label}
              </p>
              {drillSales.length === 0 ? (
                <p className="screen-empty">Aucune vente sur cette période.</p>
              ) : (
                drillSales.map((s) => (
                  <SaleRow
                    key={s.id}
                    sale={s}
                    profiles={profiles}
                    nameOf={nameOf}
                    forProfile={drillId}
                    onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })}
                  />
                ))
              )}
              <button type="button" className="text-btn" onClick={() => goTo('ventes')}>
                Ouvrir le cahier des ventes
              </button>
            </section>
          )}

          {/* Plus de carte toitures / part financée / part toiture (retour
              briac 26/09 : doublon). La part toiture est le % de la ligne
              Toiture, le TRC le % du financement ; le NOMBRE de toitures
              (indicateur d'Alexis) vit dans le libellé de la ligne Toiture. */}
          <section className="card">
            <p className="eyebrow">Prestations</p>
            <MixBar
              slices={PRESTATIONS.map((x) => ({
                key: x.value,
                label:
                  x.value === 'toiture' && cur.toitures > 0
                    ? (
                        <>
                          Toiture · <span className="tnum">{formatCount(cur.toitures)}</span> vente
                          {cur.toitures > 1 ? 's' : ''}
                        </>
                      )
                    : x.label,
                value: cur.caParPrestation[x.value],
                color: x.value === 'toiture' ? 'var(--ink)' : 'var(--ink-3)',
              })).sort((a, b) => b.value - a.value)}
            />
          </section>

          {!drillId && (
            <section className="card">
              <p className="eyebrow">Origine des ventes</p>
              <MixBar
                slices={ORIGINS.map((o, i) => ({
                  key: o.value,
                  label: o.label,
                  value: origins[o.value],
                  color: ORIGIN_COLORS[i],
                }))}
              />
            </section>
          )}

          <section className="card">
            <p className="eyebrow">Comptant et financement</p>
            <div className="pay-figures">
              <div className="pay-figure">
                <Money value={cur.caComptant} className="pay-figure-value" />
                <span className="pay-figure-label">
                  <i className="pay-dot is-cash" /> Comptant
                </span>
              </div>
              <div className="pay-figure is-right">
                <Money value={cur.caFinancement} className="pay-figure-value" />
                <span className="pay-figure-label">
                  <i className="pay-dot is-fin" /> Financé
                </span>
              </div>
            </div>
            <div className="pay-split" aria-hidden="true">
              <span className="pay-split-cash" style={{ width: `${(1 - financePct) * 100}%` }} />
              <span className="pay-split-fin" style={{ width: `${financePct * 100}%` }} />
            </div>
            <p className="kpi-foot">
              {cur.ca > 0 ? (
                <>
                  {isSupervisor ? 'TRC : ' : ''}
                  <Pct value={financePct} /> du CA est financé.
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
