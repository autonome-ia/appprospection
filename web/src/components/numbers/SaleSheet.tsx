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
  commissionOf,
  formatEuros,
  missingFields,
  prestationLabel,
  type Prestation,
  type Sale,
  type SaleOrigin,
  type SalePayment,
} from '../../domain/sales'
import type { Profile } from '../../domain/types'
import { shortDay } from './SaleRow'
import { Money, Pct } from './Money'

/** Montant en euros ENTIERS (audit 26/09 : « 7,200 » était lu 7,20 €) :
    seuls les chiffres comptent — pas de centimes sur un devis de toiture. */
function parseAmount(raw: string): number | null {
  const t = raw.replace(/\D/g, '')
  return t ? Number(t) : null
}
/** Affichage pendant la frappe : « 18 450 » (espaces fines de fr-FR). */
const typing = (raw: string) => {
  const n = parseAmount(raw)
  return n == null ? '' : n.toLocaleString('fr-FR')
}
/** Montant hors des ordres de grandeur d'un chantier : on fait confirmer. */
const isOdd = (n: number | null) => n != null && n > 0 && (n < 300 || n > 200000)

/** Clé de comparaison : minuscules, sans accents ni ponctuation. */
const normKey = (v: string | null | undefined) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const showAmount = (n: number | null | undefined) => (n == null ? '' : Math.round(n).toLocaleString('fr-FR'))

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
  existing,
  onOpenExisting,
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
  /** « + Vente » : ventes déjà lisibles, pour repérer un doublon (une maison
      vendue depuis la carte a déjà sa vente, « à compléter »). */
  existing?: Sale[]
  onOpenExisting?: (id: string) => void
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
  const [oddOk, setOddOk] = useState(false)

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
    setOddOk(false)
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

  // Doublon (manque 3) : même adresse, ou même client, qu'une vente active.
  const duplicate = useMemo(() => {
    if (mode !== 'new' || !existing?.length) return null
    const a = normKey(address)
    const c = normKey(client)
    if (a.length < 6 && c.length < 4) return null
    return (
      existing.find(
        (s) =>
          s.status === 'active' &&
          ((a.length >= 6 && normKey(s.address) === a) || (c.length >= 4 && normKey(s.client_name) === c)),
      ) ?? null
    )
  }, [mode, existing, address, client])

  // Ce qui manquera encore si on enregistre maintenant (libellé du bouton).
  const missingNow = [
    amountN == null && 'montant',
    !prestation && 'prestation',
    !payment && 'paiement',
    payment === 'financement' && financedN == null && 'montant financé',
    !origin && 'origine',
  ].filter((x): x is string => Boolean(x))

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
    if (isOdd(amountN) && !oddOk) {
      setOddOk(true) // 1er tap : le bouton demande confirmation du montant
      return
    }
    setSaving(true)
    try {
      const saved = sale ? await updateSale(sale.id, input()) : await createSale(me.organization_id, input())
      const missing = missingFields(saved)
      const gain = commissionOf(saved, me.id)
      if (missing.length) toast(`Vente enregistrée, à compléter : ${missing.join(', ')}`)
      else if (gain > 0) toast.success(`Vente enregistrée : +${formatEuros(gain)} de commission`)
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
              inputMode="numeric"
              enterKeyHint="done"
              placeholder="0"
              autoFocus={mode !== 'edit'}
              value={amount}
              onChange={(e) => {
                setAmount(typing(e.target.value))
                setOddOk(false)
              }}
              aria-label="Montant HT en euros"
            />
            <span className="sale-amount-unit">€ HT</span>
          </span>
        </label>

        {/* Ce que la vente rapporte à celui qui saisit, en direct, SOUS le
            montant (audit commercial : c'était sous le pli). */}
        {!cancelled && myShare > 0 && (
          <div className="sale-commission">
            <span>Ma commission</span>
            {myRate != null && amountN != null && amountN > 0 ? (
              <>
                <Money value={amountN * myShare * myRate} className="sale-commission-value" />
                <span className="sale-commission-meta">
                  <Pct value={myRate} />
                  {myShare < 1 ? ' sur ma moitié du montant' : ' du montant HT'}
                </span>
              </>
            ) : (
              <span className="sale-commission-meta is-hint">
                {amountN ? 'Choisissez la prestation pour la calculer.' : 'Saisissez le montant pour la calculer.'}
              </span>
            )}
          </div>
        )}

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
              {p.value === 'traitement_bois' ? 'Traitement bois' : p.label}
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
        <Segmented options={PAYMENTS} value={payment ?? ('' as SalePayment)} onChange={setPayment} />
        {payment === 'financement' && (
          <FormGroup
            hint={
              financedTooBig ? (
                <span className="field-error">Le montant financé dépasse le montant de la vente.</span>
              ) : amountN ? (
                <button type="button" className="text-btn" onClick={() => setFinanced(showAmount(amountN))}>
                  Tout financé
                </button>
              ) : undefined
            }
          >
            <FormRow label="Montant financé">
              <input
                className="form-input tnum"
                inputMode="numeric"
                placeholder="€ HT"
                value={financed}
                onChange={(e) => setFinanced(typing(e.target.value))}
              />
            </FormRow>
          </FormGroup>
        )}

        <p className="eyebrow form-section-title form-section-title-solo">Origine</p>
        <Segmented options={ORIGINS} value={origin ?? ('' as SaleOrigin)} onChange={setOrigin} />

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

        {duplicate && (
          <div className="sale-dup" role="status">
            <p>
              Une vente existe déjà pour {normKey(duplicate.address) === normKey(address) ? 'cette adresse' : 'ce client'} :{' '}
              {[prestationLabel(duplicate.prestation), shortDay(duplicate.sold_on), missingFields(duplicate).length ? 'à compléter' : null]
                .filter(Boolean)
                .join(' · ')}
              .
            </p>
            <button type="button" className="text-btn" onClick={() => onOpenExisting?.(duplicate.id)}>
              Ouvrir cette vente
            </button>
          </div>
        )}

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

      {sale && (canEdit || me.role === 'manager') && (
        <div className="sale-manage">
          {canEdit && !cancelled && (
            <button type="button" className="text-btn is-danger" disabled={saving} onClick={() => void cancelOrDelete('cancel')}>
              {confirm === 'cancel' ? 'Confirmer : la maison repasse en « Refus »' : 'Annuler la vente'}
            </button>
          )}
          {cancelled && me.role === 'manager' && (
            <button type="button" className="text-btn" disabled={saving} onClick={() => void reactivate()}>
              Réactiver la vente
            </button>
          )}
          {me.role === 'manager' && (
            <button type="button" className="text-btn is-danger" disabled={saving} onClick={() => void cancelOrDelete('delete')}>
              {confirm === 'delete' ? 'Confirmer la suppression définitive' : 'Supprimer la vente'}
            </button>
          )}
        </div>
      )}

      {!readOnly && missingNow.length > 0 && (
        <p className="sale-missing">
          Il manque : {missingNow.join(', ')}. Vous pouvez enregistrer et compléter plus tard.
        </p>
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
            {saving
              ? 'Enregistrement…'
              : isOdd(amountN) && oddOk
                ? `Confirmer ${showAmount(amountN)} € HT`
                : 'Enregistrer'}
          </button>
        </div>
      )}
    </Sheet>
  )
}
