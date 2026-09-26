import { useState, type ReactNode } from 'react'
import { ChevronRight, CircleAlert, ListChecks, Plus, ReceiptText, Settings, TrendingDown } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { Num } from '../ui/Num'
import { ProfileSheet } from '../ProfileSheet'
import { TeamSheet } from '../TeamSheet'
import { useNumbers } from './NumbersData'
import { EuroDelta, shortDay } from './SaleRow'
import { Money, Pct } from './Money'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  commissionOf,
  commissionSum,
  comparisonBounds,
  formatCount,
  inPeriod,
  isComplete,
  isCounted,
  isSellerOf,
  missingFields,
  objectiveFor,
  paceOf,
  periodBounds,
  periodLabel,
  prestationLabel,
  rankSellers,
  shiftPeriod,
  summarize,
  toDateLabel,
} from '../../domain/sales'

const TODAY_LABEL = () => {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Carte héros de l'Accueil (refonte du 26/09, sous-agent expert + choix
 * briac) : le chiffre, sa ligne de contexte, et l'objectif FUSIONNÉ dessous
 * (barre, repère « attendu à ce jour », reste à faire). Plus de projection
 * ni d'écart en rouge ici : c'est le rôle de Stats (le tap y mène).
 */
function HomeHero({
  eyebrow,
  value,
  unit,
  sub,
  delta,
  mark,
  goal,
  noGoal,
  showExpected,
  onOpen,
}: {
  eyebrow: string
  value: number
  unit: string
  sub: ReactNode
  delta?: ReactNode
  mark?: ReactNode
  goal: { ca: number; target: number; bounds: { start: string; end: string } } | null
  noGoal?: ReactNode
  /** Manager : « attendu 87 % » en toutes lettres. */
  showExpected?: boolean
  onOpen: () => void
}) {
  const pace = goal ? paceOf(goal.ca, goal.target, goal.bounds) : null
  // Du 1er au 3 du mois, le rythme n'a pas de sens : pas de repère.
  const early = new Date().getDate() <= 3
  const done = !!goal && goal.ca >= goal.target
  return (
    <section className="card home-hero">
      <button type="button" className="home-hero-hit" onClick={onOpen} aria-label={`${eyebrow} : voir les stats`} />
      <div className="home-hero-top">
        <p className="eyebrow">{eyebrow}</p>
        {mark}
      </div>
      <div className="hero-line">
        <span className="hero-value tnum">
          <Num value={Math.round(value)} />
        </span>
        <span className="hero-unit">{unit}</span>
      </div>
      <p className="home-hero-sub">{sub}</p>
      {delta}
      {goal && pace && (
        <div className="home-goal">
          <div className="home-goal-row">
            <div className="goal-bar">
              <div className={`goal-fill ${done ? 'is-done' : ''}`} style={{ width: `${Math.min(100, (goal.ca / goal.target) * 100)}%` }} />
              {!done && !early && pace.elapsed < 1 && (
                <span className="goal-mark" style={{ left: `${pace.elapsed * 100}%` }} aria-hidden="true" />
              )}
            </div>
            <Pct value={goal.ca / goal.target} whole className="home-goal-pct" />
          </div>
          {done ? (
            <p className="goal-status is-ahead">
              Objectif atteint · <Money value={goal.ca - goal.target} /> au-delà
            </p>
          ) : (
            <p className="goal-line">
              {showExpected && !early && (
                <>
                  Attendu <Pct value={pace.elapsed} whole /> ·{' '}
                </>
              )}
              Reste <Money value={pace.reste} className="is-strong" />
              {pace.joursOuvres > 0 && (
                <>
                  {' · '}
                  <span className="tnum">{pace.joursOuvres}</span> jour{pace.joursOuvres > 1 ? 's' : ''} ouvré
                  {pace.joursOuvres > 1 ? 's' : ''}
                </>
              )}
            </p>
          )}
        </div>
      )}
      {!goal && noGoal}
    </section>
  )
}

/** Titre de section avec lien « voir tout ». */
function SectionTitle({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="home-section-head">
      <p className="eyebrow section-title">
        {icon} {children}
      </p>
      {action && (
        <button type="button" className="text-btn home-section-link" onClick={action.onClick}>
          {action.label} <ChevronRight size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

/**
 * Accueil de Numbers — refonte du 26/09 (sous-agent expert, choix briac,
 * sans les RDV en attente) : « quoi faire maintenant », pas le bilan (Stats).
 *  - Commercial : commission + objectif fusionnés, « À faire » (ventes à
 *    compléter), rang, ses 3 dernières ventes avec leur commission.
 *  - Manager / chef des ventes : agence + objectif fusionnés (écart à date en
 *    gris), « À surveiller » (vendeurs en retard ou sans vente), « À
 *    traiter » (compteur), dernières ventes de l'agence, « Mes ventes ».
 */
export function NumbersHome({ spaceSwitch }: { spaceSwitch: ReactNode }) {
  const { me, isSupervisor, isManager, canEditAll, profiles, sales, board, rankable, loading, error, reload, nameOf, openSeller, goTo, openBookTodo } =
    useNumbers()
  const [profileOpen, setProfileOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)

  const month = periodBounds('mois')
  const cmp = comparisonBounds(month, periodBounds('mois', shiftPeriod('mois', -1)))
  const monthName = periodLabel('mois').split(' ')[0]
  const color = profiles.find((p) => p.id === me.id)?.color
  const early = new Date().getDate() <= 3

  // --- Moi ---
  const mineMonth = board.filter((s) => isSellerOf(s, me.id) && inPeriod(s, month))
  const cur = summarize(mineMonth, me.id)
  const myFull = sales.filter((s) => isSellerOf(s, me.id))
  const commission = commissionSum(myFull.filter((s) => inPeriod(s, month)), me.id)
  const myTarget = objectiveFor(profiles.find((p) => p.id === me.id)?.monthly_ca_target ?? 0, 'mois')

  // --- Agence ---
  const monthRows = board.filter((s) => inPeriod(s, month))
  const agency = summarize(monthRows)
  const agencyPrev = summarize(board.filter((s) => inPeriod(s, cmp)))
  const agencyTarget = rankable.reduce((sum, p) => sum + (p.monthly_ca_target || 0), 0)
  const ranked = rankSellers(monthRows, rankable, 'mois').filter((r) => r.ca > 0 || r.objectif)
  const myRank = ranked.findIndex((r) => r.id === me.id)

  // À surveiller : en retard sur le rythme (avec objectif), ou sans aucune
  // vente ce mois (sans objectif). 3 au plus, les plus en difficulté d'abord.
  const watch = rankSellers(monthRows, rankable, 'mois')
    .filter((r) => r.id !== me.id || !isManager)
    .map((r) => {
      const pace = r.objectif ? paceOf(r.ca, r.objectif, month) : null
      return { r, pace }
    })
    .filter(({ r, pace }) => (pace ? pace.ecart < 0 : r.ca === 0))
    .sort((a, b) => (a.pace?.ecart ?? -a.r.ca - 1e9) - (b.pace?.ecart ?? -b.r.ca - 1e9))
    .slice(0, 3)

  const todo = sales.filter((s) => s.status === 'active' && !isComplete(s) && (canEditAll || isSellerOf(s, me.id)))
  const myTodo = todo.filter((s) => isSellerOf(s, me.id))
  const byDate = <T extends { sold_on: string; created_at: string }>(a: T, b: T) =>
    a.sold_on < b.sold_on ? 1 : a.sold_on > b.sold_on ? -1 : a.created_at < b.created_at ? 1 : -1
  const myRecent = myFull.filter((s) => isCounted(s)).sort(byDate).slice(0, 3)
  const agencyRecent = board.filter((s) => isCounted(s)).sort(byDate).slice(0, 4)

  return (
    <div className="screen accueil-screen numbers-home">
      <header className="accueil-head">
        <button type="button" className="avatar-btn" onClick={() => setProfileOpen(true)} aria-label="Profil et déconnexion">
          <Avatar id={me.id} name={me.full_name} color={color} />
        </button>
        <div className="accueil-head-texts">
          <span className="accueil-date">{TODAY_LABEL()}</span>
          <h1 className="accueil-hello">Bonjour{me.full_name ? ` ${me.full_name.split(/\s/)[0]}` : ''}</h1>
        </div>
        <button type="button" className="numbers-add" onClick={() => openSaleFlow({ kind: 'new' })} aria-label="Nouvelle vente" title="Nouvelle vente">
          <Plus size={20} strokeWidth={2.2} />
        </button>
        <button type="button" className="icon-btn accueil-settings numbers-settings" onClick={() => setProfileOpen(true)} aria-label="Réglages">
          <Settings size={19} strokeWidth={1.8} />
        </button>
      </header>

      {spaceSwitch}

      {error && (
        <div className="load-error">
          <span>Impossible de charger les ventes : vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {loading && !error ? (
        <div className="stats-skeleton" aria-hidden="true">
          <span className="sk sk-hero" />
          <span className="sk sk-block" />
        </div>
      ) : isSupervisor ? (
        <>
          <HomeHero
            eyebrow={`Agence · ${monthName}`}
            value={agency.ca}
            unit="€ HT"
            sub={
              <>
                <span className="tnum">{formatCount(agency.ventes)}</span> vente{agency.ventes > 1 ? 's' : ''} ·{' '}
                <span className="tnum">{formatCount(agency.toitures)}</span> toiture{agency.toitures > 1 ? 's' : ''}
              </>
            }
            delta={<EuroDelta value={agency.ca - agencyPrev.ca} label={cmp.toDate ? toDateLabel(cmp) : 'vs mois dernier'} neutral />}
            mark={<OrgLogo size={40} />}
            goal={agencyTarget > 0 ? { ca: agency.ca, target: agencyTarget, bounds: month } : null}
            showExpected
            noGoal={
              isManager ? (
                <button type="button" className="text-btn home-goal-cta" onClick={() => setTeamOpen(true)}>
                  Fixer les objectifs de CA
                </button>
              ) : (
                <p className="goal-line">Objectifs de CA non fixés.</p>
              )
            }
            onOpen={() => goTo('n-stats')}
          />

          {!early && (
            <section className="home-section">
              <SectionTitle icon={<TrendingDown size={12} strokeWidth={2} />} action={{ label: 'Équipe', onClick: () => goTo('tableaux') }}>
                À surveiller
              </SectionTitle>
              {watch.length === 0 ? (
                <p className="screen-empty">Toute l’équipe tient son rythme.</p>
              ) : (
                watch.map(({ r, pace }) => {
                  const p = profiles.find((x) => x.id === r.id)
                  return (
                    <button key={r.id} type="button" className="home-row" onClick={() => openSeller(r.id)}>
                      <Avatar id={r.id} name={p?.full_name} color={p?.color} size={28} />
                      <span className="home-row-main">
                        <span className="home-row-title">{p?.full_name ?? 'Commercial'}</span>
                        <span className="home-row-sub">
                          {pace ? (
                            <>
                              en retard de <Money value={-pace.ecart} /> · <Pct value={r.avancement ?? 0} whole /> de l’objectif
                            </>
                          ) : (
                            'aucune vente ce mois'
                          )}
                        </span>
                      </span>
                      <Money value={r.ca} className="home-row-value" />
                      <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
                    </button>
                  )
                })
              )}
            </section>
          )}

          {todo.length > 0 && (
            <section className="home-section">
              <SectionTitle icon={<ListChecks size={12} strokeWidth={2} />}>À traiter</SectionTitle>
              <button type="button" className="home-row" onClick={openBookTodo}>
                <CircleAlert size={16} strokeWidth={2} className="home-row-warn" />
                <span className="home-row-main">
                  <span className="home-row-title">
                    <span className="tnum">{todo.length}</span> vente{todo.length > 1 ? 's' : ''} à compléter
                  </span>
                  <span className="home-row-sub">
                    {[...new Set(todo.map((s) => nameOf(s.seller1_id).split(/\s/)[0]))].join(', ')}
                  </span>
                </span>
                <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
              </button>
            </section>
          )}

          <section className="home-section">
            <SectionTitle icon={<ReceiptText size={12} strokeWidth={2} />} action={{ label: 'Cahier', onClick: () => goTo('ventes') }}>
              Dernières ventes
            </SectionTitle>
            {agencyRecent.length === 0 ? (
              <p className="screen-empty">Aucune vente enregistrée pour l’instant.</p>
            ) : (
              agencyRecent.map((s) => {
                const p = profiles.find((x) => x.id === s.seller1_id)
                const names = [s.seller1_id, s.seller2_id].filter(Boolean).map((id) => nameOf(id).split(/\s/)[0]).join(' et ')
                return (
                  <button key={s.id} type="button" className="home-row" onClick={() => openSaleFlow({ kind: 'open', saleId: s.id })}>
                    <Avatar id={s.seller1_id} name={p?.full_name} color={p?.color} size={28} />
                    <span className="home-row-main">
                      <span className="home-row-title">
                        {names} · {prestationLabel(s.prestation)}
                      </span>
                      <span className="home-row-sub tnum">{shortDay(s.sold_on)}</span>
                    </span>
                    <Money value={s.amount_ht ?? 0} className="home-row-value" />
                  </button>
                )
              })
            )}
          </section>

          {(cur.ca > 0 || myTarget) && (
            <button type="button" className="card mine-line" onClick={() => openSeller(me.id)}>
              <span className="mine-label">Mes ventes · {monthName}</span>
              <span className="mine-figures">
                <Money value={cur.ca} /> HT
                {/* Le manager (directeur d'agence) n'a pas de commission
                    (briac, 26/09) : le montant de ses ventes seulement. Le
                    chef des ventes, lui, garde la sienne. */}
                {!isManager && (
                  <>
                    {' '}
                    <span className="mine-sep">·</span> commission <Money value={commission} />
                  </>
                )}
              </span>
            </button>
          )}
        </>
      ) : (
        <>
          <HomeHero
            eyebrow={`Ma commission · ${monthName}`}
            value={commission}
            unit="€"
            sub={
              <>
                sur <Money value={cur.ca} /> HT · <span className="tnum">{formatCount(cur.ventes)}</span> vente
                {cur.ventes > 1 ? 's' : ''}
              </>
            }
            goal={myTarget != null ? { ca: cur.ca, target: myTarget, bounds: month } : null}
            onOpen={() => goTo('n-stats')}
          />

          <section className="home-section">
            <SectionTitle icon={<ListChecks size={12} strokeWidth={2} />}>À faire{myTodo.length ? ` · ${myTodo.length}` : ''}</SectionTitle>
            {myTodo.length === 0 ? (
              <p className="screen-empty">Toutes vos ventes sont complètes.</p>
            ) : (
              myTodo.map((s) => (
                <button key={s.id} type="button" className="home-row" onClick={() => openSaleFlow({ kind: 'open', saleId: s.id })}>
                  <CircleAlert size={16} strokeWidth={2} className="home-row-warn" />
                  <span className="home-row-main">
                    <span className="home-row-title">{s.client_name || s.address || 'Vente'}</span>
                    <span className="home-row-sub">Manque : {missingFields(s).join(', ')}</span>
                  </span>
                  <span className="home-row-when tnum">{shortDay(s.sold_on)}</span>
                  <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
                </button>
              ))
            )}
          </section>

          {myRank >= 0 && ranked.length > 1 && (
            <button type="button" className="card home-rank" onClick={() => goTo('tableaux')}>
              <span className="home-rank-pos tnum">
                {myRank + 1}
                {myRank === 0 ? 'ᵉʳ' : 'ᵉ'}
              </span>
              <span className="home-rank-texts">
                <span className="home-rank-title">
                  sur <span className="tnum">{ranked.length}</span> ce mois
                </span>
                <span className="home-rank-sub">
                  {myRank === 0 ? (
                    <>
                      En tête, <Money value={ranked[0].ca - ranked[1].ca} /> devant {nameOf(ranked[1].id).split(/\s/)[0]}
                    </>
                  ) : (
                    <>
                      <Money value={ranked[myRank - 1].ca - ranked[myRank].ca} /> derrière {nameOf(ranked[myRank - 1].id).split(/\s/)[0]}
                    </>
                  )}
                </span>
              </span>
              <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />
            </button>
          )}

          <section className="home-section">
            <SectionTitle icon={<ReceiptText size={12} strokeWidth={2} />} action={{ label: 'Cahier', onClick: () => goTo('ventes') }}>
              Mes dernières ventes
            </SectionTitle>
            {myRecent.length === 0 ? (
              <p className="screen-empty">Aucune vente enregistrée pour l’instant.</p>
            ) : (
              myRecent.map((s) => (
                <button key={s.id} type="button" className="home-row" onClick={() => openSaleFlow({ kind: 'open', saleId: s.id })}>
                  <span className="home-row-main">
                    <span className="home-row-title">
                      {prestationLabel(s.prestation)}
                      {s.client_name ? ` · ${s.client_name}` : ''}
                    </span>
                    <span className="home-row-sub tnum">{shortDay(s.sold_on)}</span>
                  </span>
                  <span className="home-row-figures">
                    <Money value={s.amount_ht ?? 0} className="home-row-value" />
                    <span className="home-row-gain">
                      +<Money value={commissionOf(s, me.id)} />
                    </span>
                  </span>
                </button>
              ))
            )}
          </section>
        </>
      )}

      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
      {/* « Fixer les objectifs de CA » : l'écran Équipe, ouvert directement
          sur sa section Ventes. */}
      <TeamSheet open={teamOpen} onOpenChange={setTeamOpen} profile={me} focusSales />
    </div>
  )
}
