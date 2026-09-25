import { useState, type ReactNode } from 'react'
import { CircleAlert, Plus, ReceiptText, Settings } from 'lucide-react'
import { Avatar, OrgLogo } from '../ui/Avatar'
import { Num } from '../ui/Num'
import { ProfileSheet } from '../ProfileSheet'
import { useNumbers } from './NumbersData'
import { EuroDelta, SaleRow } from './SaleRow'
import { openSaleFlow } from '../../lib/sale-flow'
import type { Tab } from '../BottomNav'
import {
  commissionSum,
  formatCount,
  formatEuros,
  inPeriod,
  isComplete,
  isSellerOf,
  objectiveFor,
  periodBounds,
  periodLabel,
  shiftPeriod,
  summarize,
} from '../../domain/sales'

const TODAY_LABEL = () => {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Jauge d'objectif de CA, même dessin que l'objectif hebdo de RDV. */
function Objective({ title, done, target }: { title: string; done: number; target: number }) {
  const pct = Math.min(100, (done / target) * 100)
  return (
    <div className="card obj-card">
      <div className="obj-head">
        <span className="eyebrow">{title}</span>
        <span className="obj-big tnum">
          {formatEuros(done)} / {formatEuros(target)}
        </span>
      </div>
      <div className="obj-bar-bg">
        <div className={`obj-bar ${done >= target ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * Accueil de Numbers (plan §4.3) : même en-tête que l'Accueil prospection,
 * le switch, puis MON mois (CA, commission, objectif), les ventes à
 * compléter et mes dernières ventes. Superviseur : l'agence en plus.
 */
export function NumbersHome({ spaceSwitch, onGoTo }: { spaceSwitch: ReactNode; onGoTo: (t: Tab) => void }) {
  const { me, isSupervisor, canEditAll, profiles, sales, board, rankable, loading, error, reload, nameOf } = useNumbers()
  const [profileOpen, setProfileOpen] = useState(false)

  const month = periodBounds('mois')
  const prevMonth = periodBounds('mois', shiftPeriod('mois', -1))
  const monthName = periodLabel('mois').split(' ')[0]
  const mineAll = board.filter((s) => isSellerOf(s, me.id))
  const cur = summarize(mineAll.filter((s) => inPeriod(s, month)), me.id)
  const prev = summarize(mineAll.filter((s) => inPeriod(s, prevMonth)), me.id)
  const myFull = sales.filter((s) => isSellerOf(s, me.id))
  const commission = commissionSum(myFull.filter((s) => inPeriod(s, month)), me.id)
  const myTarget = profiles.find((p) => p.id === me.id)?.monthly_ca_target ?? 0
  const myObjective = objectiveFor(myTarget, 'mois')

  const agency = summarize(board.filter((s) => inPeriod(s, month)))
  const agencyTarget = rankable.reduce((sum, p) => sum + (p.monthly_ca_target || 0), 0)

  // À compléter : les miennes ; toutes pour qui peut modifier toutes les ventes.
  const todo = sales.filter((s) => s.status === 'active' && !isComplete(s) && (canEditAll || isSellerOf(s, me.id)))
  const recent = myFull.filter((s) => s.status === 'active' && isComplete(s)).slice(0, 5)
  const color = profiles.find((p) => p.id === me.id)?.color

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
        <button type="button" className="icon-btn accueil-settings" onClick={() => setProfileOpen(true)} aria-label="Réglages">
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
      ) : (
        <>
          <section className="card stats-hero">
            <div className="hero-top">
              <div className="hero-main">
                <p className="eyebrow">Mon CA · {monthName}</p>
                <div className="hero-line">
                  <span className="hero-value tnum">
                    <Num value={Math.round(cur.ca)} />
                  </span>
                  <span className="hero-unit">€ HT</span>
                </div>
                <EuroDelta value={cur.ca - prev.ca} label="vs mois dernier" />
              </div>
              <div className="hero-mark">
                <Avatar id={me.id} name={me.full_name} color={color} size={72} />
              </div>
            </div>
            <div className="hero-ribbon">
              <div className="ribbon-stat">
                <span className="ribbon-value tnum">{formatEuros(commission)}</span>
                <span className="ribbon-label">commission</span>
              </div>
              <div className="ribbon-stat">
                <span className="ribbon-value tnum">{formatCount(cur.ventes)}</span>
                <span className="ribbon-label">vente{cur.ventes > 1 ? 's' : ''}</span>
              </div>
              <div className="ribbon-stat">
                <span className="ribbon-value tnum">{formatCount(cur.toitures)}</span>
                <span className="ribbon-label">toiture{cur.toitures > 1 ? 's' : ''}</span>
              </div>
            </div>
          </section>

          {myObjective != null && <Objective title="Mon objectif du mois" done={cur.ca} target={myObjective} />}

          {isSupervisor && (
            <section className="card stats-hero">
              <div className="hero-top">
                <div className="hero-main">
                  <p className="eyebrow">Agence · {monthName}</p>
                  <div className="hero-line">
                    <span className="hero-value tnum">
                      <Num value={Math.round(agency.ca)} />
                    </span>
                    <span className="hero-unit">€ HT</span>
                  </div>
                </div>
                <div className="hero-mark">
                  <OrgLogo size={72} />
                </div>
              </div>
              <div className="hero-ribbon">
                <div className="ribbon-stat">
                  <span className="ribbon-value tnum">{formatCount(agency.ventes)}</span>
                  <span className="ribbon-label">ventes</span>
                </div>
                <div className="ribbon-stat">
                  <span className="ribbon-value tnum">{formatCount(agency.toitures)}</span>
                  <span className="ribbon-label">toitures</span>
                </div>
                <div className="ribbon-stat">
                  <span className="ribbon-value tnum">
                    {agencyTarget > 0 ? `${Math.round((agency.ca / agencyTarget) * 100)} %` : '…'}
                  </span>
                  <span className="ribbon-label">de l’objectif</span>
                </div>
              </div>
            </section>
          )}

          {todo.length > 0 && (
            <section className="home-section">
              <p className="eyebrow section-title warn">
                <CircleAlert size={12} strokeWidth={2} /> À compléter · {todo.length}
              </p>
              {todo.map((s) => (
                <SaleRow key={s.id} sale={s} profiles={profiles} nameOf={nameOf} onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })} />
              ))}
            </section>
          )}

          <section className="home-section">
            <p className="eyebrow section-title">
              <ReceiptText size={12} strokeWidth={2} /> Mes dernières ventes
            </p>
            {recent.length === 0 ? (
              <p className="screen-empty">Aucune vente enregistrée pour l’instant.</p>
            ) : (
              recent.map((s) => (
                <SaleRow key={s.id} sale={s} profiles={profiles} nameOf={nameOf} onOpen={() => openSaleFlow({ kind: 'open', saleId: s.id })} />
              ))
            )}
            <div className="numbers-home-actions">
              <button type="button" className="btn btn-ghost" onClick={() => onGoTo('ventes')}>
                Tout le cahier
              </button>
              <button type="button" className="btn btn-primary" onClick={() => openSaleFlow({ kind: 'new' })}>
                <Plus size={16} strokeWidth={2.2} /> Vente
              </button>
            </div>
          </section>
        </>
      )}

      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  )
}
