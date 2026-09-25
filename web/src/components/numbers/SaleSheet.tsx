import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '../ui/Sheet'
import { FormGroup, FormRow } from '../ui/Form'
import { Segmented } from '../ui/Segmented'
import type { OrgProfile } from '../../data/profiles'
import {
  cancelSale,
  createSale,
  deleteSale,
  reactivateSale,
  updateSale,
  type RateTable,
  type SaleInput,
} from '../../data/sales'
import {
  ORIGINS,
  PAYMENTS,
  PRESTATIONS,
  dayKey,
  formatEuros,
  formatRate,
  missingFields,
  type Prestation,
  type Sale,
  type SaleOrigin,
  type SalePayment,
} from '../../domain/sales'
import type { Profile } from '../../domain/types'

/** Montant saisi à la française (« 12 450,50 ») → nombre, null si vide. */
function parseAmount(raw: string): number | null {
  const t = raw.replace(/[\s  €]/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
const showAmount = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export type SaleSheetMode = 'vendu' | 'edit' | 'new'

/**
 * Formulaire de vente (chantier Numbers, plan §4.2). Trois usages :
 *  - « vendu » : juste après un « Vendu » — la vente « à compléter » existe
 *    déjà en base, fermer la sheet ne perd rien (D11) ;
 *  - « edit »  : une vente du cahier (droits selon la base : ses vendeurs,
 *    le manager, le chef des ventes autorisé ; sinon lecture seule) ;
 *  - « new »   : « + Vente » (lead entrant, ancien client…).
 * L'origine n'est JAMAIS pré-remplie (D3).
 */
export function SaleSheet({
  open,
  onOpenChange,
  mode,
  sale,
  me,
  team,
  canEditAll,
  agencyRates,
  profileRates,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: SaleSheetMode
  sale: Sale | null
  me: Profile
  /** Membres actifs de l'agence (vendeurs possibles). */
  team: OrgProfile[]
  canEditAll: boolean
  agencyRates: RateTable
  profileRates: Record<string, RateTable>
  onSaved?: (sale: Sale | null) => void
}) {
  const [amount, setAmount] = useState('')
  const [prestation, setPrestation] = useState<Prestation | null>(null)
  const [duo, setDuo] = useState<'seul' | 'deux'>('seul')
  const [seller1, setSeller1] = useState(me.id)
  const [seller2, setSeller2] = useState('')
  const [payment, setPayment] = useState<SalePayment | null>(null)
  const [financed, setFinanced] = useState('')
  const [origin, setOrigin] = useState<SaleOrigin | null>(null)
  const [soldOn, setSoldOn] = useState(dayKey(new Date()))
  const [client, setClient] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)

  // Remise à zéro à chaque ouverture (ou changement de vente).
  useEffect(() => {
    if (!open) return
    setAmount(showAmount(sale?.amount_ht))
    setPrestation(sale?.prestation ?? null)
    setDuo(sale?.seller2_id ? 'deux' : 'seul')
    setSeller1(sale?.seller1_id ?? me.id)
    setSeller2(sale?.seller2_id ?? '')
    setPayment(sale?.payment ?? null)
    setFinanced(showAmount(sale?.financed_ht))
    setOrigin(sale?.origin ?? null)
    setSoldOn(sale?.sold_on ?? dayKey(new Date()))
    setClient(sale?.client_name ?? '')
    setAddress(sale?.address ?? '')
    setNote(sale?.note ?? '')
    setConfirm(null)
  }, [open, sale, me.id])

  const isSeller = !!sale && (sale.seller1_id === me.id || sale.seller2_id === me.id)
  const canEdit = mode === 'new' || canEditAll || isSeller
  const cancelled = sale?.status === 'annulee'
  const readOnly = !canEdit || cancelled
  const sellers = team.filter((p) => !p.disabled_at && p.role !== 'secretaire')
  const secondChoices = sellers.filter((p) => p.id !== seller1)

  // Aperçu de MA commission : taux figé de la vente si je la vois déjà avec
  // la même prestation, sinon le taux applicable aujourd'hui.
  const amountN = parseAmount(amount)
  const myShare = seller1 === me.id || (duo === 'deux' && seller2 === me.id) ? (duo === 'deux' ? 0.5 : 1) : 0
  const myRate = useMemo(() => {
    if (!prestation || myShare === 0) return null
    if (sale && sale.prestation === prestation) {
      const r = sale.seller1_id === me.id ? sale.rate1 : sale.seller2_id === me.id ? sale.rate2 : null
      if (r != null) return r
    }
    return profileRates[me.id]?.[prestation] ?? agencyRates[prestation] ?? null
  }, [prestation, myShare, sale, me.id, profileRates, agencyRates])

  const financedN = parseAmount(financed)
  const financedTooBig = payment === 'financement' && financedN != null && amountN != null && financedN > amountN

  function input(): SaleInput {
    return {
      sold_on: soldOn,
      client_name: client.trim() || null,
      address: address.trim() || null,
      note: note.trim() || null,
      origin,
      prestation,
      amount_ht: amountN,
      payment,
      financed_ht: payment === 'financement' ? financedN : null,
      seller1_id: seller1,
      seller2_id: duo === 'deux' && seller2 ? seller2 : null,
    }
  }

  async function save() {
    setSaving(true)
    try {
      const saved = sale ? await updateSale(sale.id, input()) : await createSale(me.organization_id, input())
      const missing = missingFields(saved)
      if (missing.length) toast(`Vente enregistrée, à compléter : ${missing.join(', ')}`)
      else toast.success('Vente enregistrée')
      onSaved?.(saved)
      onOpenChange(false)
    } catch (e) {
      console.error('Enregistrement de la vente :', e)
      toast.error('Enregistrement impossible : réseau, ou vente d’un autre commercial')
    } finally {
      setSaving(false)
    }
  }

  async function cancelOrDelete(kind: 'cancel' | 'delete') {
    if (!sale) return
    if (confirm !== kind) {
      setConfirm(kind)
      return
    }
    setSaving(true)
    try {
      if (kind === 'cancel') {
        await cancelSale(sale.id)
        toast.success('Vente annulée : la maison repasse en « Refus »')
      } else {
        await deleteSale(sale.id)
        toast.success('Vente supprimée')
      }
      onSaved?.(null)
      onOpenChange(false)
    } catch (e) {
      console.error('Annulation / suppression :', e)
      toast.error('Action impossible : réseau, ou droits insuffisants')
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  async function reactivate() {
    if (!sale) return
    setSaving(true)
    try {
      await reactivateSale(sale.id)
      toast.success('Vente réactivée')
      onSaved?.(null)
      onOpenChange(false)
    } catch (e) {
      console.error('Réactivation :', e)
      toast.error('Réactivation impossible')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'new' ? 'Nouvelle vente' : mode === 'vendu' ? 'Détails de la vente' : 'Vente'

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      meta={
        cancelled ? (
          <p className="sale-banner is-cancelled">Vente annulée : elle ne compte nulle part.</p>
        ) : !canEdit ? (
          <p className="sale-banner">Lecture seule : seul le manager peut modifier cette vente.</p>
        ) : null
      }
    >
      <fieldset className="sale-fieldset" disabled={readOnly || saving}>
        {/* Le montant d'abord, en grand : c'est LA donnée de la vente. */}
        <label className="sale-amount">
          <span className="eyebrow">Montant HT</span>
          <span className="sale-amount-field">
            <input
              className="sale-amount-input tnum"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Montant HT en euros"
            />
            <span className="sale-amount-unit">€ HT</span>
          </span>
        </label>

        <p className="eyebrow form-section-title form-section-title-solo">Prestation</p>
        <div className="sale-choice-grid">
          {PRESTATIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip ${prestation === p.value ? 'is-active' : ''}`}
              aria-pressed={prestation === p.value}
              onClick={() => setPrestation(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="eyebrow form-section-title form-section-title-solo">Vendu</p>
        <Segmented
          options={[
            { value: 'seul', label: 'Seul' },
            { value: 'deux', label: 'À deux' },
          ]}
          value={duo}
          onChange={setDuo}
        />
        {(canEditAll || duo === 'deux') && (
          <FormGroup hint={duo === 'deux' ? 'Montant partagé en deux : chacun a la moitié du CA et de la vente.' : undefined}>
            {canEditAll && (
              <FormRow label="Vendeur" select>
                <select className="form-input" value={seller1} onChange={(e) => setSeller1(e.target.value)}>
                  {sellers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? 'Sans nom'}
                    </option>
                  ))}
                </select>
              </FormRow>
            )}
            {duo === 'deux' && (
              <FormRow label="Avec" select>
                <select className="form-input" value={seller2} onChange={(e) => setSeller2(e.target.value)}>
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {secondChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? 'Sans nom'}
                    </option>
                  ))}
                </select>
              </FormRow>
            )}
          </FormGroup>
        )}

        <p className="eyebrow form-section-title form-section-title-solo">Paiement</p>
        <div className="sale-choice-row">
          {PAYMENTS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip ${payment === p.value ? 'is-active' : ''}`}
              aria-pressed={payment === p.value}
              onClick={() => setPayment(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {payment === 'financement' && (
          <FormGroup hint={financedTooBig ? 'Le montant financé dépasse le montant de la vente.' : undefined}>
            <FormRow label="Montant financé">
              <input
                className="form-input tnum"
                inputMode="decimal"
                placeholder="€ HT"
                value={financed}
                onChange={(e) => setFinanced(e.target.value)}
              />
            </FormRow>
          </FormGroup>
        )}

        <p className="eyebrow form-section-title form-section-title-solo">Origine</p>
        <div className="sale-choice-row">
          {ORIGINS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`chip ${origin === o.value ? 'is-active' : ''}`}
              aria-pressed={origin === o.value}
              onClick={() => setOrigin(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <FormGroup title="Client">
          <FormRow label="Date">
            <input className="form-input" type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} />
          </FormRow>
          <FormRow label="Nom">
            <input
              className="form-input"
              type="text"
              placeholder="Nom du client"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </FormRow>
          <FormRow label="Adresse">
            <input
              className="form-input"
              type="text"
              placeholder="Adresse"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </FormRow>
        </FormGroup>

        <FormGroup title="Note">
          <textarea
            className="form-input"
            rows={2}
            placeholder="Si besoin (facultatif)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormGroup>
      </fieldset>

      {/* Ce que la vente rapporte au vendeur qui saisit : en direct. */}
      {!cancelled && myRate != null && amountN != null && amountN > 0 && (
        <div className="sale-commission">
          <span>Ta commission</span>
          <span className="sale-commission-value tnum">{formatEuros(amountN * myShare * myRate)}</span>
          <span className="sale-commission-meta">
            <span className="tnum">{formatRate(myRate)}</span>
            {myShare < 1 ? ' sur ta moitié' : ''}
          </span>
        </div>
      )}

      {sale && canEdit && !cancelled && (
        <button type="button" className="btn btn-danger sale-cancel" disabled={saving} onClick={() => void cancelOrDelete('cancel')}>
          {confirm === 'cancel' ? 'Confirmer : la maison repasse en « Refus »' : 'Annuler la vente'}
        </button>
      )}
      {sale && cancelled && me.role === 'manager' && (
        <button type="button" className="btn btn-ghost sale-cancel" disabled={saving} onClick={() => void reactivate()}>
          Réactiver la vente
        </button>
      )}
      {sale && me.role === 'manager' && (
        <button type="button" className="text-btn sale-delete" disabled={saving} onClick={() => void cancelOrDelete('delete')}>
          {confirm === 'delete' ? 'Confirmer la suppression définitive' : 'Supprimer la vente'}
        </button>
      )}

      {!readOnly && (
        <div className="drawer-footer">
          <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
            {mode === 'vendu' ? 'Plus tard' : 'Fermer'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || financedTooBig || (duo === 'deux' && !seller2) || !soldOn}
            onClick={() => void save()}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </Sheet>
  )
}
