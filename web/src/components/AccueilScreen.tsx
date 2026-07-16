import { motion } from 'motion/react'
import { MapPin, LogOut, ChevronRight } from 'lucide-react'
import { useSession } from '../lib/session'

function initials(name: string | null | undefined, fallback: string): string {
  const src = name?.trim() || fallback
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

const fade = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export function AccueilScreen() {
  const { profile, session, signOut } = useSession()
  const name = profile?.full_name ?? session?.user.email ?? null
  const role = profile?.role === 'manager' ? 'Manager' : 'Commercial'

  return (
    <div className="screen accueil-screen">
      <motion.div className="brand" variants={fade} custom={0} initial="hidden" animate="show">
        <span className="brand-mark">
          <MapPin size={16} strokeWidth={2.4} />
        </span>
        <span className="brand-word">Prospection</span>
      </motion.div>

      <motion.h1 className="accueil-hello" variants={fade} custom={1} initial="hidden" animate="show">
        Bonjour{name ? ',' : ''}
        {name && <span className="accueil-name">{name.split(/[\s@]/)[0]}</span>}
      </motion.h1>

      <motion.div className="user-card" variants={fade} custom={2} initial="hidden" animate="show">
        <span className="avatar">{initials(profile?.full_name, session?.user.email ?? '?')}</span>
        <div className="user-meta">
          <span className="user-name">{name ?? 'Utilisateur'}</span>
          <span className="user-role">{role}</span>
        </div>
      </motion.div>

      {session && (
        <motion.button
          type="button"
          className="row-action"
          onClick={() => void signOut()}
          variants={fade}
          custom={3}
          initial="hidden"
          animate="show"
        >
          <LogOut size={18} strokeWidth={1.8} />
          <span>Se déconnecter</span>
          <ChevronRight size={17} strokeWidth={1.8} className="row-chevron" />
        </motion.button>
      )}
    </div>
  )
}
