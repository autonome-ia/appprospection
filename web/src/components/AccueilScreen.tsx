import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Drawer } from 'vaul'
import {
  MapPin,
  LogOut,
  ChevronRight,
  BellRing,
  CalendarClock,
  Phone,
  Settings,
  X,
} from 'lucide-react'
import { useSession } from '../lib/session'
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme'
import { fetchRelances, localDayKey } from '../data/points'
import { fetchStats, type StatsResult } from '../data/stats'
import { fetchAppointments } from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { STATUS_BY_VALUE } from '../domain/status'
import { APPOINTMENT_STATUS_META, type Appointment } from '../domain/appointments'
import { ClientSheet } from './ClientSheet'
import { AppointmentForm } from './AppointmentForm'
import { GuideSection } from './Guide'
import type { MapPoint } from '../domain/types'

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

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Auto' },
]

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
  const isManager = profile?.role === 'manager'
  const meId = profile?.id ?? null

  const [relances, setRelances] = useState<MapPoint[]>([])
  // La journée, pas le profil (audit UX B4) : portes/RDV du jour + objectif.
  const [statsJour, setStatsJour] = useState<StatsResult | null>(null)
  const [statsSemaine, setStatsSemaine] = useState<StatsResult | null>(null)
  const [orgProfiles, setOrgProfiles] = useState<OrgProfile[]>([])
  const [todayAppts, setTodayAppts] = useState<Appointment[]>([])
  // Profil + déconnexion derrière l'avatar (sheet), plus en premier niveau.
  const [profileOpen, setProfileOpen] = useState(false)
  const themeChoice = useThemePref()
  const [clientAppt, setClientAppt] = useState<Appointment | null>(null)
  const [editing, setEditing] = useState<Appointment | null>(null)
  // Échec ≠ sections vides (audit UX A33) : un raté réseau faisait
  // disparaître relances et feed sans un mot.
  const [loadError, setLoadError] = useState(false)
  // Premier chargement : squelettes à la place du vide (audit UX B14) — les
  // recharges suivantes (retour au premier plan) restent silencieuses.
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      fetchRelances(),
      fetchStats('jour'),
      fetchStats('semaine'),
      fetchAppointments(),
      fetchOrgProfiles(),
    ])
      .then(([r, sj, sw, appts, profs]) => {
        // Carte privée (décision chef des ventes, 25/07) : le commercial ne
        // relance que SES portes — une relance d'un collègue ouvrirait une
        // carte où le point est invisible pour lui.
        setRelances(
          profile?.role === 'manager' ? r : r.filter((p) => p.created_by === profile?.id),
        )
        setStatsJour(sj)
        setStatsSemaine(sw)
        setOrgProfiles(profs)
        // « Mes RDV aujourd'hui » : les MIENS (le manager prospecte aussi).
        const today = localDayKey(new Date())
        setTodayAppts(
          appts
            .filter(
              (ap) =>
                ap.commercial_id === profile?.id &&
                localDayKey(new Date(ap.scheduled_at)) === today,
            )
            .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at)),
        )
        setLoadError(false)
      })
      .catch((e) => {
        console.error('Accueil :', e)
        setLoadError(true)
      })
      .finally(() => setLoading(false))
  }, [profile?.role, profile?.id])
  useEffect(() => {
    load()
    // iOS restaure la PWA sans recharger : relances et feed restaient figés.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // Carte « Aujourd'hui » : mes chiffres — équipe pour le manager (A28).
  const portesJour = statsJour
    ? isManager
      ? statsJour.team.portes
      : (meId ? statsJour.byCommercial[meId]?.portes : 0) ?? 0
    : null
  const rdvSemaine = statsSemaine
    ? isManager
      ? statsSemaine.team.rdv_pris
      : (meId ? statsSemaine.byCommercial[meId]?.rdv_pris : 0) ?? 0
    : 0
  const objTarget = isManager
    ? orgProfiles.reduce((s, p) => s + (p.weekly_rdv_target ?? 0), 0)
    : (orgProfiles.find((p) => p.id === meId)?.weekly_rdv_target ?? 0)

  return (
    <div className="screen accueil-screen">
      <motion.div className="brand" variants={fade} custom={0} initial="hidden" animate="show">
        <span className="brand-mark">
          <MapPin size={16} strokeWidth={2.4} />
        </span>
        <span className="brand-word">Prospection</span>
      </motion.div>

      {/* Une seule ligne d'en-tête (audit UX B4) : le nom apparaissait deux
          fois et « Se déconnecter » était au premier niveau — le contenu
          utile commençait sous le pli. Profil derrière l'avatar. */}
      <motion.header className="accueil-head" variants={fade} custom={1} initial="hidden" animate="show">
        <button
          type="button"
          className="avatar avatar-btn"
          onClick={() => setProfileOpen(true)}
          aria-label="Profil et déconnexion"
        >
          {initials(profile?.full_name, session?.user.email ?? '?')}
        </button>
        <div className="accueil-head-texts">
          <h1 className="accueil-hello">
            Bonjour{name ? ` ${name.split(/[\s@]/)[0]}` : ''}
          </h1>
          <span className="accueil-role">{role}</span>
        </div>
        {/* Réglages VISIBLES (retour briac 29/07) : l'avatar seul ne se
            devinait pas — même sheet, entrée explicite. */}
        <button
          type="button"
          className="icon-btn accueil-settings"
          onClick={() => setProfileOpen(true)}
          aria-label="Réglages"
        >
          <Settings size={19} strokeWidth={1.8} />
        </button>
      </motion.header>

      {loadError && (
        <div className="load-error">
          <span>Impossible de charger les données — vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={load}>
            Réessayer
          </button>
        </div>
      )}

      {loading && !loadError && (
        <div className="home-section" aria-hidden="true">
          <span className="sk sk-line" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      )}

      {!loading && statsJour && (
        <motion.section
          className="card today-card"
          variants={fade}
          custom={2}
          initial="hidden"
          animate="show"
        >
          <p className="eyebrow">Aujourd’hui</p>
          <div className="today-figures">
            <div className="today-figure">
              <span className="today-num tnum">{portesJour}</span>
              <span className="today-cap">{isManager ? 'portes équipe' : 'portes toquées'}</span>
            </div>
            <div className="today-figure">
              <span className="today-num tnum">{todayAppts.length}</span>
              <span className="today-cap">RDV du jour</span>
            </div>
            <div className="today-figure">
              <span className="today-num tnum">{relances.length}</span>
              <span className="today-cap">à relancer</span>
            </div>
          </div>
          {/* Objectif HEBDO (barre) : le cap de la semaine reste visible. */}
          {objTarget > 0 && (
            <>
              <div className="obj-bar-bg">
                <div
                  className="obj-bar"
                  style={{ width: `${Math.min(100, (rdvSemaine / objTarget) * 100)}%` }}
                />
              </div>
              <span className="today-obj">
                <span className="tnum">
                  {rdvSemaine}/{objTarget}
                </span>{' '}
                RDV cette semaine{isManager ? ' (équipe)' : ''}
              </span>
            </>
          )}
        </motion.section>
      )}

      {!loading && (
        <motion.section className="home-section" variants={fade} custom={3} initial="hidden" animate="show">
          <p className="eyebrow section-title">
            <CalendarClock size={12} strokeWidth={2} /> Mes RDV aujourd’hui
            {todayAppts.length > 0 && ` · ${todayAppts.length}`}
          </p>
          {todayAppts.length === 0 ? (
            // État vide EXPLICITE (audit UX B4) : la journée reste guidée.
            <p className="screen-empty">
              Aucun RDV aujourd’hui
              {relances.length > 0
                ? ` — ${relances.length} maison${relances.length > 1 ? 's' : ''} à relancer.`
                : '.'}
            </p>
          ) : (
            todayAppts.map((a) => (
              <button key={a.id} type="button" className="home-row" onClick={() => setClientAppt(a)}>
                <span
                  className="status-dot"
                  style={{ background: APPOINTMENT_STATUS_META[a.status].color }}
                />
                <span className="rdv-row-time tnum">{fmtTime(a.scheduled_at)}</span>
                <span className="home-row-main">
                  <span className="home-row-title">{a.client_name ?? a.address ?? 'RDV'}</span>
                  {a.client_name && a.address && (
                    <span className="home-row-sub">{a.address}</span>
                  )}
                </span>
                <ChevronRight size={15} strokeWidth={1.9} className="row-chevron" />
              </button>
            ))
          )}
        </motion.section>
      )}

      {relances.length > 0 && (
        <motion.section className="home-section" variants={fade} custom={4} initial="hidden" animate="show">
          <p className="eyebrow section-title">
            <BellRing size={12} strokeWidth={2} /> À relancer · {relances.length}
          </p>
          {relances.map((p) => (
            // Bouton (carte) + appel côte à côte : une ancre tel: DANS le
            // bouton serait du HTML invalide (audit UX B10).
            <div key={p.id} className="home-row-group">
              <button
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
                <span className="home-row-when">{p.revisit_at ? relanceLabel(p.revisit_at) : ''}</span>
              </button>
              {p.client_phone && (
                <a
                  className="home-row-call"
                  href={`tel:${p.client_phone}`}
                  aria-label={`Appeler ${p.client_name ?? 'le client'}`}
                >
                  <Phone size={17} strokeWidth={1.9} />
                </a>
              )}
            </div>
          ))}
        </motion.section>
      )}

      {/* Guide de l'app (26/07, à la place du feed d'activité) : les tutos
          pas-à-pas — l'onboarding des futurs commerciaux de l'équipe. */}
      <motion.div variants={fade} custom={5} initial="hidden" animate="show">
        <GuideSection />
      </motion.div>

      {/* Profil + déconnexion : sheet derrière l'avatar (audit UX B4). */}
      {/* repositionInputs={false} : gabarit commun des sheets (bug iOS). */}
      <Drawer.Root open={profileOpen} onOpenChange={setProfileOpen} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer-content">
            <div className="drawer-grip" />
            <div className="drawer-header">
              <span className="drawer-title">Profil &amp; réglages</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setProfileOpen(false)}
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="drawer-body" data-vaul-no-drag>
              <div className="user-card">
                <span className="avatar">{initials(profile?.full_name, session?.user.email ?? '?')}</span>
                <div className="user-meta">
                  <span className="user-name">{name ?? 'Utilisateur'}</span>
                  <span className="user-role">
                    {role}
                    {session?.user.email ? ` · ${session.user.email}` : ''}
                  </span>
                </div>
              </div>
              {/* Thème : préférence de l'appareil (localStorage), appliquée
                  à chaud — « Auto » suit le réglage du téléphone. */}
              <div className="theme-pick">
                <span className="eyebrow">Thème</span>
                <div className="seg">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`seg-btn ${themeChoice === t.value ? 'is-active' : ''}`}
                      onClick={() => setThemePref(t.value)}
                    >
                      {themeChoice === t.value && <span className="seg-ind" />}
                      <span className="seg-text">{t.label}</span>
                    </button>
                  ))}
                </div>
                <p className="theme-hint">Auto : suit le réglage du téléphone.</p>
              </div>
              {session && (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => {
                    setProfileOpen(false)
                    void signOut()
                  }}
                >
                  <LogOut size={18} strokeWidth={1.8} />
                  <span>Se déconnecter</span>
                  <ChevronRight size={17} strokeWidth={1.8} className="row-chevron" />
                </button>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {clientAppt && profile && (
        <ClientSheet
          appt={clientAppt}
          profile={profile}
          onOpenChange={(o) => !o && setClientAppt(null)}
          onEdit={(a) => {
            setClientAppt(null)
            setEditing(a)
          }}
          onShowOnMap={onShowOnMap}
          onChanged={load}
        />
      )}
      {editing && profile && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setEditing(null)}
          profile={profile}
          existing={editing}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
