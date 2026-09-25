import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import type { OrgProfile } from '../../data/profiles'
import {
  formatEuros,
  isComplete,
  originLabel,
  paymentLabel,
  prestationLabel,
  type BoardSale,
  type Sale,
} from '../../domain/sales'

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
/** « 12 sept. » depuis « 2026-09-12 » (jour local, jamais d'UTC). */
export const shortDay = (d: string) => DAY.format(new Date(`${d}T12:00:00`))

/** Pastilles des vendeurs (couleur = commercial, comme dans l'agenda). */
export function Sellers({ sale, profiles }: { sale: BoardSale; profiles: OrgProfile[] }) {
  const ids = [sale.seller1_id, sale.seller2_id].filter(Boolean) as string[]
  return (
    <span className="sale-sellers">
      {ids.map((id) => {
        const p = profiles.find((x) => x.id === id)
        return <Avatar key={id} id={id} name={p?.full_name} color={p?.color} size={20} />
      })}
    </span>
  )
}

export const sellersLabel = (sale: BoardSale, nameOf: (id: string) => string) =>
  [sale.seller1_id, sale.seller2_id]
    .filter(Boolean)
    .map((id) => nameOf(id!).split(/\s/)[0])
    .join(' et ')

/**
 * Une vente en ligne (cahier, accueil) : prestation et client à gauche,
 * montant à droite, le reste en méta. « À compléter » et « Annulée » se
 * disent en toutes lettres (pas seulement en couleur).
 */
export function SaleRow({
  sale,
  profiles,
  nameOf,
  onOpen,
}: {
  sale: Sale | BoardSale
  profiles: OrgProfile[]
  nameOf: (id: string) => string
  onOpen?: () => void
}) {
  const full = 'client_name' in sale ? sale : null
  const cancelled = sale.status === 'annulee'
  const todo = !cancelled && !isComplete(sale)
  const title = full?.client_name || full?.address || prestationLabel(sale.prestation) || 'Vente'
  // 2e ligne du cahier : l'adresse (si le client est en titre) et l'origine.
  const meta2 = full
    ? [full.client_name ? full.address : null, originLabel(full.origin)].filter(Boolean).join(' · ')
    : ''
  const body = (
    <>
      <Sellers sale={sale} profiles={profiles} />
      <span className="sale-row-main">
        <span className="sale-row-title">
          {title}
          {todo && <span className="sale-tag is-todo">À compléter</span>}
          {cancelled && <span className="sale-tag is-cancelled">Annulée</span>}
        </span>
        <span className="sale-row-meta">
          <span className="tnum">{shortDay(sale.sold_on)}</span>
          {full && sale.prestation ? ` · ${prestationLabel(sale.prestation)}` : ''}
          {sale.payment ? ` · ${paymentLabel(sale.payment)}` : ''}
          {` · ${sellersLabel(sale, nameOf)}`}
        </span>
        {meta2 && <span className="sale-row-meta">{meta2}</span>}
        {full?.note && <span className="sale-row-note">{full.note}</span>}
      </span>
      <span className={`sale-row-amount tnum ${cancelled ? 'is-cancelled' : ''}`}>
        {sale.amount_ht == null ? '…' : formatEuros(sale.amount_ht)}
      </span>
      {onOpen && <ChevronRight size={15} strokeWidth={1.9} className="rank-chevron" />}
    </>
  )
  return onOpen ? (
    <button type="button" className="sale-row is-clickable" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="sale-row">{body}</div>
  )
}

/** Écart en euros avec la période précédente, même code visuel que les
    deltas des Stats de prospection. */
export function EuroDelta({ value, label }: { value: number; label: string }) {
  const v = Math.round(value)
  if (v === 0) return <span className="hero-delta flat">Stable {label}</span>
  const up = v > 0
  return (
    <span className={`hero-delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUp size={13} strokeWidth={2.4} /> : <ArrowDown size={13} strokeWidth={2.4} />}
      <span className="tnum">
        {up ? '+' : '−'}
        {formatEuros(Math.abs(v))}
      </span>{' '}
      {label}
    </span>
  )
}
