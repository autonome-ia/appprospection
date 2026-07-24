import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Phone, Pencil, Trash2, CalendarClock, ChevronLeft, ChevronRight, StickyNote, MapPin } from 'lucide-react'
import {
  fetchAppointments,
  deleteAppointment,
  setAppointmentOutcome,
  subscribeAppointments,
} from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { fetchRevisits } from '../data/points'
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

interface CardProps {
  appt: Appointment
  who: OrgProfile | undefined
  profile: Profile
  onChanged: () => void
  onEdit: (a: Appointment) => void
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
  timeOnly?: boolean
}

function AppointmentCard({ appt, who, profile, onChanged, onEdit, onShowOnMap, timeOnly }: CardProps) {
  const meta = APPOINTMENT_STATUS_META[appt.status]
  const color = who ? colorForCommercial(who.id, who.color) : '#98a2b3'

  return (
    <div className="appt-card">
      <div className="appt-row">
        <span className="appt-when tnum">{fmt(appt.scheduled_at, timeOnly)}</span>
        <span className="badge" style={{ color: meta.color, background: `${meta.color}1a` }}>
          {meta.label}
        </span>
      </div>

      {appt.client_name && <div className="appt-client">{appt.client_name}</div>}
      {appt.address && (
        <a
          className="appt-address is-nav"
          href={wazeUrl(appt.point, appt.address)!}
          target="_blank"
          rel="noopener noreferrer"
          title="Itinéraire en voiture (Waze)"
        >
          {appt.address}
        </a>
      )}

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
          {who?.full_name ?? 'Commercial'}
        </span>
        {appt.client_phone && (
          <a className="appt-call" href={`tel:${appt.client_phone}`}>
            <Phone size={14} strokeWidth={1.9} /> Appeler
          </a>
        )}
      </div>

      {appt.status === 'a_venir' && (
        <div className="appt-outcomes">
          {APPOINTMENT_OUTCOMES.map((o) => {
            const m = APPOINTMENT_STATUS_META[o]
            return (
              <button
                key={o}
                type="button"
                className="outcome-btn"
                style={{ color: m.color, borderColor: `${m.color}55` }}
                onClick={async () => {
                  await setAppointmentOutcome(profile, appt, o)
                  onChanged()
                  toast.success(`RDV marqué « ${m.label} »`)
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
        <button
          type="button"
          className="text-btn danger"
          onClick={async () => {
            if (!window.confirm('Supprimer ce RDV ?')) return
            await deleteAppointment(appt.id)
            onChanged()
            toast('RDV supprimé')
          }}
        >
          <Trash2 size={14} strokeWidth={1.8} /> Supprimer
        </button>
      </div>
    </div>
  )
}

// --- Utilitaires de date (heure locale) ---
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

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
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => new Date())
  // Vue « Clients » : une ligne par client (RDV pris), tap -> fiche complète.
  const [view, setView] = useState<'agenda' | 'clients'>('agenda')
  const [clientAppt, setClientAppt] = useState<Appointment | null>(null)

  const reload = useCallback(() => {
    fetchAppointments().then(setAppts).catch((e) => console.error('Agenda :', e))
    fetchRevisits().then(setRevisits).catch((e) => console.error('Relances :', e))
  }, [])

  useEffect(() => {
    reload()
    fetchOrgProfiles().then(setProfiles).catch((e) => console.error('Profils :', e))
    const unsub = subscribeAppointments(reload)
    return unsub
  }, [reload])

  const whoById = useMemo(() => {
    const m: Record<string, OrgProfile> = {}
    profiles.forEach((p) => (m[p.id] = p))
    return m
  }, [profiles])

  // Regroupe les RDV par jour.
  const byDay = useMemo(() => {
    const m: Record<string, Appointment[]> = {}
    for (const a of appts) {
      const k = dateKey(new Date(a.scheduled_at))
      ;(m[k] ??= []).push(a)
    }
    return m
  }, [appts])

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
      const key =
        a.client_name?.trim().toLowerCase() || a.address?.trim().toLowerCase() || a.id
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
    return reps.sort((a, b) => {
      if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1
      return a.upcoming
        ? a.rep.scheduled_at.localeCompare(b.rep.scheduled_at)
        : b.rep.scheduled_at.localeCompare(a.rep.scheduled_at)
    })
  }, [appts])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const cells = monthCells(monthDate)
  const today = new Date()
  const selectedAppts = (byDay[dateKey(selected)] ?? []).sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  )
  const selectedRevisits = revisitsByDay[dateKey(selected)] ?? []
  const monthLabel = capitalize(
    new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthDate),
  )
  const dayLabel = capitalize(
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(selected),
  )
  const shiftMonth = (delta: number) =>
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1))

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Agenda</h2>
        <button type="button" className="head-action" onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={2.2} /> RDV
        </button>
      </header>

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
          <p className="eyebrow section-title">
            {clients.length} client{clients.length > 1 ? 's' : ''}
          </p>
          {clients.length === 0 ? (
            <div className="empty-state">
              <CalendarClock size={26} strokeWidth={1.5} />
              <p>Aucun rendez-vous pris pour l’instant.</p>
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
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Mois précédent">
            <ChevronLeft size={18} />
          </button>
          <span className="cal-month">{monthLabel}</span>
          <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Mois suivant">
            <ChevronRight size={18} />
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
              ...dayAppts.map((a) => ({
                label: a.client_name ?? a.address ?? 'RDV',
                color: APPOINTMENT_STATUS_META[a.status].color,
              })),
              ...dayRevisits.map((p) => ({
                label: p.client_name ?? p.address ?? 'À revoir',
                color: STATUS_BY_VALUE.a_revoir.color,
              })),
            ]
            const shown = items.slice(0, 4)
            const extra = items.length - shown.length
            const out = d.getMonth() !== monthDate.getMonth()
            const isSel = sameDay(d, selected)
            const isToday = sameDay(d, today)
            return (
              <button
                key={dateKey(d)}
                type="button"
                className={`cal-cell ${out ? 'is-out' : ''} ${isSel ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => {
                  setSelected(d)
                  if (out) setMonthDate(startOfMonth(d))
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

      <section className="appt-section">
        <p className="eyebrow section-title">
          {dayLabel} · {selectedAppts.length} RDV
          {selectedRevisits.length > 0 && ` · ${selectedRevisits.length} à revoir`}
        </p>
        {selectedAppts.length === 0 && selectedRevisits.length === 0 ? (
          <div className="empty-state">
            <CalendarClock size={26} strokeWidth={1.5} />
            <p>Aucun rendez-vous ce jour.</p>
          </div>
        ) : (
          <>
            {selectedAppts.map((a) => (
              <AppointmentCard
                key={a.id}
                appt={a}
                who={a.commercial_id ? whoById[a.commercial_id] : undefined}
                profile={profile}
                onChanged={reload}
                onEdit={setEditing}
                onShowOnMap={onShowOnMap}
                timeOnly
              />
            ))}
            {/* Maisons « à revoir » planifiées ce jour (pas des RDV : un tap
                ouvre la fiche sur la carte). */}
            {selectedRevisits.map((p) => (
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
      </section>
      </>
      )}

      {clientAppt && (
        <ClientSheet
          appt={clientAppt}
          onOpenChange={(o) => !o && setClientAppt(null)}
          onEdit={(a) => {
            setClientAppt(null)
            setEditing(a)
          }}
          onShowOnMap={onShowOnMap}
        />
      )}

      {creating && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setCreating(false)}
          profile={profile}
          onSaved={() => {
            setCreating(false)
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
