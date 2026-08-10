import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import {
  Plus,
  Phone,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Navigation,
  Search,
  Settings,
  X,
} from 'lucide-react'
import {
  fetchAppointments,
  setAppointmentOutcome,
  subscribeAppointments,
  updateAppointment,
} from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { fetchContacts, fetchRevisits, subscribePoints } from '../data/points'
import { AppointmentForm } from './AppointmentForm'
import { PointSheet } from './PointSheet'
import { wazeUrl } from '../lib/nav'
import { ContactForm } from './ContactForm'
import {
  APPOINTMENT_STATUS_META,
  APPOINTMENT_OUTCOMES,
  FOLLOW_UP_OUTCOMES,
  outcomeToastMessage,
  type Appointment,
  type AppointmentKind,
} from '../domain/appointments'
import { STATUS_BY_VALUE, sameDisplayStatus } from '../domain/status'
import { colorForCommercial } from '../domain/colors'
import { ProfileSheet } from './ProfileSheet'
import { isSecretaireRole, isSupervisorRole, type MapPoint, type Profile } from '../domain/types'

function fmt(iso: string, timeOnly = false): string {
  return new Intl.DateTimeFormat(
    'fr-FR',
    timeOnly
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(iso))
}

/** Date seule (échéance de relance dans la liste Contacts). */
const fmtDateOnly = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso))

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
  /** Ouvre la fiche client complète (badges, 3D, rapport) — audit UX A6.
      Modifier / Supprimer / Carte vivent dans la fiche : le bloc reste léger. */
  onOpenClient: (a: Appointment) => void
  /** RDV annulé → nouveau RDV pré-rempli du même point (refonte 29/07). */
  onReplan?: (a: Appointment) => void
  /** Secrétaire (étape 4) : les agendas de tous en LECTURE — ni issues, ni
      « Fait ✓ », ni fiche ; Appeler / Itinéraire restent (son quotidien). */
  readOnly?: boolean
}

/** RDV en « rail horaire » (refonte 26/07) : heure mono à gauche, barre à la
    couleur du commercial, contenu aéré — plus de cadre de carte. */
function AppointmentCard({ appt, who, profile, onChanged, onOpenClient, onReplan, readOnly }: CardProps) {
  const meta = APPOINTMENT_STATUS_META[appt.status]
  const color = who ? colorForCommercial(who.id, who.color) : '#98a2b3'
  // Tâche d'agenda (29/07) : sa note est son TITRE, client/adresse en
  // secondaire, ni issues ni fiche client (le tap ouvre l'édition).
  // `effectue` = FAITE (boucle « Fait ✓ », 29/07 soir) : titre barré,
  // re-tap pour remettre à faire — hors stats quel que soit le statut.
  const isTache = appt.kind === 'tache'
  const done = isTache && appt.status === 'effectue'
  // Un appel en vol désactive les boutons : un double tap « Vendu » comptait
  // la vente DEUX fois dans les stats (audit).
  const [busy, setBusy] = useState(false)
  const waze = wazeUrl(appt.point, appt.address)
  // Chacun ses RDV (retour chef des ventes, 10/08) : un commercial ne voit
  // AUCUNE action (issues, « Fait ✓ », Replanifier, édition de tâche) sur le
  // RDV d'un collègue — les boutons s'affichaient et échouaient au tap (la
  // RLS refuse titulaire/créateur/superviseur exceptés). Superviseurs : tout.
  const canAct =
    !readOnly && (isSupervisorRole(profile.role) || appt.commercial_id === profile.id)
  // Une tâche d'un collègue reste lisible mais inerte (le tap ouvre l'édition).
  const inert = readOnly || (isTache && !canAct)
  // Même règle que RdvSection (la fiche) : toutes les issues dès le jour J,
  // Vendu / Refus tant que le RDV est « En attente ».
  const railOutcomes =
    appt.status === 'a_venir' && Date.parse(appt.scheduled_at) <= endOfToday()
      ? APPOINTMENT_OUTCOMES
      : appt.status === 'effectue'
        ? FOLLOW_UP_OUTCOMES
        : null

  return (
    <div className={`appt-item ${done ? 'is-task-done' : ''}`} style={{ ['--who' as string]: color }}>
      <span className="appt-time">{fmt(appt.scheduled_at, true)}</span>
      <span className="appt-rail" aria-hidden="true" />
      <div className="appt-body">
        {/* Tout le bloc lecture est tappable → fiche client (audit UX A6).
            Lecture seule (secrétaire) : le bloc reste un simple affichage. */}
        <button
          type="button"
          className={`appt-main ${inert ? 'is-readonly' : ''}`}
          onClick={inert ? undefined : () => onOpenClient(appt)}
          disabled={inert}
        >
          <span className="appt-name-row">
            {isTache && <ClipboardList size={14} strokeWidth={1.9} className="appt-task-icon" />}
            <span className="appt-name">
              {isTache
                ? (appt.notes ?? 'Tâche')
                : (appt.client_name ?? appt.address ?? 'Rendez-vous')}
            </span>
            {/* Le statut ne s'affiche que s'il dit quelque chose : « À venir »
                sur chaque RDV était du bruit. Tâche : le bouton « Fait » et
                le titre barré disent déjà tout. */}
            {!isTache && appt.status !== 'a_venir' && (
              <span className="appt-status" style={{ color: meta.color }}>
                <span className="status-dot" style={{ background: meta.color }} />
                {meta.label}
              </span>
            )}
            {!inert && <ChevronRight size={15} strokeWidth={1.9} className="row-chevron" />}
          </span>
          {/* Pas de doublon : sans nom client, l'adresse sert déjà de titre. */}
          {isTache
            ? (appt.client_name || appt.address) && (
                <span className="appt-addr">
                  {[appt.client_name, appt.address].filter(Boolean).join(' · ')}
                </span>
              )
            : appt.client_name && appt.address && <span className="appt-addr">{appt.address}</span>}
          {/* Prénom du commercial seulement si ≠ soi (même règle que les
              notes, retour briac 25/07) — la barre porte déjà sa couleur. */}
          {who && who.id !== profile.id && (
            <span className="appt-owner">{displayName(who)}</span>
          )}
          {/* Les notes sont LE contexte du commercial : toujours visibles.
              Filet neutre = note du RDV, filet accent = note terrain du
              point (masquée si elle répète la note du RDV). Pour une tâche,
              la note est déjà le titre. */}
          {!isTache && appt.notes && <span className="appt-quote">{appt.notes}</span>}
          {appt.point?.notes && appt.point.notes.trim() !== (appt.notes ?? '').trim() && (
            <span className="appt-quote is-context">{appt.point.notes}</span>
          )}
        </button>

        {(appt.client_phone || waze) && (
          <div className="appt-quick">
            {appt.client_phone && (
              <a className="appt-call" href={`tel:${appt.client_phone}`}>
                <Phone size={14} strokeWidth={1.9} /> Appeler
              </a>
            )}
            {waze && (
              <a className="appt-call" href={waze} target="_blank" rel="noopener noreferrer">
                <Navigation size={14} strokeWidth={1.9} /> Itinéraire
              </a>
            )}
          </div>
        )}

        {/* Tâche : un seul contrôle « Fait ✓ » — toggle sans conséquence
            stats (kind filtré partout), donc pas de garde « jour venu ». */}
        {isTache && canAct && (
          <div className="appt-outcomes">
            <button
              type="button"
              className={`outcome-btn task-done-btn ${done ? 'is-done' : ''}`}
              disabled={busy}
              onClick={async () => {
                if (busy) return
                setBusy(true)
                try {
                  await updateAppointment(appt.id, { status: done ? 'a_venir' : 'effectue' })
                  onChanged()
                  toast.success(done ? 'Tâche remise à faire' : 'Tâche faite')
                } catch (e) {
                  console.error('Tâche faite :', e)
                  toast.error('Impossible d’enregistrer — vérifiez le réseau')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Check size={14} strokeWidth={2.4} /> Fait
            </button>
          </div>
        )}

        {/* Issues visibles seulement le jour venu (audit UX A11) : à J-15, un
            tap de scroll raté écrivait des stats fausses. Jamais sur une
            tâche. « En attente » = état OUVERT (29/07 soir) : Vendu / Refus
            restent proposés sans limite de date — même règle que la fiche. */}
        {!isTache && canAct && railOutcomes && (
          <div className="appt-outcomes">
            {railOutcomes.map((o) => {
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
                      toast.success(outcomeToastMessage(o))
                      if (!pointSynced) {
                        toast.error(
                          'La maison n’a pas pu être mise à jour sur la carte — rouvrez sa fiche pour corriger',
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

        {/* RDV annulé : la suite en 1 tap (refonte des issues 29/07) — un
            NOUVEAU RDV pré-rempli, l'annulé reste dans l'historique. */}
        {!isTache && canAct && appt.status === 'annule' && appt.point && onReplan && (
          <div className="appt-outcomes">
            <button type="button" className="outcome-btn" onClick={() => onReplan(appt)}>
              <CalendarPlus size={14} strokeWidth={1.9} /> Replanifier
            </button>
          </div>
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
  onOpenClient: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  onCreate: () => void
  /** Tâche libre pré-datée sur ce jour (29/07) : acompte, panneau… */
  onCreateTask: () => void
  /** RDV annulé → nouveau RDV pré-rempli (refonte des issues 29/07). */
  onReplan: (a: Appointment) => void
  /** Secrétaire : planning en lecture — ni issues ni création. */
  readOnly?: boolean
}

function DaySheet({
  date,
  appts,
  revisits,
  whoById,
  profile,
  onOpenChange,
  onChanged,
  onOpenClient,
  onShowOnMap,
  onCreate,
  onCreateTask,
  onReplan,
  readOnly,
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
                    onOpenClient={onOpenClient}
                    onReplan={onReplan}
                    readOnly={readOnly}
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
                    <span className="home-row-when">À revoir</span>
                  </button>
                ))}
              </>
            )}

            {!readOnly && (
              <div className="drawer-footer">
                {/* Tâche libre (29/07, demande chef des ventes) : même jour,
                    même formulaire — la note devient le titre, hors stats. */}
                <button type="button" className="btn btn-ghost" onClick={onCreateTask}>
                  <ClipboardList size={15} strokeWidth={1.9} /> Tâche
                </button>
                <button type="button" className="btn btn-primary" onClick={onCreate}>
                  <Plus size={15} strokeWidth={2.2} /> RDV ce jour
                </button>
              </div>
            )}
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
  // (pré-datée sur ce jour). `kind` : RDV ou tâche libre (29/07).
  const [creating, setCreating] = useState<{ at: Date | null; kind?: AppointmentKind } | null>(null)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()))
  // Jour ouvert en sheet (refonte 26/07 : le mois plein écran est la vue,
  // le planning du jour s'ouvre par-dessus).
  const [daySheet, setDaySheet] = useState<Date | null>(null)
  // Vue « Contacts » (refonte 27/07) : les prospects encore en jeu — un
  // contact = un POINT « RDV pris » ou « À revoir » (vendu/refus sortent par
  // le statut). ClientSheet reste la fiche du flux RDV (planning du jour).
  const [view, setView] = useState<'agenda' | 'contacts'>('agenda')
  const [clientAppt, setClientAppt] = useState<Appointment | null>(null)
  // « Replanifier » un RDV annulé : nouveau RDV pré-rempli du même point.
  const [replan, setReplan] = useState<Appointment | null>(null)
  const [contacts, setContacts] = useState<MapPoint[]>([])
  const [contactOpen, setContactOpen] = useState<MapPoint | null>(null)
  // Filtre par statut : null = tous, sinon ne montre que ce statut.
  const [contactFilter, setContactFilter] = useState<
    'rdv_pris' | 'a_revoir' | 'ancien_client' | null
  >(null)
  const [clientQuery, setClientQuery] = useState('')
  // Saisie manuelle (bouton « + ») : le formulaire crée point ET RDV en une
  // fois (retour briac 27/07 : plus de second modal qui redemandait tout).
  const [addingContact, setAddingContact] = useState(false)
  // Agenda PARTAGÉ par défaut (décision chef des ventes, 25/07). La chip
  // « Mes RDV » est devenue une LÉGENDE-FILTRE par membre (refonte couleurs,
  // retour Alexis 10/08) : une chip « ● Prénom » par membre — on apprend les
  // couleurs ET on filtre (multi-sélection, vide = tout le monde).
  const [whoFilter, setWhoFilter] = useState<ReadonlySet<string>>(new Set())
  // Secrétaire (étape 4) : l'agenda est TOUTE son app — la sheet « Profil &
  // réglages » (thème, déconnexion) s'ouvre depuis SON en-tête.
  const secretaire = isSecretaireRole(profile?.role)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
    Promise.all([fetchAppointments(), fetchRevisits(), fetchContacts()])
      .then(([a, r, c]) => {
        if (seq !== reloadSeq.current) return
        setAppts(a)
        // Relances ET contacts : chacun les siens, le SUPERVISEUR voit tout
        // (décision briac 27/07 — contacts non partagés). Secrétaire : pas
        // de relances (terrain), mais TOUS les contacts — c'est le standard
        // téléphonique de l'agence (un client appelle, elle le retrouve).
        const mine = <T extends { created_by: string | null }>(rows: T[]) =>
          isSupervisorRole(profile?.role) ? rows : rows.filter((p) => p.created_by === profile?.id)
        setRevisits(isSecretaireRole(profile?.role) ? [] : mine(r))
        setContacts(isSecretaireRole(profile?.role) ? c : mine(c))
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

  // RDV affichés : tous (agenda partagé) ou les membres filtrés.
  const shownAppts = useMemo(
    () =>
      whoFilter.size === 0
        ? appts
        : appts.filter((a) => a.commercial_id !== null && whoFilter.has(a.commercial_id)),
    [appts, whoFilter],
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

  // Regroupe les « à revoir » datés par jour de relance (clé YYYY-MM-DD) —
  // le filtre par membre s'applique aussi (relance = son auteur).
  const revisitsByDay = useMemo(() => {
    const m: Record<string, MapPoint[]> = {}
    for (const p of revisits) {
      if (whoFilter.size > 0 && (p.created_by === null || !whoFilter.has(p.created_by))) continue
      if (p.revisit_at) (m[p.revisit_at] ??= []).push(p)
    }
    return m
  }, [revisits, whoFilter])

  // Prochain RDV « à venir » par point (tolérance 1 h, comme le planning) :
  // sous-titre/tri de la liste Contacts + ligne d'échéance de la fiche.
  const nextRdvByPoint = useMemo(() => {
    const now = Date.now()
    const m: Record<string, Appointment> = {}
    for (const a of appts) {
      if (!a.point_id || a.status !== 'a_venir') continue
      if (Date.parse(a.scheduled_at) < now - 3_600_000) continue
      const cur = m[a.point_id]
      if (!cur || a.scheduled_at < cur.scheduled_at) m[a.point_id] = a
    }
    return m
  }, [appts])

  // Vue « Contacts » : un contact = un point. Filtre statut + recherche,
  // tri par échéance (prochain RDV ou relance, la plus proche d'abord) puis
  // sans-échéance par dernière visite (décision briac 27/07).
  const shownContacts = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    const due = (p: MapPoint): number | null => {
      if (p.status === 'rdv_pris') {
        const rdv = nextRdvByPoint[p.id]
        return rdv ? Date.parse(rdv.scheduled_at) : null
      }
      return p.revisit_at ? Date.parse(p.revisit_at) : null
    }
    return contacts
      // La chip « Client » (valeur ancien_client) matche aussi les points
      // `vendu` — même statut à l'écran (fusion 29/07).
      .filter((p) => (contactFilter ? sameDisplayStatus(p.status, contactFilter) : true))
      .filter(
        (p) =>
          !q ||
          (p.client_name ?? '').toLowerCase().includes(q) ||
          (p.address ?? '').toLowerCase().includes(q),
      )
      .map((p) => ({ p, due: due(p) }))
      .sort((a, b) => {
        if ((a.due === null) !== (b.due === null)) return a.due === null ? 1 : -1
        if (a.due !== null && b.due !== null && a.due !== b.due) return a.due - b.due
        return (b.p.visited_at ?? '').localeCompare(a.p.visited_at ?? '')
      })
  }, [contacts, contactFilter, clientQuery, nextRdvByPoint])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const cells = monthCells(monthDate)
  const today = new Date()
  const monthLabel = capitalize(
    new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthDate),
  )
  const shiftMonth = (delta: number) =>
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1))

  return (
    // Pas d'en-tête « Agenda / + RDV » (retour briac 26/07) : de l'espace
    // perdu — le segmented ouvre l'écran, la création passe par la sheet du
    // jour (« RDV ce jour ») ou par la pose d'un statut « RDV pris ».
    <div className="screen agenda-screen">
      {loadError && (
        <div className="load-error">
          <span>Agenda impossible à charger — vérifiez le réseau.</span>
          <button type="button" className="text-btn" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      <div className="agenda-top">
        <div className="seg">
          {(
            [
              ['agenda', 'Agenda'],
              ['contacts', 'Contacts'],
            ] as ['agenda' | 'contacts', string][]
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
        {/* Secrétaire : pas d'onglet Accueil — thème et déconnexion ici. */}
        {secretaire && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Réglages"
          >
            <Settings size={19} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {view === 'contacts' && (
        <section className="appt-section">
          <div className="contacts-bar">
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
            <button
              type="button"
              className="contacts-add"
              aria-label="Nouveau contact"
              onClick={() => setAddingContact(true)}
            >
              <Plus size={20} strokeWidth={2.2} />
            </button>
          </div>
          {/* Filtre par statut (même patron que la chip « Mes RDV ») :
              re-tap sur la chip active = retour à tous. */}
          <div className="chip-row contacts-filter">
            {(['rdv_pris', 'a_revoir', 'ancien_client'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip ${contactFilter === s ? 'is-active' : ''}`}
                style={{ ['--chip' as string]: STATUS_BY_VALUE[s].color }}
                onClick={() => setContactFilter(contactFilter === s ? null : s)}
              >
                {STATUS_BY_VALUE[s].label}
              </button>
            ))}
          </div>
          <p className="eyebrow section-title">
            {shownContacts.length} contact{shownContacts.length > 1 ? 's' : ''}
          </p>
          {shownContacts.length === 0 ? (
            <div className="empty-state">
              <CalendarClock size={26} strokeWidth={1.5} />
              <p>
                {clientQuery.trim() || contactFilter
                  ? 'Aucun contact ne correspond.'
                  : 'Aucun contact — les points « RDV pris » et « À revoir » apparaîtront ici.'}
              </p>
            </div>
          ) : (
            shownContacts.map(({ p }) => {
              const status = STATUS_BY_VALUE[p.status]
              const rdv = p.status === 'rdv_pris' ? nextRdvByPoint[p.id] : undefined
              return (
                <button
                  key={p.id}
                  type="button"
                  className="home-row"
                  onClick={() => setContactOpen(p)}
                >
                  <span className="status-dot" style={{ background: status.color }} />
                  <span className="home-row-main">
                    <span className="home-row-title">{p.client_name ?? p.address ?? 'Contact'}</span>
                    <span className="home-row-sub">
                      {p.client_name && p.address ? `${p.address} · ` : ''}
                      {status.label}
                    </span>
                  </span>
                  <span className="home-row-when tnum">
                    {rdv ? fmt(rdv.scheduled_at) : p.revisit_at ? fmtDateOnly(p.revisit_at) : ''}
                  </span>
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

        {/* Légende-filtre par membre (refonte couleurs, 10/08) : « ● Prénom »
            dans SA couleur — la légende permanente qui apprend les couleurs,
            et le filtre en un geste (soi = l'ancien « Mes RDV »). Utile à la
            secrétaire aussi (lecture) ; « + Tâche » reste hors de sa portée. */}
        <div className="chip-row agenda-mine">
          {profiles
            .filter((p) => !p.disabled_at && p.role !== 'secretaire')
            .sort((a, b) =>
              a.id === profile.id ? -1 : b.id === profile.id ? 1 : (a.full_name ?? '').localeCompare(b.full_name ?? ''),
            )
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${whoFilter.has(p.id) ? 'is-active' : ''}`}
                style={{ ['--chip' as string]: colorForCommercial(p.id, p.color) }}
                onClick={() =>
                  setWhoFilter((prev) => {
                    const next = new Set(prev)
                    if (next.has(p.id)) next.delete(p.id)
                    else next.add(p.id)
                    return next
                  })
                }
              >
                <span
                  className="status-dot"
                  style={{ background: colorForCommercial(p.id, p.color) }}
                />
                {p.id === profile.id ? 'Moi' : displayName(p)}
              </button>
            ))}
          {!secretaire && (
            /* Tâche en 1 tap depuis le mois (retour briac 29/07) : sans passer
               par un jour — le formulaire propose la prochaine heure ronde. */
            <button
              type="button"
              className="chip agenda-add-task"
              onClick={() => setCreating({ at: null, kind: 'tache' })}
            >
              <Plus size={14} strokeWidth={2.2} /> Tâche
            </button>
          )}
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
              // un agenda partagé, « qui a ce RDV » prime. Le TYPE se lit par
              // la pastille en tête de pilule (refonte couleurs, retour
              // Alexis 10/08 — mêmes couleurs sémantiques que la carte) :
              // ● bleu = RDV à venir, ● ambre = à revoir, ● vert = vendu…
              // carré blanc = tâche. Les relances prennent ENFIN la couleur
              // de leur commercial (l'ambre uniforme semblait un 6e membre).
              ...dayAppts.map((a) => ({
                // Tâche : l'objet (« récupérer l'acompte ») EST le titre ;
                // faite = estompée (le mois montre ce qui RESTE à faire).
                label:
                  a.kind === 'tache'
                    ? (a.notes ?? 'Tâche')
                    : (a.client_name ?? a.address ?? 'RDV'),
                color: a.commercial_id
                  ? colorForCommercial(a.commercial_id, whoById[a.commercial_id]?.color)
                  : '#98a2b3',
                done: a.kind === 'tache' && a.status === 'effectue',
                task: a.kind === 'tache',
                dot: a.kind === 'tache' ? null : APPOINTMENT_STATUS_META[a.status].color,
              })),
              ...dayRevisits.map((p) => ({
                label: p.client_name ?? p.address ?? 'À revoir',
                color: p.created_by
                  ? colorForCommercial(p.created_by, whoById[p.created_by]?.color)
                  : '#98a2b3',
                done: false,
                task: false,
                dot: STATUS_BY_VALUE.a_revoir.color,
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
                    <span
                      key={i}
                      className={`cal-event ${it.done ? 'is-done' : ''}`}
                      style={{ background: it.color }}
                    >
                      {it.task ? (
                        <span className="cal-dot is-task" />
                      ) : (
                        it.dot && <span className="cal-dot" style={{ background: it.dot }} />
                      )}
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
          readOnly={secretaire}
          onOpenChange={(o) => !o && setDaySheet(null)}
          onChanged={reload}
          onOpenClient={(a) => {
            setDaySheet(null)
            // Tâche ou RDV libre SANS point (créé à la main dans l'agenda) :
            // pas de fiche du point possible — le tap ouvre l'édition.
            if (a.kind === 'tache' || !a.point) setEditing(a)
            else setClientAppt(a)
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
          onCreateTask={() => {
            const at = new Date(daySheet)
            at.setHours(9, 0, 0, 0)
            setDaySheet(null)
            setCreating({ at, kind: 'tache' })
          }}
          onReplan={(a) => {
            setDaySheet(null)
            setReplan(a)
          }}
        />
      )}

      {/* LA fiche du point, identique à la carte (convergence 29/07) —
          depuis le planning du jour (RDV lié) comme depuis Contacts. Elle
          monte elle-même le formulaire RDV (Modifier / Planifier / + RDV). */}
      {clientAppt?.point && (
        <PointSheet
          pointId={clientAppt.point.id}
          profile={profile}
          onOpenChange={(o) => !o && setClientAppt(null)}
          onShowOnMap={onShowOnMap}
          onChanged={reload}
        />
      )}

      {contactOpen && (
        <PointSheet
          pointId={contactOpen.id}
          initial={contactOpen}
          profile={profile}
          onOpenChange={(o) => !o && setContactOpen(null)}
          onShowOnMap={onShowOnMap}
          onChanged={reload}
        />
      )}

      {/* « Replanifier » (rail du jour) : création pré-remplie du même
          point — le RDV annulé reste dans l'historique. */}
      {replan?.point && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setReplan(null)}
          profile={profile}
          pointId={replan.point.id}
          coords={{ lng: replan.point.lng, lat: replan.point.lat }}
          pointNote={replan.point.notes}
          defaultClientName={replan.client_name}
          defaultClientPhone={replan.client_phone}
          onSaved={() => {
            setReplan(null)
            reload()
          }}
        />
      )}

      {secretaire && <ProfileSheet open={settingsOpen} onOpenChange={setSettingsOpen} />}

      {addingContact && (
        <ContactForm
          profile={profile}
          onOpenChange={(o) => !o && setAddingContact(false)}
          onShowOnMap={onShowOnMap}
          onCreated={() => {
            setAddingContact(false)
            reload()
          }}
        />
      )}

      {creating && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setCreating(null)}
          profile={profile}
          defaultAt={creating.at}
          kind={creating.kind}
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
