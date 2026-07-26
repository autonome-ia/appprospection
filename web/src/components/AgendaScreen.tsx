import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { Plus, Phone, Pencil, Trash2, CalendarClock, ChevronLeft, ChevronRight, StickyNote, MapPin, Navigation, Search, X } from 'lucide-react'
import {
  fetchAppointments,
  deleteAppointment,
  setAppointmentOutcome,
  subscribeAppointments,
} from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { fetchRevisits, subscribePoints } from '../data/points'
import { AppointmentForm } from './AppointmentForm'
import { ClientSheet, wazeUrl } from './ClientSheet'
import { APPOINTMENT_STATUS_META, APPOINTMENT_OUTCOMES, type Appointment } from '../domain/appointments'
import { STATUS_BY_VALUE } from '../domain/status'
import { colorForCommercial } from '../domain/colors'
import type { MapPoint, Profile } from '../domain/types'

function fmt(iso: string, timeOnly = false): string {
  return new Intl.DateTimeFormat(
    'fr-FR',
    timeOnly
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(iso))
}

/** Nom affichable d'un commercial : jamais l'email brut (audit UX A11). */
function displayName(p: OrgProfile | undefined): string {
  const raw = p?.full_name?.trim()
  if (!raw) return 'Commercial'
  const base = raw.includes('@') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Commercial'
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return parts.length > 1 ? `${first} ${parts[1].charAt(0).toUpperCase()}.` : first
}

interface CardProps {
  appt: Appointment
  who: OrgProfile | undefined
  profile: Profile
  onChanged: () => void
  onEdit: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  /** Ouvre la fiche client complète (badges, 3D, rapport) — audit UX A6. */
  onOpenClient?: (a: Appointment) => void
  timeOnly?: boolean
}

function AppointmentCard({
  appt,
  who,
  profile,
  onChanged,
  onEdit,
  onShowOnMap,
  onOpenClient,
  timeOnly,
}: CardProps) {
  const meta = APPOINTMENT_STATUS_META[appt.status]
  const color = who ? colorForCommercial(who.id, who.color) : '#98a2b3'
  // Un appel en vol désactive les boutons : un double tap « Vendu » comptait
  // la vente DEUX fois dans les stats (audit).
  const [busy, setBusy] = useState(false)
  // Suppression en deux taps (audit UX A32) : fini le window.confirm système
  // hors DA — même pattern que la fiche point.
  const [confirmDel, setConfirmDel] = useState(false)
  // La RLS ne laisse supprimer que le titulaire ou un manager : proposer le
  // bouton aux autres produisait un faux « RDV supprimé » (audit).
  const canDelete = profile.role === 'manager' || appt.commercial_id === profile.id

  return (
    <div className="appt-card" style={{ ['--who' as string]: color }}>
      <div className="appt-row">
        <span className="appt-when tnum">{fmt(appt.scheduled_at, timeOnly)}</span>
        <span className="badge" style={{ color: meta.color, background: `${meta.color}1a` }}>
          {meta.label}
        </span>
      </div>

      {/* Nom tappable → fiche client complète (audit UX A6 : le même RDV
          existait à deux endroits sans lien, la préparation vit dans la
          fiche). Chevron = affordance. */}
      {onOpenClient ? (
        <button type="button" className="appt-open" onClick={() => onOpenClient(appt)}>
          <span className="appt-client">{appt.client_name ?? appt.address ?? 'Fiche client'}</span>
          <ChevronRight size={15} strokeWidth={1.9} className="row-chevron" />
        </button>
      ) : (
        appt.client_name && <div className="appt-client">{appt.client_name}</div>
      )}
      {/* Adresse LISIBLE (audit UX A17) : c'était un lien Waze sans
          affordance — l'app de nav se lançait quand on voulait juste lire.
          L'itinéraire devient un bouton explicite dans le pied de carte. */}
      {appt.address && <div className="appt-address">{appt.address}</div>}

      {/* Les notes sont LE contexte du commercial : toujours visibles, quel
          que soit le statut du RDV. */}
      {appt.notes && (
        <div className="appt-note">
          <StickyNote size={13} strokeWidth={1.9} />
          <span>{appt.notes}</span>
        </div>
      )}
      {/* Contexte terrain masqué s'il répète la note du RDV (comparaison
          nettoyée : les données historiques peuvent différer d'un espace). */}
      {appt.point?.notes && appt.point.notes.trim() !== (appt.notes ?? '').trim() && (
        <div className="appt-note is-context">
          <MapPin size={13} strokeWidth={1.9} />
          <span>{appt.point.notes}</span>
        </div>
      )}

      <div className="appt-foot">
        <span className="appt-who">
          <span className="status-dot" style={{ background: color }} />
          {displayName(who)}
        </span>
        {wazeUrl(appt.point, appt.address) && (
          <a
            className="appt-call"
            href={wazeUrl(appt.point, appt.address)!}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={14} strokeWidth={1.9} /> Itinéraire
          </a>
        )}
        {appt.client_phone && (
          <a className="appt-call" href={`tel:${appt.client_phone}`}>
            <Phone size={14} strokeWidth={1.9} /> Appeler
          </a>
        )}
      </div>

      {/* Issues visibles seulement le jour venu (audit UX A11) : à J-15, un
          tap de scroll raté écrivait des stats fausses. */}
      {appt.status === 'a_venir' && Date.parse(appt.scheduled_at) <= endOfToday() && (
        <div className="appt-outcomes">
          {APPOINTMENT_OUTCOMES.map((o) => {
            const m = APPOINTMENT_STATUS_META[o]
            return (
              <button
                key={o}
                type="button"
                className="outcome-btn"
                style={{ color: m.color, borderColor: `${m.color}55` }}
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    const { pointSynced } = await setAppointmentOutcome(profile, appt, o)
                    onChanged()
                    toast.success(`RDV marqué « ${m.label} »`)
                    if (o === 'vendu' && appt.point_id && !pointSynced) {
                      toast.error(
                        'La maison n’a pas pu passer en « vendu » sur la carte — rouvrez sa fiche pour corriger',
                      )
                    }
                  } catch (e) {
                    console.error('Issue du RDV :', e)
                    toast.error('Issue non enregistrée — vérifiez le réseau')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Accessible quel que soit le statut : un RDV vendu/effectué doit
          rester consultable et modifiable (notes = mémoire client). */}
      <div className="appt-actions">
        {appt.point && onShowOnMap && (
          <button
            type="button"
            className="text-btn"
            onClick={() =>
              onShowOnMap({ pointId: appt.point!.id, lng: appt.point!.lng, lat: appt.point!.lat })
            }
          >
            <MapPin size={14} strokeWidth={1.8} /> Carte
          </button>
        )}
        <button type="button" className="text-btn" onClick={() => onEdit(appt)}>
          <Pencil size={14} strokeWidth={1.8} /> Modifier
        </button>
        {canDelete && (
          <button
            type="button"
            className="text-btn danger"
            disabled={busy}
            onClick={async () => {
              if (!confirmDel) {
                setConfirmDel(true)
                window.setTimeout(() => setConfirmDel(false), 4000)
                return
              }
              setBusy(true)
              try {
                await deleteAppointment(appt.id)
                onChanged()
                toast('RDV supprimé')
              } catch (e) {
                console.error('Suppression du RDV :', e)
                toast.error('Suppression impossible — vérifiez le réseau')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Trash2 size={14} strokeWidth={1.8} /> {confirmDel ? 'Confirmer ?' : 'Supprimer'}
          </button>
        )}
      </div>
    </div>
  )
}

// --- Utilitaires de date (heure locale) ---
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/** Fin de la journée courante — les issues de RDV ne sont tapables que le jour J. */
function endOfToday(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function sameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b)
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Cellules de la grille du mois (lundi -> dimanche, semaines complètes). */
function monthCells(monthDate: Date): Date[] {
  const first = startOfMonth(monthDate)
  const startDow = (first.getDay() + 6) % 7 // lundi = 0
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
  const rows = Math.ceil((startDow + daysInMonth) / 7)
  const start = new Date(first)
  start.setDate(1 - startDow)
  return Array.from({ length: rows * 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// -----------------------------------------------------------------------------
// Sheet du jour : le mois occupe tout l'écran, le planning d'une journée
// s'ouvre au tap sur sa case (refonte agenda 26/07). Gabarit vaul commun
// OBLIGATOIRE : en-tête fixe, corps défilant data-vaul-no-drag, pied sticky,
// repositionInputs={false} (bug visualViewport iOS — ne jamais retirer).
// -----------------------------------------------------------------------------

interface DaySheetProps {
  date: Date
  appts: Appointment[]
  revisits: MapPoint[]
  whoById: Record<string, OrgProfile>
  profile: Profile
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  /** Ferment la sheet avant d'ouvrir l'autre surface : pas d'empilement de
      drawers vaul sur iOS (gestes et scroll se disputent le doigt). */
  onEdit: (a: Appointment) => void
  onOpenClient: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  onCreate: () => void
}

function DaySheet({
  date,
  appts,
  revisits,
  whoById,
  profile,
  onOpenChange,
  onChanged,
  onEdit,
  onOpenClient,
  onShowOnMap,
  onCreate,
}: DaySheetProps) {
  const dayLabel = capitalize(
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
  )
  return (
    <Drawer.Root open onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">{dayLabel}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onOpenChange(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
            {appts.length === 0 && revisits.length === 0 ? (
              <div className="empty-state">
                <CalendarClock size={26} strokeWidth={1.5} />
                <p>Aucun rendez-vous ce jour.</p>
              </div>
            ) : (
              <>
                {appts.map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appt={a}
                    who={a.commercial_id ? whoById[a.commercial_id] : undefined}
                    profile={profile}
                    onChanged={onChanged}
                    onEdit={onEdit}
                    onShowOnMap={onShowOnMap}
                    onOpenClient={onOpenClient}
                    timeOnly
                  />
                ))}
                {/* Maisons « à revoir » planifiées ce jour (pas des RDV : un
                    tap ouvre la fiche sur la carte). */}
                {revisits.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="home-row"
                    onClick={() => onShowOnMap?.({ pointId: p.id, lng: p.lng, lat: p.lat })}
                  >
                    <span
                      className="status-dot"
                      style={{ background: STATUS_BY_VALUE.a_revoir.color }}
                    />
                    <span className="home-row-main">
                      <span className="home-row-title">
                        {p.client_name ?? p.address ?? 'Maison à revoir'}
                      </span>
                      <span className="home-row-sub">
                        {p.client_name && p.address ? `${p.address} · ` : ''}
                        {p.note ?? ''}
                      </span>
                    </span>
                    <span className="home-row-when tnum">À revoir</span>
                  </button>
                ))}
              </>
            )}

            <div className="drawer-footer">
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                <Plus size={15} strokeWidth={2.2} /> RDV ce jour
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

export function AgendaScreen({
  profile,
  onShowOnMap,
}: {
  profile: Profile | null
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}) {
  const [appts, setAppts] = useState<Appointment[]>([])
  const [revisits, setRevisits] = useState<MapPoint[]>([])
  const [profiles, setProfiles] = useState<OrgProfile[]>([])
  // Création : depuis l'en-tête (heure par défaut) ou depuis la sheet du jour
  // (pré-datée sur ce jour).
  const [creating, setCreating] = useState<{ at: Date | null } | null>(null)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()))
  // Jour ouvert en sheet (refonte 26/07 : le mois plein écran est la vue,
  // le planning du jour s'ouvre par-dessus).
  const [daySheet, setDaySheet] = useState<Date | null>(null)
  // Vue « Clients » : une ligne par client (RDV pris), tap -> fiche complète.
  const [view, setView] = useState<'agenda' | 'clients'>('agenda')
  const [clientAppt, setClientAppt] = useState<Appointment | null>(null)
  const [clientQuery, setClientQuery] = useState('')
  // Agenda PARTAGÉ par défaut (décision chef des ventes, 25/07) : chip
  // « Mes RDV » pour ne voir que les siens.
  const [onlyMine, setOnlyMine] = useState(false)

  // Échec de chargement ≠ agenda vide : sans ce drapeau, une coupure réseau
  // affichait « Aucun rendez-vous ce jour » — un commercial pouvait rater un
  // RDV en croyant sa journée libre (audit).
  const [loadError, setLoadError] = useState(false)

  // « Aujourd'hui » du dernier recalage + miroir du mois affiché : au réveil
  // de la PWA on distingue le mois par défaut resté sur l'ancien aujourd'hui
  // (à recaler) d'un mois choisi à la main (à respecter).
  const todayRef = useRef(new Date())
  const monthDateRef = useRef(monthDate)
  monthDateRef.current = monthDate

  // Anti-course : plusieurs reload se croisent (visibilitychange + realtime +
  // onChanged) et c'était le DERNIER à résoudre qui gagnait, pas le plus
  // récent — un snapshot périmé pouvait ressusciter un RDV supprimé, et son
  // échec tardif afficher le bandeau d'erreur sur des données correctes
  // (contre-audit, bug 3). Seul le reload le plus récent applique son résultat.
  const reloadSeq = useRef(0)
  const reload = useCallback(() => {
    const seq = ++reloadSeq.current
    Promise.all([fetchAppointments(), fetchRevisits()])
      .then(([a, r]) => {
        if (seq !== reloadSeq.current) return
        setAppts(a)
        // Les « à revoir » suivent la carte privée : ceux du commercial
        // seulement (le manager voit tout).
        setRevisits(
          profile?.role === 'manager' ? r : r.filter((p) => p.created_by === profile?.id),
        )
        setLoadError(false)
      })
      .catch((e) => {
        console.error('Agenda :', e)
        if (seq !== reloadSeq.current) return
        setLoadError(true)
      })
  }, [profile?.role, profile?.id])

  useEffect(() => {
    reload()
    fetchOrgProfiles().then(setProfiles).catch((e) => console.error('Profils :', e))
    // Re-SUBSCRIBED après une coupure (veille iOS) = événements perdus →
    // rechargement ; idem au retour au premier plan de la PWA.
    // Rechargements realtime débouncés (rafales d'événements).
    let t: number | undefined
    const debounced = () => {
      window.clearTimeout(t)
      t = window.setTimeout(reload, 400)
    }
    let first = true
    const unsubAppts = subscribeAppointments(debounced, (s) => {
      if (s !== 'SUBSCRIBED') return
      if (first) {
        first = false
        return
      }
      reload()
    })
    // Les « à revoir » viennent de la table points, qui n'était PAS écoutée :
    // une relance posée par un collègue n'apparaissait qu'au changement
    // d'onglet (audit).
    const unsubPoints = subscribePoints({
      onInsert: debounced,
      onUpdate: debounced,
      onDelete: debounced,
    })
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Nuit (ou plus) en arrière-plan : iOS restaure la PWA sans recharger
      // la page. Si la date a changé et que la grille était restée sur le
      // mois de l'ancien « aujourd'hui », on la recale sur le mois réel —
      // sinon la grille marquait encore LA VEILLE (contre-audit, bug 30).
      const now = new Date()
      if (!sameDay(now, todayRef.current)) {
        if (monthDateRef.current.getTime() === startOfMonth(todayRef.current).getTime()) {
          setMonthDate(startOfMonth(now))
        }
        todayRef.current = now
      }
      reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
      unsubAppts()
      unsubPoints()
    }
  }, [reload])

  const whoById = useMemo(() => {
    const m: Record<string, OrgProfile> = {}
    profiles.forEach((p) => (m[p.id] = p))
    return m
  }, [profiles])

  // RDV affichés : tous (agenda partagé) ou les miens (chip « Mes RDV »).
  const shownAppts = useMemo(
    () => (onlyMine && profile ? appts.filter((a) => a.commercial_id === profile.id) : appts),
    [appts, onlyMine, profile],
  )

  // Regroupe les RDV par jour.
  const byDay = useMemo(() => {
    const m: Record<string, Appointment[]> = {}
    for (const a of shownAppts) {
      const k = dateKey(new Date(a.scheduled_at))
      ;(m[k] ??= []).push(a)
    }
    return m
  }, [shownAppts])

  // Regroupe les « à revoir » datés par jour de relance (clé YYYY-MM-DD).
  const revisitsByDay = useMemo(() => {
    const m: Record<string, MapPoint[]> = {}
    for (const p of revisits) {
      if (p.revisit_at) (m[p.revisit_at] ??= []).push(p)
    }
    return m
  }, [revisits])

  // Vue « Clients » : un client = une ligne. Regroupé par nom (repli adresse) ;
  // la ligne porte le RDV le plus PERTINENT (prochain à venir, sinon le plus
  // récent). Tri : à venir d'abord (par date), puis passés (du plus récent).
  const clients = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    for (const a of appts) {
      // Nom ET adresse (audit UX A18) : deux « Le Gall » distincts
      // fusionnaient en une seule ligne avec le nom seul.
      const name = a.client_name?.trim().toLowerCase() ?? ''
      const addr = a.address?.trim().toLowerCase() ?? ''
      const key = name || addr ? `${name}|${addr}` : a.id
      const list = groups.get(key)
      if (list) list.push(a)
      else groups.set(key, [a])
    }
    const now = Date.now()
    const reps = [...groups.values()].map((list) => {
      const upcoming = list
        .filter((a) => a.status === 'a_venir' && Date.parse(a.scheduled_at) >= now - 3_600_000)
        .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))
      const rep =
        upcoming[0] ?? [...list].sort((x, y) => y.scheduled_at.localeCompare(x.scheduled_at))[0]
      return { rep, count: list.length, upcoming: upcoming.length > 0 }
    })
    const q = clientQuery.trim().toLowerCase()
    const shown = q
      ? reps.filter(
          ({ rep }) =>
            (rep.client_name ?? '').toLowerCase().includes(q) ||
            (rep.address ?? '').toLowerCase().includes(q),
        )
      : reps
    return shown.sort((a, b) => {
      if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1
      return a.upcoming
        ? a.rep.scheduled_at.localeCompare(b.rep.scheduled_at)
        : b.rep.scheduled_at.localeCompare(a.rep.scheduled_at)
    })
  }, [appts, clientQuery])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const cells = monthCells(monthDate)
  const today = new Date()
  const monthLabel = capitalize(
    new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthDate),
  )
  const shiftMonth = (delta: number) =>
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1))

  return (
    <div className="screen agenda-screen">
      <header className="screen-head">
        <h2>Agenda</h2>
        <button type="button" className="head-action" onClick={() => setCreating({ at: null })}>
          <Plus size={16} strokeWidth={2.2} /> RDV
        </button>
      </header>

      {loadError && (
        <div className="load-error">
          <span>Agenda impossible à charger — vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      <div className="seg">
        {(
          [
            ['agenda', 'Agenda'],
            ['clients', 'Clients'],
          ] as ['agenda' | 'clients', string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`seg-btn ${view === v ? 'is-active' : ''}`}
            onClick={() => setView(v)}
          >
            {view === v && <span className="seg-ind" />}
            <span className="seg-text">{label}</span>
          </button>
        ))}
      </div>

      {view === 'clients' && (
        <section className="appt-section">
          <div className="clients-search">
            <Search size={15} strokeWidth={1.9} />
            <input
              className="field-input"
              type="search"
              placeholder="Rechercher (nom, adresse)…"
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
            />
          </div>
          <p className="eyebrow section-title">
            {clients.length} client{clients.length > 1 ? 's' : ''}
          </p>
          {clients.length === 0 ? (
            <div className="empty-state">
              <CalendarClock size={26} strokeWidth={1.5} />
              <p>{clientQuery.trim() ? 'Aucun client ne correspond.' : 'Aucun rendez-vous pris pour l’instant.'}</p>
            </div>
          ) : (
            clients.map(({ rep, count }) => {
              const meta = APPOINTMENT_STATUS_META[rep.status]
              const title = rep.client_name ?? rep.address ?? 'Client'
              return (
                <button
                  key={rep.id}
                  type="button"
                  className="home-row"
                  onClick={() => setClientAppt(rep)}
                >
                  <span className="status-dot" style={{ background: meta.color }} />
                  <span className="home-row-main">
                    <span className="home-row-title">{title}</span>
                    <span className="home-row-sub">
                      {rep.client_name && rep.address ? `${rep.address} · ` : ''}
                      {meta.label}
                      {count > 1 ? ` · ${count} RDV` : ''}
                    </span>
                  </span>
                  <span className="home-row-when tnum">{fmt(rep.scheduled_at)}</span>
                </button>
              )
            })
          )}
        </section>
      )}

      {view === 'agenda' && (
      <>
      <div className="cal">
        {/* Titre du mois à gauche, navigation groupée à droite (DA 26/07). */}
        <div className="cal-nav">
          <span className="cal-month">{monthLabel}</span>
          <div className="cal-nav-controls">
            <button
              type="button"
              className="icon-btn"
              onClick={() => shiftMonth(-1)}
              aria-label="Mois précédent"
            >
              <ChevronLeft size={18} />
            </button>
            {/* Retour 1 tap au mois courant (audit UX A16) : revenir coûtait
                3-4 taps de chevrons devant le prospect. */}
            {(monthDate.getMonth() !== today.getMonth() ||
              monthDate.getFullYear() !== today.getFullYear()) && (
              <button
                type="button"
                className="text-btn cal-today"
                onClick={() => setMonthDate(startOfMonth(new Date()))}
              >
                Aujourd’hui
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => shiftMonth(1)}
              aria-label="Mois suivant"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="chip-row agenda-mine">
          <button
            type="button"
            className={`chip ${onlyMine ? 'is-active' : ''}`}
            onClick={() => setOnlyMine((v) => !v)}
          >
            Mes RDV
          </button>
        </div>

        <div className="cal-weekdays">
          {WEEKDAYS.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>

        <div className="cal-grid">
          {cells.map((d) => {
            const dayAppts = (byDay[dateKey(d)] ?? []).sort((a, b) =>
              a.scheduled_at.localeCompare(b.scheduled_at),
            )
            const dayRevisits = revisitsByDay[dateKey(d)] ?? []
            // Étiquettes façon agenda iOS (référence capture briac) : le NOM
            // du client lisible sur tout le mois — couleur = statut du RDV,
            // ambre = maison à revoir. Débordement en « +n ».
            const items = [
              // Couleur = COMMERCIAL (décision chef des ventes, 25/07) : sur
              // un agenda partagé, « qui a ce RDV » prime — le statut se lit
              // dans le planning du jour. Ambre = maison à revoir.
              ...dayAppts.map((a) => ({
                label: a.client_name ?? a.address ?? 'RDV',
                color: a.commercial_id
                  ? colorForCommercial(a.commercial_id, whoById[a.commercial_id]?.color)
                  : '#98a2b3',
              })),
              ...dayRevisits.map((p) => ({
                label: p.client_name ?? p.address ?? 'À revoir',
                color: STATUS_BY_VALUE.a_revoir.color,
              })),
            ]
            const shown = items.slice(0, 4)
            const extra = items.length - shown.length
            const out = d.getMonth() !== monthDate.getMonth()
            const isToday = sameDay(d, today)
            return (
              <button
                key={dateKey(d)}
                type="button"
                className={`cal-cell ${out ? 'is-out' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => {
                  if (out) setMonthDate(startOfMonth(d))
                  setDaySheet(d)
                }}
              >
                <span className="cal-daynum">{d.getDate()}</span>
                <span className="cal-events">
                  {shown.map((it, i) => (
                    <span key={i} className="cal-event" style={{ background: it.color }}>
                      {it.label}
                    </span>
                  ))}
                  {extra > 0 && <span className="cal-more">+{extra}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      </>
      )}

      {daySheet && (
        <DaySheet
          date={daySheet}
          appts={(byDay[dateKey(daySheet)] ?? []).sort((a, b) =>
            a.scheduled_at.localeCompare(b.scheduled_at),
          )}
          revisits={revisitsByDay[dateKey(daySheet)] ?? []}
          whoById={whoById}
          profile={profile}
          onOpenChange={(o) => !o && setDaySheet(null)}
          onChanged={reload}
          onEdit={(a) => {
            setDaySheet(null)
            setEditing(a)
          }}
          onOpenClient={(a) => {
            setDaySheet(null)
            setClientAppt(a)
          }}
          onShowOnMap={
            onShowOnMap
              ? (t) => {
                  setDaySheet(null)
                  onShowOnMap(t)
                }
              : undefined
          }
          onCreate={() => {
            const at = new Date(daySheet)
            at.setHours(9, 0, 0, 0)
            setDaySheet(null)
            setCreating({ at })
          }}
        />
      )}

      {clientAppt && (
        <ClientSheet
          appt={clientAppt}
          profile={profile}
          onOpenChange={(o) => !o && setClientAppt(null)}
          onEdit={(a) => {
            setClientAppt(null)
            setEditing(a)
          }}
          onShowOnMap={onShowOnMap}
          onChanged={reload}
        />
      )}

      {creating && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setCreating(null)}
          profile={profile}
          defaultAt={creating.at}
          onSaved={() => {
            setCreating(null)
            reload()
          }}
        />
      )}
      {editing && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setEditing(null)}
          profile={profile}
          existing={editing}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
