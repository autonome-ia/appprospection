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
import { AppointmentForm } from './AppointmentForm'
import { APPOINTMENT_STATUS_META, APPOINTMENT_OUTCOMES, type Appointment } from '../domain/appointments'
import { colorForCommercial } from '../domain/colors'
import type { Profile } from '../domain/types'

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
  const [profiles, setProfiles] = useState<OrgProfile[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => new Date())

  const reload = useCallback(() => {
    fetchAppointments().then(setAppts).catch((e) => console.error('Agenda :', e))
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

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const cells = monthCells(monthDate)
  const today = new Date()
  const selectedAppts = (byDay[dateKey(selected)] ?? []).sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  )
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
            const dayAppts = byDay[dateKey(d)] ?? []
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
                <span className="cal-dots">
                  {dayAppts.slice(0, 3).map((a) => (
                    <span
                      key={a.id}
                      className="cal-dot"
                      style={{ background: APPOINTMENT_STATUS_META[a.status].color }}
                    />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <section className="appt-section">
        <p className="eyebrow section-title">
          {dayLabel} · {selectedAppts.length} RDV
        </p>
        {selectedAppts.length === 0 ? (
          <div className="empty-state">
            <CalendarClock size={26} strokeWidth={1.5} />
            <p>Aucun rendez-vous ce jour.</p>
          </div>
        ) : (
          selectedAppts.map((a) => (
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
          ))
        )}
      </section>

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
