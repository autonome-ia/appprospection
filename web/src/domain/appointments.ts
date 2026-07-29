export type AppointmentStatus = 'a_venir' | 'effectue' | 'vendu' | 'manque' | 'annule' | 'refus'

/** Nature de l'entrée d'agenda (db/0016) : RDV de prospection, ou TÂCHE
    libre (« aller chercher l'acompte ») — datée, sans point sur la carte,
    sans issues, exclue des stats. Sa note est son titre. */
export type AppointmentKind = 'rdv' | 'tache'

export interface Appointment {
  id: string
  point_id: string | null
  commercial_id: string | null
  scheduled_at: string
  address: string | null
  client_name: string | null
  client_phone: string | null
  status: AppointmentStatus
  notes: string | null
  kind: AppointmentKind
  /** Point lié (jointure PostgREST) : contexte terrain + accès carte. */
  point: { id: string; lng: number; lat: number; notes: string | null } | null
}

export interface AppointmentStatusMeta {
  value: AppointmentStatus
  label: string
  color: string
}

// Refonte des issues (29/07 soir, briac) : chaque issue = une réalité
// terrain + une CONSÉQUENCE sur le point (voir setAppointmentOutcome) —
// « Vendu » → Client, « En attente » (ex-Effectué : le prospect réfléchit)
// → À revoir + relance J+7, « Refus » (db/0017) → Refus, « Annulé » (RDV
// pas eu lieu) → Replanifier. « Manqué » retiré des boutons (client absent
// = annulé, on replanifie) — la valeur reste pour l'historique.
export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, AppointmentStatusMeta> = {
  a_venir: { value: 'a_venir', label: 'À venir', color: '#2f6bff' },
  effectue: { value: 'effectue', label: 'En attente', color: '#d97706' },
  vendu: { value: 'vendu', label: 'Vendu', color: '#17b26a' },
  manque: { value: 'manque', label: 'Manqué', color: '#e5484d' },
  annule: { value: 'annule', label: 'Annulé', color: '#98a2b3' },
  refus: { value: 'refus', label: 'Refus', color: '#344054' },
}

/** Issues qu'un commercial peut donner à un RDV planifié. */
export const APPOINTMENT_OUTCOMES: AppointmentStatus[] = ['vendu', 'effectue', 'refus', 'annule']

/** Confirmation d'une issue : dire la CONSÉQUENCE, pas répéter le bouton. */
export function outcomeToastMessage(outcome: AppointmentStatus): string {
  switch (outcome) {
    case 'vendu':
      return 'Vendu — la maison passe en « Client »'
    case 'effectue':
      return 'En attente — la maison passe en « À revoir », relance dans 7 jours'
    case 'refus':
      return 'La maison passe en « Refus »'
    case 'annule':
      return 'RDV annulé — replanifiez quand vous voulez'
    default:
      return `RDV marqué « ${APPOINTMENT_STATUS_META[outcome].label} »`
  }
}
