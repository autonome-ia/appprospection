import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  MapPin,
  ChevronRight,
  BellRing,
  CalendarClock,
  Check,
  ClipboardList,
  Phone,
  Settings,
} from 'lucide-react'
import { useSession } from '../lib/session'
import { fetchRelances, localDayKey } from '../data/points'
import { fetchStats, type StatsResult } from '../data/stats'
import { toast } from 'sonner'
import { fetchAppointments, updateAppointment } from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { STATUS_BY_VALUE } from '../domain/status'
import { APPOINTMENT_STATUS_META, type Appointment } from '../domain/appointments'
import { PointSheet } from './PointSheet'
import { AppointmentForm } from './AppointmentForm'
import { GuideSection } from './Guide'
import { ProfileSheet } from './ProfileSheet'
import { WeatherChip } from './WeatherChip'
import { isSupervisorRole, roleLabel, type MapPoint } from '../domain/types'

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

/** Date compacte d'une tâche en retard (colonne heure) : « 28/07 ». */
const fmtShortDay = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date(iso))

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
  const { profile, session } = useSession()
  const name = profile?.full_name ?? session?.user.email ?? null
  const role = roleLabel(profile?.role)
  // Chef des ventes = mêmes VUES que le manager (agrégats équipe, relances
  // de tous) — étape 4 du chantier Équipe.
  const isSupervisor = isSupervisorRole(profile?.role)
  const meId = profile?.id ?? null

  const [relances, setRelances] = useState<MapPoint[]>([])
  // La journée, pas le profil (audit UX B4) : portes/RDV du jour + objectif.
  const [statsJour, setStatsJour] = useState<StatsResult | null>(null)
  const [statsSemaine, setStatsSemaine] = useState<StatsResult | null>(null)
  const [orgProfiles, setOrgProfiles] = useState<OrgProfile[]>([])
  const [todayAppts, setTodayAppts] = useState<Appointment[]>([])
  // Tâches passées NON faites (boucle « Fait ✓ », 29/07 soir) : elles
  // remontent en tête du jour avec « en retard » — l'acompte d'hier ne
  // s'évapore plus. Faite ou supprimée = disparaît.
  const [lateTasks, setLateTasks] = useState<Appointment[]>([])
  const [busyTask, setBusyTask] = useState<string | null>(null)
  // Profil + déconnexion derrière l'avatar (sheet), plus en premier niveau.
  const [profileOpen, setProfileOpen] = useState(false)
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
        // carte où le point est invisible pour lui. Superviseur : tout.
        setRelances(
          isSupervisorRole(profile?.role) ? r : r.filter((p) => p.created_by === profile?.id),
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
        setLateTasks(
          appts
            .filter(
              (ap) =>
                ap.kind === 'tache' &&
                ap.status === 'a_venir' &&
                ap.commercial_id === profile?.id &&
                localDayKey(new Date(ap.scheduled_at)) < today,
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
  // Toggle « Fait ✓ » (aucun impact stats : kind='tache' filtré partout).
  const toggleTaskDone = async (a: Appointment) => {
    if (busyTask) return
    setBusyTask(a.id)
    try {
      await updateAppointment(a.id, { status: a.status === 'effectue' ? 'a_venir' : 'effectue' })
      toast.success(a.status === 'effectue' ? 'Tâche remise à faire' : 'Tâche faite')
      load()
    } catch (e) {
      console.error('Tâche faite :', e)
      toast.error('Impossible d’enregistrer — vérifiez le réseau')
    } finally {
      setBusyTask(null)
    }
  }

  useEffect(() => {
    load()
    // iOS restaure la PWA sans recharger : relances et feed restaient figés.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // Carte « Aujourd'hui » : mes chiffres — équipe pour le superviseur (A28).
  const portesJour = statsJour
    ? isSupervisor
      ? statsJour.team.portes
      : (meId ? statsJour.byCommercial[meId]?.portes : 0) ?? 0
    : null
  const rdvSemaine = statsSemaine
    ? isSupervisor
      ? statsSemaine.team.rdv_pris
      : (meId ? statsSemaine.byCommercial[meId]?.rdv_pris : 0) ?? 0
    : 0
  // Objectif équipe = ceux qui prospectent (objectif 0 = profil support hors
  // classement — même règle que les Stats) ; secrétaires/désactivés exclus.
  const objTarget = isSupervisor
    ? orgProfiles
        .filter((p) => !p.disabled_at && p.role !== 'secretaire')
        .reduce((s, p) => s + (p.weekly_rdv_target ?? 0), 0)
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
          <div className="today-head">
            <p className="eyebrow">Aujourd’hui</p>
            <WeatherChip />
          </div>
          <div className="today-figures">
            <div className="today-figure">
              <span className="today-num tnum">{portesJour}</span>
              <span className="today-cap">{isSupervisor ? 'portes équipe' : 'portes toquées'}</span>
            </div>
            <div className="today-figure">
              {/* Les tâches d'agenda (29/07) restent dans la LISTE du jour
                  mais hors compteur : « RDV du jour » = des vrais RDV. */}
              <span className="today-num tnum">
                {todayAppts.filter((a) => a.kind !== 'tache').length}
              </span>
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
                RDV cette semaine{isSupervisor ? ' (équipe)' : ''}
              </span>
            </>
          )}
        </motion.section>
      )}

      {!loading && (
        <motion.section className="home-section" variants={fade} custom={3} initial="hidden" animate="show">
          <p className="eyebrow section-title">
            <CalendarClock size={12} strokeWidth={2} /> Mes RDV aujourd’hui
            {todayAppts.length + lateTasks.length > 0 && ` · ${todayAppts.length + lateTasks.length}`}
          </p>
          {/* Tâches passées non faites EN TÊTE (boucle « Fait ✓ ») : l'acompte
              d'hier regarde le commercial en face au lieu de s'évaporer. */}
          {lateTasks.map((a) => (
            <div key={a.id} className="home-row-group">
              <button type="button" className="home-row" onClick={() => setEditing(a)}>
                <ClipboardList size={15} strokeWidth={1.9} className="appt-task-icon" />
                <span className="rdv-row-time tnum">{fmtShortDay(a.scheduled_at)}</span>
                <span className="home-row-main">
                  <span className="home-row-title">{a.notes ?? 'Tâche'}</span>
                  {(a.client_name || a.address) && (
                    <span className="home-row-sub">
                      {[a.client_name, a.address].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="home-row-when task-late">en retard</span>
              </button>
              <button
                type="button"
                className="home-row-call task-check"
                onClick={() => toggleTaskDone(a)}
                disabled={busyTask === a.id}
                aria-label="Marquer la tâche faite"
              >
                <Check size={17} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {todayAppts.length === 0 && lateTasks.length === 0 ? (
            // État vide EXPLICITE (audit UX B4) : la journée reste guidée.
            <p className="screen-empty">
              Aucun RDV aujourd’hui
              {relances.length > 0
                ? ` — ${relances.length} maison${relances.length > 1 ? 's' : ''} à relancer.`
                : '.'}
            </p>
          ) : (
            todayAppts.map((a) =>
              a.kind === 'tache' ? (
                // Tâche : l'objet est le titre, tap → édition (pas de fiche
                // client), « Fait ✓ » en bout de ligne — faite = barrée.
                <div key={a.id} className="home-row-group">
                  <button type="button" className="home-row" onClick={() => setEditing(a)}>
                    <ClipboardList size={15} strokeWidth={1.9} className="appt-task-icon" />
                    <span className="rdv-row-time tnum">{fmtTime(a.scheduled_at)}</span>
                    <span className="home-row-main">
                      <span
                        className={`home-row-title ${a.status === 'effectue' ? 'is-task-done' : ''}`}
                      >
                        {a.notes ?? 'Tâche'}
                      </span>
                      {(a.client_name || a.address) && (
                        <span className="home-row-sub">
                          {[a.client_name, a.address].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`home-row-call task-check ${a.status === 'effectue' ? 'is-done' : ''}`}
                    onClick={() => toggleTaskDone(a)}
                    disabled={busyTask === a.id}
                    aria-label={a.status === 'effectue' ? 'Remettre la tâche à faire' : 'Marquer la tâche faite'}
                  >
                    <Check size={17} strokeWidth={2.2} />
                  </button>
                </div>
              ) : (
                <button
                  key={a.id}
                  type="button"
                  className="home-row"
                  // RDV libre sans point : pas de fiche du point — édition.
                  onClick={() => (a.point ? setClientAppt(a) : setEditing(a))}
                >
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
              ),
            )
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

      {/* Profil + déconnexion + thème + Équipe : sheet partagée (extraite au
          chantier Équipe — la secrétaire l'ouvre depuis son agenda). */}
      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />

      {/* LA fiche du point, identique à la carte (convergence 29/07). Elle
          monte elle-même le formulaire RDV (Modifier / Planifier / + RDV). */}
      {clientAppt?.point && profile && (
        <PointSheet
          pointId={clientAppt.point.id}
          profile={profile}
          onOpenChange={(o) => !o && setClientAppt(null)}
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
