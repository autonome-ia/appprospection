import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isSecretaireRole, type Profile } from '../domain/types'
import type { BoardSale, Prestation, Sale, SaleOrigin, SalePayment } from '../domain/sales'

/**
 * Accès aux données Numbers (db/0031). Les droits VRAIS sont en base (RLS,
 * triggers) : ici on lit ce que la base veut bien rendre.
 *   - `sales`       : lignes complètes (mes ventes ; toutes pour un superviseur)
 *   - `sales_board` : tableau de l'agence, sans client ni taux (toute l'équipe)
 */

const SALE_COLS =
  'id, organization_id, sold_on, client_name, address, note, origin, prestation, amount_ht, payment, financed_ht, seller1_id, seller2_id, rate1, rate2, status, cancelled_at, point_id, event_id, appointment_id, created_by, created_at, updated_at'
const BOARD_COLS =
  'id, sold_on, prestation, amount_ht, payment, financed_ht, seller1_id, seller2_id, status, created_at'

// PostgREST rend les numeric en texte selon la config : on normalise.
const num = (v: unknown): number | null => (v == null ? null : Number(v))
function normalize<T extends BoardSale>(r: Record<string, unknown>): T {
  return {
    ...r,
    amount_ht: num(r.amount_ht),
    financed_ht: num(r.financed_ht),
    ...('rate1' in r ? { rate1: num(r.rate1), rate2: num(r.rate2) } : {}),
  } as unknown as T
}

// ---------------------------------------------------------------------------
// Accès à l'option
// ---------------------------------------------------------------------------

/** Cache par agence : l'option change rarement (SQL support). */
const enabledCache = new Map<string, Promise<boolean>>()

export function fetchNumbersEnabled(orgId: string): Promise<boolean> {
  if (!supabase) return Promise.resolve(false)
  let p = enabledCache.get(orgId)
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase!
        .from('organizations')
        .select('numbers_enabled')
        .eq('id', orgId)
        .maybeSingle()
      // Colonne absente (0031 pas encore passée) ou réseau : pas de Numbers,
      // l'app se comporte exactement comme avant.
      if (error || !data) {
        enabledCache.delete(orgId)
        return false
      }
      return Boolean((data as { numbers_enabled?: boolean }).numbers_enabled)
    })()
    enabledCache.set(orgId, p)
  }
  return p
}

/** Numbers visible pour ce profil : option de l'agence ET pas secrétaire. */
export function useNumbersAccess(profile: Profile | null): boolean {
  const [on, setOn] = useState(false)
  const org = profile?.organization_id
  const secretaire = isSecretaireRole(profile?.role)
  useEffect(() => {
    if (!org || secretaire) {
      setOn(false)
      return
    }
    let alive = true
    const check = () => void fetchNumbersEnabled(org).then((v) => alive && setOn(v))
    check()
    // Échec réseau au lancement : le cache est vidé (fetchNumbersEnabled), on
    // retente à chaque retour au premier plan au lieu de masquer le switch
    // pour toute la session (cas d'un manager de Brest, 26/09).
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [org, secretaire])
  return on
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface Bounds {
  start: string
  end: string
}

async function fetchPaged<T extends BoardSale>(table: 'sales' | 'sales_board', cols: string, b?: Bounds): Promise<T[]> {
  if (!supabase) return []
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(cols)
    if (b) q = q.gte('sold_on', b.start).lt('sold_on', b.end)
    const { data, error } = await q
      .order('sold_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Record<string, unknown>[]
    out.push(...rows.map((r) => normalize<T>(r)))
    if (rows.length < PAGE) break
  }
  return out
}

/** Ventes complètes lisibles (les miennes ; toutes pour un superviseur). */
export const fetchSales = (b?: Bounds) => fetchPaged<Sale>('sales', SALE_COLS, b)

/** Tableau de l'agence (toute l'équipe Numbers). */
export const fetchBoard = (b?: Bounds) => fetchPaged<BoardSale>('sales_board', BOARD_COLS, b)

export async function fetchSale(id: string): Promise<Sale | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('sales').select(SALE_COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? normalize<Sale>(data as unknown as Record<string, unknown>) : null
}

export type RateTable = Partial<Record<Prestation, number>>

/** Taux par défaut de l'agence. */
export async function fetchAgencyRates(): Promise<RateTable> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('commission_rates').select('prestation, rate')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.prestation, Number(r.rate)]))
}

/** Surcharges lisibles (les miennes ; toutes pour un superviseur), par profil. */
export async function fetchProfileRates(): Promise<Record<string, RateTable>> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('profile_commission_rates').select('profile_id, prestation, rate')
  if (error) throw error
  const out: Record<string, RateTable> = {}
  for (const r of data ?? []) (out[r.profile_id] ??= {})[r.prestation as Prestation] = Number(r.rate)
  return out
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface SaleInput {
  sold_on: string
  client_name: string | null
  address: string | null
  note: string | null
  origin: SaleOrigin | null
  prestation: Prestation | null
  amount_ht: number | null
  payment: SalePayment | null
  financed_ht: number | null
  seller1_id: string
  seller2_id: string | null
}

/** Nouvelle vente saisie dans Numbers (« + Vente »). */
export async function createSale(orgId: string, input: SaleInput): Promise<Sale> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase
    .from('sales')
    .insert({ ...input, organization_id: orgId })
    .select(SALE_COLS)
    .single()
  if (error) throw error
  return normalize<Sale>(data as unknown as Record<string, unknown>)
}

/** .select() : la RLS filtre 0 ligne SANS erreur (vente d'un autre, droit
    retiré) — on le remonte au lieu d'un faux succès. */
export async function updateSale(id: string, patch: Partial<SaleInput> & { status?: 'active' | 'annulee' }): Promise<Sale> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase.from('sales').update(patch).eq('id', id).select(SALE_COLS)
  if (error) throw error
  if (!data?.length) throw new Error('Modification refusée')
  return normalize<Sale>(data[0] as unknown as Record<string, unknown>)
}

/** Annulation (D16) : la base bascule point, journal et RDV liés. */
export const cancelSale = (id: string) => updateSale(id, { status: 'annulee' })
/** Réactivation : manager seul (trigger). */
export const reactivateSale = (id: string) => updateSale(id, { status: 'active' })

export async function deleteSale(id: string): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase.from('sales').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Suppression refusée')
}

/** Juste après un « Vendu » : crée (ou retrouve) la vente « à compléter »
    liée au point et au RDV. null si l'option n'est pas active. */
export async function ensureVenduSale(pointId: string, appointmentId?: string | null): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('ensure_vendu_sale', {
    p_point: pointId,
    p_appointment: appointmentId ?? null,
  })
  if (error) throw error
  return (data as string | null) ?? null
}

// ---------------------------------------------------------------------------
// Réglages du manager (écran Équipe)
// ---------------------------------------------------------------------------

export async function setAgencyRate(orgId: string, prestation: Prestation, rate: number): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { error } = await supabase
    .from('commission_rates')
    .upsert({ organization_id: orgId, prestation, rate })
  if (error) throw error
}

/** rate null = retour au taux de l'agence. */
export async function setProfileRate(orgId: string, profileId: string, prestation: Prestation, rate: number | null): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { error } =
    rate == null
      ? await supabase.from('profile_commission_rates').delete().eq('profile_id', profileId).eq('prestation', prestation)
      : await supabase
          .from('profile_commission_rates')
          .upsert({ organization_id: orgId, profile_id: profileId, prestation, rate })
  if (error) throw error
}

async function patchProfile(id: string, patch: Record<string, unknown>): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Modification refusée')
}

export const setMonthlyCaTarget = (id: string, target: number) => patchProfile(id, { monthly_ca_target: target })
export const setCanEditSales = (id: string, on: boolean) => patchProfile(id, { can_edit_sales: on })

// ---------------------------------------------------------------------------
// Temps réel : une correction du manager se voit tout de suite (exigence
// Alexis). La vue n'émet rien : on écoute la table et on recharge.
// ---------------------------------------------------------------------------

let salesChannelSeq = 0

/**
 * Signal « les ventes ont changé » de TOUTE l'agence (db/0032) : canal
 * privé `numbers:<agence>`, diffusé par la base à chaque écriture sur
 * `sales`, sans aucune donnée. Il couvre les ventes des collègues, que
 * postgres_changes ne transmet pas (RLS). Sans la migration : aucun message,
 * l'abonnement à la table et le retour au premier plan prennent le relais.
 */
export function subscribeAgencySales(orgId: string, reload: () => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`numbers:${orgId}`, { config: { private: true } })
    .on('broadcast', { event: 'sales_changed' }, () => reload())
    .subscribe()
  return () => {
    supabase?.removeChannel(channel)
  }
}

export function subscribeSales(reload: () => void, onStatus?: (status: string) => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`sales-changes-${++salesChannelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => reload())
    .subscribe((status) => onStatus?.(status))
  return () => {
    supabase?.removeChannel(channel)
  }
}
