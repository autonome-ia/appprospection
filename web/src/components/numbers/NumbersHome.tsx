import { useState, type ReactNode } from 'react'
import { CircleAlert, Plus, Settings, TrendingDown } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { ProfileSheet } from '../ProfileSheet'
import { useNumbers } from './NumbersData'
import { EuroDelta, SaleRow } from './SaleRow'
import { MoneyHero } from './MoneyHero'
import { Money } from './Money'
import { GoalCard, SellerBars } from './Charts'
import { openSaleFlow } from '../../lib/sale-flow'
import {
  commissionSum,
  comparisonBounds,
  formatCount,
  inPeriod,
  isComplete,
  isSellerOf,
  objectiveFor,
  paceOf,
  periodBounds,
  periodLabel,
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
 * Accueil de Numbers — tour UI/UX du 26/09 (3 audits) : « où en est-on ? »
 * en 30 secondes.
 *  - Manager / chef des ventes : l'AGENCE en héros (CA, comparaison à date,
 *    objectif avec rythme et projection), puis « Qui décroche » et les ventes
 *    à compléter.
 *  - Commercial : SA PAIE en héros (commission du mois), son objectif avec
 *    le reste à faire, son rang, ses ventes à compléter.
 */
export function NumbersHome({ spaceSwitch }: { spaceSwitch: ReactNode }) {
  const { me, isSupervisor, canEditAll, profiles, sales, board, rankable, loading, error, reload, nameOf, openSeller } =
    useNumbers()
  const [profileOpen, setProfileOpen] = useState(false)

  const month = periodBounds('mois')
  const cmp = comparisonBounds(month, periodBounds('mois', shiftPeriod('mois', -1)))
  const cmpLabel = cmp.toDate ? toDateLabel(cmp) : 'vs mois dernier'
  const monthName = periodLabel('mois').split(' ')[0]
  const color = profiles.find((p) => p.id === me.id)?.color

  // --- Moi ---
  const mine = board.filter((s) => isSellerOf(s, me.id))
  const cur = summarize(mine.filter((s) => inPeriod(s, month)), me.id)
  const myFull = sales.filter((s) => isSellerOf(s, me.id))
  const commission = commissionSum(myFull.filter((s) => inPeriod(s, month)), me.id)
  const commissionPrev = commissionSum(myFull.filter((s) => inPeriod(s, cmp)), me.id)
  const myTarget = objectiveFor(profiles.find((p) => p.id === me.id)?.monthly_ca_target ?? 0, 'mois')

  // --- Agence ---
  const monthRows = board.filter((s) => inPeriod(s, month))
  const agency = summarize(monthRows)
  const agencyPrev = summarize(board.filter((s) => inPeriod(s, cmp)))
  const agencyTarget = rankable.reduce((sum, p) => sum + (p.monthly_ca_target || 0), 0)
  const ranked = rankSellers(monthRows, rankable, 'mois').filter((r) => r.ca > 0 || r.objectif)
  const myRank = ranked.findIndex((r) => r.id === me.id)

  // Qui décroche : vendeurs avec objectif, en retard sur le rythme, du plus
  // gros retard au plus petit (3 au plus).
  const late = ranked
    .filter((r) => r.objectif)
    .map((r) => ({ r, pace: paceOf(r.ca, r.objectif!, month) }))
    .filter((x) => x.pace.ecart < 0)
    .sort((a, b) => a.pace.ecart - b.pace.ecart)
    .slice(0, 3)
  const withTargets = ranked.some((r) => r.objectif)

  const todo = sales.filter((s) => s.status === 'active' && !isComplete(s) && (canEditAll || isSellerOf(s, me.id)))

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
        <button
          type="button"
          className="numbers-add"
          onClick={() => openSaleFlow({ kind: 'new' })}
          aria-label="Nouvelle vente"
          title="Nouvelle vente"
        >
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
          <MoneyHero
            eyebrow={`Agence · ${monthName}`}
            value={agency.ca}
            delta={<EuroDelta value={agency.ca - agencyPrev.ca} label={cmpLabel} />}
            mark={<OrgLogo size={56} />}
            ribbon={[
              { value: formatCount(agency.ventes), label: `vente${agency.ventes > 1 ? 's' : ''}` },
              { value: formatCount(agency.toitures), label: `toiture${agency.toitures > 1 ? 's' : ''}` },
              { value: String(todo.length), label: 'à compléter' },
            ]}
          />
          {agencyTarget > 0 && (
            <GoalCard title="Objectif de l’agence" ca={agency.ca} target={agencyTarget} bounds={month} unit="du mois" />
          )}

          <section className="home-section">
            <p className="eyebrow section-title">
              <TrendingDown size={12} strokeWidth={2} /> Qui décroche
            </p>
            {late.length > 0 ? (
              <div className="card card-flush">
                <SellerBars
                  meId={me.id}
                  onOpen={openSeller}
                  rows={late.map(({ r, pace }) => {
                    const p = profiles.find((x) => x.id === r.id)
                    return {
                      id: r.id,
                      name: p?.full_name ?? 'Commercial',
                      color: p?.color ?? null,
                      ca: r.ca,
                      ventes: r.ventes,
                      avancement: r.avancement,
                      ecart: pace.ecart,
                    }
                  })}
                />
              </div>
            ) : (
              <p className="screen-empty">
                {withTargets
                  ? 'Toute l’équipe est dans le rythme de son objectif.'
                  : 'Fixez des objectifs de CA (Réglages, Équipe) pour suivre le rythme de chacun.'}
              </p>
            )}
          </section>

          {(cur.ca > 0 || myTarget) && (
            <div className="card mine-line">
              <span className="mine-label">Mes ventes · {monthName}</span>
              <span className="mine-figures">
                <Money value={cur.ca} /> <span className="mine-sep">·</span> commission <Money value={commission} />
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <MoneyHero
            eyebrow={`Ma commission · ${monthName}`}
            value={commission}
            unit="€"
            delta={<EuroDelta value={commission - commissionPrev} label={cmpLabel} />}
            ribbon={[
              { value: <Money value={cur.ca} compact />, label: 'CA HT' },
              { value: formatCount(cur.ventes), label: `vente${cur.ventes > 1 ? 's' : ''}` },
              {
                value: myRank >= 0 ? `${myRank + 1}${myRank === 0 ? 'ᵉʳ' : 'ᵉ'}` : '…',
                label: `sur ${ranked.length}`,
              },
            ]}
          />
          {myTarget != null && <GoalCard title="Mon objectif du mois" ca={cur.ca} target={myTarget} bounds={month} unit="du mois" />}
          {myRank >= 0 && ranked.length > 1 && (
            <p className="rank-hint">
              {myRank === 0 ? (
                <>
                  En tête, <Money value={ranked[0].ca - ranked[1].ca} /> devant {nameOf(ranked[1].id).split(/\s/)[0]}
                </>
              ) : (
                <>
                  <Money value={ranked[myRank - 1].ca - ranked[myRank].ca} /> derrière {nameOf(ranked[myRank - 1].id).split(/\s/)[0]}
                </>
              )}
            </p>
          )}
        </>
      )}

      {!loading && todo.length > 0 && (
        <section className="home-section">
          <p className="eyebrow section-title warn">
            <CircleAlert size={12} strokeWidth={2} /> À compléter · {todo.length}
          </p>
          {todo.map((s) => (
            <SaleRow
              key={s.id}
              sale={s}
              profiles={profiles}
              nameOf={nameOf}
              forProfile={me.id}
              onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })}
            />
          ))}
        </section>
      )}

      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  )
}
