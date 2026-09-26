import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SaleSheet, type SaleSheetMode } from './SaleSheet'
import { fetchOrgProfiles, type OrgProfile } from '../../data/profiles'
import {
  ensureVenduSale,
  fetchAgencyRates,
  fetchProfileRates,
  fetchSale,
  fetchSales,
  type RateTable,
} from '../../data/sales'
import { openSaleFlow } from '../../lib/sale-flow'
import { SALE_FLOW_EVENT, type SaleFlowRequest } from '../../lib/sale-flow'
import type { Sale } from '../../domain/sales'
import type { Profile } from '../../domain/types'

/** La célébration « Vendu » (1,5 s) passe d'abord : la sheet s'ouvre après. */
const AFTER_CELEBRATION_MS = 1100

/**
 * Hôte unique du formulaire de vente (chantier Numbers) : écoute
 * openSaleFlow() et ouvre SaleSheet, dans les DEUX espaces. Charge ses
 * propres données (équipe, taux) à chaque ouverture : il vit hors du
 * NumbersProvider, qui n'existe que dans l'espace Numbers.
 */
export function SaleFlowHost({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SaleSheetMode>('new')
  const [sale, setSale] = useState<Sale | null>(null)
  const [team, setTeam] = useState<OrgProfile[]>([])
  const [agencyRates, setAgencyRates] = useState<RateTable>({})
  const [profileRates, setProfileRates] = useState<Record<string, RateTable>>({})
  const [existing, setExisting] = useState<Sale[]>([])

  useEffect(() => {
    let alive = true
    const context = () =>
      Promise.all([fetchOrgProfiles(), fetchAgencyRates(), fetchProfileRates()]).then(([t, ar, pr]) => {
        if (alive) {
          setTeam(t)
          setAgencyRates(ar)
          setProfileRates(pr)
        }
        return t
      })

    const handle = async (req: SaleFlowRequest) => {
      try {
        if (req.kind === 'new') {
          // Les ventes lisibles servent à repérer un doublon (manque 3).
          const [, list] = await Promise.all([context(), fetchSales().catch(() => [] as Sale[])])
          if (!alive) return
          setExisting(list)
          setSale(null)
          setMode('new')
          setOpen(true)
          return
        }
        let id: string | null
        if (req.kind === 'vendu') {
          const [created] = await Promise.all([
            ensureVenduSale(req.pointId, req.appointmentId),
            new Promise((r) => window.setTimeout(r, AFTER_CELEBRATION_MS)),
          ])
          id = created
        } else {
          id = req.saleId
        }
        if (!id || !alive) return
        const [s, t] = await Promise.all([fetchSale(id), context()])
        if (!alive || !s) return
        // Vente d'un collègue soldée par un superviseur sans droit de
        // modification : elle est créée, son vendeur la complétera.
        const mine = t.find((p) => p.id === profile.id)
        const canEditAll = profile.role === 'manager' || (profile.role === 'chef_ventes' && !!mine?.can_edit_sales)
        const isSeller = s.seller1_id === profile.id || s.seller2_id === profile.id
        if (req.kind === 'vendu' && !isSeller && !canEditAll) {
          const who = t.find((p) => p.id === s.seller1_id)?.full_name ?? 'le commercial'
          toast(`Vente enregistrée : ${who} la complétera dans Numbers`)
          return
        }
        setSale(s)
        setMode(req.kind === 'vendu' ? 'vendu' : 'edit')
        setOpen(true)
      } catch (e) {
        console.error('Formulaire de vente :', e)
        if (req.kind === 'vendu') {
          toast.error('Vente non enregistrée dans Numbers : ajoute-la avec « + Vente »')
        } else {
          toast.error('Vente impossible à ouvrir : vérifie le réseau')
        }
      }
    }

    const onEvent = (e: Event) => void handle((e as CustomEvent<SaleFlowRequest>).detail)
    window.addEventListener(SALE_FLOW_EVENT, onEvent)
    return () => {
      alive = false
      window.removeEventListener(SALE_FLOW_EVENT, onEvent)
    }
  }, [profile.id, profile.role])

  const me = team.find((p) => p.id === profile.id)
  const canEditAll = profile.role === 'manager' || (profile.role === 'chef_ventes' && !!me?.can_edit_sales)

  return (
    <SaleSheet
      open={open}
      onOpenChange={setOpen}
      mode={mode}
      sale={sale}
      me={profile}
      team={team.filter((p) => !p.is_support || p.id === profile.id)}
      canEditAll={canEditAll}
      agencyRates={agencyRates}
      profileRates={profileRates}
      existing={mode === 'new' ? existing : undefined}
      onOpenExisting={(id) => openSaleFlow({ kind: 'open', saleId: id })}
    />
  )
}
