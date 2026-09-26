import { ArrowDown, ArrowUp } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import type { OrgProfile } from '../../data/profiles'
import {
  formatEuros,
  isComplete,
  originLabel,
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
 * Une vente en carte (cahier, accueil — refonte 26/09, « cahier pas assez
 * lisible ») : le client et le montant en tête, la prestation et le
 * paiement en dessous, puis l'adresse et l'origine, les vendeurs en pied,
 * la note à part. « À compléter » et « Annulée » en toutes lettres.
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
  const place = full ? [full.client_name ? full.address : null, originLabel(full.origin)].filter(Boolean).join(' · ') : ''
  const pay =
    sale.payment === 'financement'
      ? `Financé${sale.financed_ht != null ? ` ${formatEuros(sale.financed_ht)}` : ''}`
      : sale.payment === 'comptant'
        ? 'Comptant'
        : null
  const body = (
    <>
      <span className="sale-card-top">
        <span className="sale-card-title">{title}</span>
        <span className={`sale-card-amount tnum ${cancelled ? 'is-cancelled' : ''}`}>
          {sale.amount_ht == null ? 'Sans montant' : formatEuros(sale.amount_ht)}
        </span>
      </span>
      <span className="sale-card-line">
        {sale.prestation && (
          <span className="sale-prest">
            <i className="legend-dot" style={{ background: `var(--pr-${sale.prestation})` }} />
            {prestationLabel(sale.prestation)}
          </span>
        )}
        {pay && <span className="sale-card-pay">{pay}</span>}
        {todo && <span className="sale-tag is-todo">À compléter</span>}
        {cancelled && <span className="sale-tag is-cancelled">Annulée</span>}
      </span>
      {place && <span className="sale-card-place">{place}</span>}
      {full?.note && <span className="sale-card-note">{full.note}</span>}
      <span className="sale-card-foot">
        <Sellers sale={sale} profiles={profiles} />
        <span className="sale-card-sellers">{sellersLabel(sale, nameOf)}</span>
        <span className="sale-card-date tnum">{shortDay(sale.sold_on)}</span>
      </span>
    </>
  )
  return onOpen ? (
    <button type="button" className="sale-card is-clickable" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="sale-card">{body}</div>
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
