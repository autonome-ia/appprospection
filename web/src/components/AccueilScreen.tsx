import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { MapPin, LogOut, ChevronRight, BellRing, Activity } from 'lucide-react'
import { useSession } from '../lib/session'
import { fetchRelances, localDayKey } from '../data/points'
import { fetchRecentActivity, type ActivityItem } from '../data/stats'
import { STATUS_BY_VALUE } from '../domain/status'
import type { MapPoint } from '../domain/types'

/** « il y a 5 min », « hier »… pour le feed d'activité. */
function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'hier' : `il y a ${d} j`
}

function relanceLabel(iso: string): string {
  // Jour LOCAL (toISOString = UTC : « aujourd'hui » était faux entre minuit
  // et 2 h, heure française — audit).
  const today = localDayKey(new Date())
  if (iso === today) return 'aujourd’hui'
  const d = new Date(`${iso}T00:00:00`)
  return `depuis le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d)}`
}

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

export function AccueilScreen({
  onShowOnMap,
}: {
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}) {
  const { profile, session, signOut } = useSession()
  const name = profile?.full_name ?? session?.user.email ?? null
  const role = profile?.role === 'manager' ? 'Manager' : 'Commercial'

  const [relances, setRelances] = useState<MapPoint[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  // Échec ≠ sections vides (audit UX A33) : un raté réseau faisait
  // disparaître relances et feed sans un mot.
  const [loadError, setLoadError] = useState(false)
  const load = useCallback(() => {
    Promise.all([fetchRelances(), fetchRecentActivity()])
      .then(([r, a]) => {
        setRelances(r)
        setActivity(a)
        setLoadError(false)
      })
      .catch((e) => {
        console.error('Accueil :', e)
        setLoadError(true)
      })
  }, [])
  useEffect(() => {
    load()
    // iOS restaure la PWA sans recharger : relances et feed restaient figés.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

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

      {loadError && (
        <div className="load-error">
          <span>Impossible de charger les données — vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={load}>
            Réessayer
          </button>
        </div>
      )}

      {relances.length > 0 && (
        <motion.section className="home-section" variants={fade} custom={3} initial="hidden" animate="show">
          <p className="eyebrow section-title">
            <BellRing size={12} strokeWidth={2} /> À relancer · {relances.length}
          </p>
          {relances.map((p) => (
            <button
              key={p.id}
              type="button"
              className="home-row"
              onClick={() => onShowOnMap?.({ pointId: p.id, lng: p.lng, lat: p.lat })}
            >
              <span className="status-dot" style={{ background: STATUS_BY_VALUE[p.status].color }} />
              <span className="home-row-main">
                <span className="home-row-title">
                  {p.client_name ?? p.address ?? 'Maison à revoir'}
                </span>
                <span className="home-row-sub">
                  {p.client_name && p.address ? `${p.address} · ` : ''}
                  {p.note ?? ''}
                </span>
              </span>
              <span className="home-row-when tnum">{p.revisit_at ? relanceLabel(p.revisit_at) : ''}</span>
            </button>
          ))}
        </motion.section>
      )}

      {activity.length > 0 && (
        <motion.section className="home-section" variants={fade} custom={4} initial="hidden" animate="show">
          <p className="eyebrow section-title">
            <Activity size={12} strokeWidth={2} /> Activité récente
          </p>
          {/* Cliquable vers la carte (audit UX A29) — même pattern que les
              relances juste au-dessus ; ligne inerte si le point a disparu. */}
          {activity.map((a) => {
            const inner = (
              <>
                <span className="status-dot" style={{ background: STATUS_BY_VALUE[a.status].color }} />
                <span className="home-row-main">
                  <span className="home-row-title">
                    {(a.author_name ?? 'Équipe').split(/\s/)[0]} · {STATUS_BY_VALUE[a.status].label}
                  </span>
                  <span className="home-row-sub">{a.client_name ?? a.address ?? ''}</span>
                </span>
                <span className="home-row-when tnum">{timeAgo(a.occurred_at)}</span>
              </>
            )
            return a.point && onShowOnMap ? (
              <button
                key={a.id}
                type="button"
                className="home-row"
                onClick={() => onShowOnMap({ pointId: a.point!.id, lng: a.point!.lng, lat: a.point!.lat })}
              >
                {inner}
              </button>
            ) : (
              <div key={a.id} className="home-row is-static">
                {inner}
              </div>
            )
          })}
        </motion.section>
      )}

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
