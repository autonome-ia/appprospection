import { Home, Map, CalendarDays, BarChart3, type LucideIcon } from 'lucide-react'

export type Tab = 'accueil' | 'carte' | 'agenda' | 'stats'

interface NavItem {
  tab: Tab
  label: string
  Icon: LucideIcon
}

const ITEMS: NavItem[] = [
  { tab: 'accueil', label: 'Accueil', Icon: Home },
  { tab: 'carte', label: 'Carte', Icon: Map },
  { tab: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { tab: 'stats', label: 'Stats', Icon: BarChart3 },
]

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

/** Barre de navigation inférieure — l'onglet actif se signale par l'icône
    colorée seule (la pastille de fond a été retirée, retour briac 26/07). */
export function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ tab, label, Icon }) => {
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
