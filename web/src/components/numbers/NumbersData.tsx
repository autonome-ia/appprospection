import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchOrgProfiles, type OrgProfile } from '../../data/profiles'
import {
  fetchAgencyRates,
  fetchBoard,
  fetchProfileRates,
  fetchSales,
  subscribeSales,
  type RateTable,
} from '../../data/sales'
import type { BoardSale, Sale } from '../../domain/sales'
import type { Tab } from '../BottomNav'
import { isManagerHiddenFor, isSupervisorRole, type Profile } from '../../domain/types'

/**
 * Données de l'espace Numbers, chargées UNE fois pour les 4 onglets et
 * tenues à jour en temps réel (exigence Alexis : une correction du manager
 * se voit tout de suite chez le vendeur). Volumes modestes (quelques
 * centaines de ventes par an) : tout l'historique en mémoire, les écrans
 * filtrent par période.
 */
interface NumbersState {
  me: Profile
  isSupervisor: boolean
  isManager: boolean
  /** Manager, ou chef des ventes autorisé (db/0031, D8). */
  canEditAll: boolean
  profiles: OrgProfile[]
  /** Ventes COMPLÈTES lisibles : les miennes ; toutes pour un superviseur. */
  sales: Sale[]
  /** Tableau de l'agence (toute l'équipe, sans client ni taux). */
  board: BoardSale[]
  agencyRates: RateTable
  profileRates: Record<string, RateTable>
  loading: boolean
  error: boolean
  reload: () => void
  nameOf: (id: string | null | undefined) => string
  /** Vendeurs affichables au classement (mêmes règles que les Stats). */
  rankable: OrgProfile[]
  /** Détail d'un commercial dans Stats (null = agence), partagé : « Qui
      décroche » (Accueil) et le tableau Équipe y mènent directement. */
  drillId: string | null
  setDrillId: (id: string | null) => void
  /** Ouvre Stats sur le détail d'un commercial. */
  openSeller: (id: string) => void
  goTo: (tab: Tab) => void
  /** Ouvre le cahier sur « À compléter » (vue agence pour un superviseur). */
  openBookTodo: () => void
  /** Préréglage consommé par le cahier à son ouverture. */
  bookPreset: 'a_completer' | null
  clearBookPreset: () => void
}

const Ctx = createContext<NumbersState | null>(null)

export function useNumbers(): NumbersState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNumbers hors de <NumbersProvider>')
  return v
}

export function NumbersProvider({
  profile,
  onGoTo,
  children,
}: {
  profile: Profile
  onGoTo: (tab: Tab) => void
  children: ReactNode
}) {
  const [drillId, setDrillId] = useState<string | null>(null)
  const [bookPreset, setBookPreset] = useState<'a_completer' | null>(null)
  const [profiles, setProfiles] = useState<OrgProfile[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [board, setBoard] = useState<BoardSale[]>([])
  const [agencyRates, setAgencyRates] = useState<RateTable>({})
  const [profileRates, setProfileRates] = useState<Record<string, RateTable>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const [p, s, b, ar, pr] = await Promise.all([
        fetchOrgProfiles(),
        fetchSales(),
        fetchBoard(),
        fetchAgencyRates(),
        fetchProfileRates(),
      ])
      if (my !== seq.current) return // une réponse plus récente est déjà là
      setProfiles(p)
      setSales(s)
      setBoard(b)
      setAgencyRates(ar)
      setProfileRates(pr)
      setError(false)
    } catch (e) {
      console.error('Chargement Numbers :', e)
      if (my === seq.current) setError(true)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Rafales (annulation = plusieurs écritures) : un seul rechargement.
    let t: number | undefined
    const soon = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => void load(), 250)
    }
    // Le temps réel ne voit que les ventes que JE peux lire (RLS) : les
    // ventes des collègues arrivent au retour au premier plan.
    const off = subscribeSales(soon, (status) => {
      if (status === 'SUBSCRIBED') soon()
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const value = useMemo<NumbersState>(() => {
    const me = profile
    const isManager = me.role === 'manager'
    const isSupervisor = isSupervisorRole(me.role)
    const mine = profiles.find((p) => p.id === me.id)
    const canEditAll = isManager || (me.role === 'chef_ventes' && Boolean(mine?.can_edit_sales))
    const byId = new Map(profiles.map((p) => [p.id, p]))
    const nameOf = (id: string | null | undefined) => (id && byId.get(id)?.full_name) || 'Commercial'
    // Le profil support voit tout (il teste) ; les autres ne voient pas ses
    // ventes (même règle que les Stats de prospection, db/0022).
    const supportIds = new Set(profiles.filter((p) => p.is_support && p.id !== me.id).map((p) => p.id))
    const visible = <T extends BoardSale>(list: T[]) =>
      supportIds.size === 0
        ? list
        : list.filter((s) => !supportIds.has(s.seller1_id) && !(s.seller2_id && supportIds.has(s.seller2_id)))
    const rankable = profiles.filter(
      (p) =>
        !p.disabled_at &&
        p.role !== 'secretaire' &&
        !supportIds.has(p.id) &&
        !isManagerHiddenFor(me.role, p),
    )
    return {
      me,
      isSupervisor,
      isManager,
      canEditAll,
      profiles,
      sales: visible(sales),
      board: visible(board),
      agencyRates,
      profileRates,
      loading,
      error,
      reload: () => void load(),
      nameOf,
      rankable,
      drillId,
      setDrillId,
      openSeller: (id: string) => {
        setDrillId(id)
        onGoTo('n-stats')
      },
      goTo: onGoTo,
      openBookTodo: () => {
        setBookPreset('a_completer')
        onGoTo('ventes')
      },
      bookPreset,
      clearBookPreset: () => setBookPreset(null),
    }
  }, [profile, profiles, sales, board, agencyRates, profileRates, loading, error, load, drillId, onGoTo, bookPreset])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
