export type AppointmentStatus = 'a_venir' | 'effectue' | 'vendu' | 'manque' | 'annule'

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
}

export interface AppointmentStatusMeta {
  value: AppointmentStatus
  label: string
  color: string
}

export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, AppointmentStatusMeta> = {
  a_venir: { value: 'a_venir', label: 'À venir', color: '#2f6bff' },
  effectue: { value: 'effectue', label: 'Effectué', color: '#12b3a6' },
  vendu: { value: 'vendu', label: 'Vendu', color: '#17b26a' },
  manque: { value: 'manque', label: 'Manqué', color: '#e5484d' },
  annule: { value: 'annule', label: 'Annulé', color: '#98a2b3' },
}

/** Issues qu'un commercial peut donner à un RDV planifié. */
export const APPOINTMENT_OUTCOMES: AppointmentStatus[] = ['vendu', 'effectue', 'manque', 'annule']
