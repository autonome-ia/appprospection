import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { CalendarClock, X } from 'lucide-react'
import { fetchPendingOutcomes, setAppointmentOutcome } from '../data/appointments'
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_STATUS_META,
  outcomeToastMessage,
  type Appointment,
} from '../domain/appointments'
import { localDayKey } from '../data/points'
import type { Profile } from '../domain/types'

// -----------------------------------------------------------------------------
// Popup du matin (30/07, briac + chef des ventes) : à la PREMIÈRE ouverture
// du jour, si des RDV passés n'ont pas d'issue, une sheet demande « que
// s'est-il passé ? » — les 4 issues en 1 tap par RDV. Deux buts : des stats
// jamais trouées (chaque RDV finit soldé), et grâce à la datation au jour du
// RDV (setAppointmentOutcome), la vente d'hier soir soldée ce matin compte
// HIER. Jamais bloquant : « Plus tard », ça revient demain matin.
// -----------------------------------------------------------------------------

const DAY_KEY = 'rdv-solder-jour'

const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`
}

export function PendingOutcomes({ profile }: { profile: Profile }) {
  const [list, setList] = useState<Appointment[]>([])
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    // `?popup-rdv` : ouverture forcée pour les sondes dédiées.
    const force = window.location.search.includes('popup-rdv')
    if (!force) {
      // Jamais pendant les sondes Playwright (elles ouvrent l'app des
      // dizaines de fois par jour — le popup casserait chaque capture).
      if (navigator.webdriver) return
      // Une fois par jour : marqué comme vu dès l'affichage — « Plus tard »
      // le fait revenir demain matin, pas dans une heure.
      try {
        if (localStorage.getItem(DAY_KEY) === localDayKey(new Date())) return
      } catch {
        /* stockage indisponible : on tente l'affichage */
      }
    }
    let active = true
    fetchPendingOutcomes(profile.id)
      .then((as) => {
        if (!active || as.length === 0) return
        setList(as)
        setOpen(true)
        if (!force) {
          try {
            localStorage.setItem(DAY_KEY, localDayKey(new Date()))
          } catch {
            /* au pire, re-proposé à la prochaine ouverture */
          }
        }
      })
      .catch((e) => console.error('RDV à solder :', e))
    return () => {
      active = false
    }
  }, [profile.id])

  if (!open || list.length === 0) return null

  return (
    // repositionInputs={false} : gabarit commun des sheets (bug iOS).
    <Drawer.Root open onOpenChange={(o) => !o && setOpen(false)} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">Que s’est-il passé ?</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
            <p className="pending-intro">
              {list.length > 1
                ? `${list.length} RDV passés attendent leur issue — les stats sont datées du jour du RDV.`
                : 'Un RDV passé attend son issue — les stats sont datées du jour du RDV.'}
            </p>

            {list.map((a) => (
              <div key={a.id} className="pending-rdv">
                <span className="pending-when">
                  <CalendarClock size={14} strokeWidth={2} />
                  <span className="tnum">{fmtWhen(a.scheduled_at)}</span>
                </span>
                <span className="pending-title">
                  {a.client_name ?? a.address ?? 'Rendez-vous'}
                </span>
                {a.client_name && a.address && <span className="pending-sub">{a.address}</span>}
                <div className="appt-outcomes">
                  {APPOINTMENT_OUTCOMES.map((o) => {
                    const m = APPOINTMENT_STATUS_META[o]
                    return (
                      <button
                        key={o}
                        type="button"
                        className="outcome-btn"
                        style={{ color: m.color, borderColor: `${m.color}55` }}
                        disabled={busyId === a.id}
                        onClick={async () => {
                          if (busyId) return
                          setBusyId(a.id)
                          try {
                            const { pointSynced } = await setAppointmentOutcome(profile, a, o)
                            toast.success(outcomeToastMessage(o))
                            if (!pointSynced) {
                              toast.error(
                                'La maison n’a pas pu être mise à jour sur la carte — rouvrez sa fiche pour corriger',
                              )
                            }
                            setList((prev) => {
                              const next = prev.filter((x) => x.id !== a.id)
                              if (next.length === 0) setOpen(false)
                              return next
                            })
                          } catch (e) {
                            console.error('Issue du RDV :', e)
                            toast.error('Issue non enregistrée — vérifiez le réseau')
                          } finally {
                            setBusyId(null)
                          }
                        }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="drawer-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Plus tard
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
