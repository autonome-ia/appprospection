import {
  Home,
  Map,
  CalendarDays,
  BarChart3,
  NotebookText,
  Users,
  HandCoins,
  ChartPie,
  type LucideIcon,
} from 'lucide-react'

/** Onglets des deux espaces (chantier Numbers) : la prospection, puis
    Numbers (préfixe n- quand le nom existe déjà côté prospection). */
export type Tab = 'accueil' | 'carte' | 'agenda' | 'stats' | 'n-accueil' | 'ventes' | 'tableaux' | 'n-stats'

export interface NavItem {
  tab: Tab
  label: string
  Icon: LucideIcon
}

export const PROSPECTION_TABS: NavItem[] = [
  { tab: 'accueil', label: 'Accueil', Icon: Home },
  { tab: 'carte', label: 'Carte', Icon: Map },
  { tab: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { tab: 'stats', label: 'Stats', Icon: BarChart3 },
]

export const NUMBERS_TABS: NavItem[] = [
  { tab: 'n-accueil', label: 'Accueil', Icon: Home },
  { tab: 'ventes', label: 'Ventes', Icon: NotebookText },
  { tab: 'tableaux', label: 'Équipe', Icon: Users },
  { tab: 'n-stats', label: 'Stats', Icon: ChartPie },
]

/** Onglets Numbers selon le rôle (tour UI/UX 26/09) : le 3e onglet est
    « Équipe » (tableau par vendeur, vue paie) pour manager et chef des
    ventes, « Commissions » (mes ventes, ma part, ma commission + le tableau
    de l'agence) pour un commercial. */
export function numbersTabs(supervisor: boolean): NavItem[] {
  return NUMBERS_TABS.map((t) =>
    t.tab === 'tableaux' && !supervisor ? { ...t, label: 'Commissions', Icon: HandCoins } : t,
  )
}

interface Props {
  items?: NavItem[]
  active: Tab
  onChange: (tab: Tab) => void
}

/** Barre de navigation inférieure — l'onglet actif se signale par l'icône
    colorée seule (la pastille de fond a été retirée, retour briac 26/07). */
export function BottomNav({ items = PROSPECTION_TABS, active, onChange }: Props) {
  return (
    <nav className="bottom-nav">
      {items.map(({ tab, label, Icon }) => {
        const on = active === tab
        return (
          <button
            key={tab}
            type="button"
            className={`nav-item ${on ? 'is-active' : ''}`}
            onClick={() => onChange(tab)}
          >
            <Icon className="nav-icon" size={21} strokeWidth={on ? 2.2 : 1.7} />
            <span className="nav-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
