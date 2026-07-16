import { supabase } from '../lib/supabase'
import type { Profile } from '../domain/types'
import type { Appointment, AppointmentStatus } from '../domain/appointments'

const COLS =
  'id, point_id, commercial_id, scheduled_at, address, client_name, client_phone, status, notes'

export interface NewAppointment {
  point_id?: string | null
  scheduled_at: string
  address?: string | null
  client_name?: string | null
  client_phone?: string | null
  notes?: string | null
}

export async function fetchAppointments(): Promise<Appointment[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('appointments').select(COLS).order('scheduled_at')
  if (error) throw error
  return (data ?? []) as Appointment[]
}

export async function createAppointment(
  profile: Profile,
  appt: NewAppointment,
): Promise<Appointment> {
  if (!supabase) throw new Error('Supabase non configuré')
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      commercial_id: profile.id,
      point_id: appt.point_id ?? null,
      scheduled_at: appt.scheduled_at,
      address: appt.address ?? null,
      client_name: appt.client_name ?? null,
      client_phone: appt.client_phone ?? null,
      notes: appt.notes ?? null,
      status: 'a_venir',
    })
    .select(COLS)
    .single()
  if (error) throw error
  return data as Appointment
}

export async function updateAppointment(
  id: string,
  changes: Partial<Pick<Appointment, 'scheduled_at' | 'client_name' | 'client_phone' | 'address' | 'notes' | 'status'>>,
): Promise<Appointment> {
  if (!supabase) throw new Error('Supabase non configuré')
  const { data, error } = await supabase.from('appointments').update(changes).eq('id', id).select(COLS).single()
  if (error) throw error
  return data as Appointment
}

export async function deleteAppointment(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) throw error
}

/**
 * Donne une issue à un RDV. Si "vendu", bascule aussi le point lié en "vendu"
 * sur la carte (+ journal), pour garder carte et agenda cohérents.
 */
export async function setAppointmentOutcome(
  profile: Profile,
  appt: Appointment,
  outcome: AppointmentStatus,
): Promise<Appointment> {
  const updated = await updateAppointment(appt.id, { status: outcome })
  if (outcome === 'vendu' && appt.point_id && supabase) {
    const { error } = await supabase.from('points').update({ status: 'vendu' }).eq('id', appt.point_id)
    if (!error) {
      await supabase.from('point_events').insert({
        organization_id: profile.organization_id,
        point_id: appt.point_id,
        author_id: profile.id,
        status: 'vendu',
      })
    }
  }
  return updated
}

export function subscribeAppointments(reload: () => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('appointments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => reload())
    .subscribe()
  return () => {
    supabase?.removeChannel(channel)
  }
}
