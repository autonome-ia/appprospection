import { supabase } from '../lib/supabase'
import type { Profile } from '../domain/types'
import type { Appointment, AppointmentStatus } from '../domain/appointments'

// `point:points(...)` = jointure PostgREST sur le point lié : contexte
// terrain (note de la maison) + coordonnées pour « Voir sur la carte ».
const COLS =
  'id, point_id, commercial_id, scheduled_at, address, client_name, client_phone, status, notes, point:points(id, lng, lat, notes)'

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
  // Supabase tronque silencieusement à 1 000 lignes, et le tri ASCENDANT
  // faisait disparaître précisément les RDV À VENIR dès que l'équipe cumulait
  // 1 000 RDV (audit) : on pagine, comme fetchPoints.
  const PAGE = 1000
  const all: Appointment[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('appointments')
      .select(COLS)
      .order('scheduled_at')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    // Cast via unknown : l'embed `point` est typé tableau par le client (FK
    // inconnu sans types générés) mais PostgREST renvoie un objet (many-to-one).
    all.push(...(rows as unknown as Appointment[]))
    if (rows.length < PAGE) return all
  }
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
  return data as unknown as Appointment
}

export async function updateAppointment(
  id: string,
  changes: Partial<Pick<Appointment, 'scheduled_at' | 'client_name' | 'client_phone' | 'address' | 'notes' | 'status'>>,
): Promise<Appointment> {
  if (!supabase) throw new Error('Supabase non configuré')
  const { data, error } = await supabase.from('appointments').update(changes).eq('id', id).select(COLS).single()
  if (error) throw error
  return data as unknown as Appointment
}

export async function deleteAppointment(id: string): Promise<void> {
  if (!supabase) return
  // .select() : un DELETE bloqué par la RLS (RDV d'un collègue, non manager)
  // touche 0 ligne SANS erreur — l'app affichait « RDV supprimé » à tort.
  const { data, error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Suppression refusée (RDV d’un autre commercial)')
}

/**
 * Donne une issue à un RDV. Si "vendu", bascule aussi le point lié en "vendu"
 * sur la carte (+ journal), pour garder carte et agenda cohérents.
 */
export async function setAppointmentOutcome(
  profile: Profile,
  appt: Appointment,
  outcome: AppointmentStatus,
): Promise<{ appointment: Appointment; pointSynced: boolean }> {
  const updated = await updateAppointment(appt.id, { status: outcome })
  let pointSynced = true
  if (outcome === 'vendu' && appt.point_id && supabase) {
    // .select() : la RLS (point d'un collègue) filtre 0 ligne SANS erreur —
    // le point restait « rdv_pris » sur la carte de toute l'équipe alors que
    // le RDV était vendu (audit). L'échec est désormais remonté à l'UI.
    const { data, error } = await supabase
      .from('points')
      .update({ status: 'vendu', visited_at: new Date().toISOString() })
      .eq('id', appt.point_id)
      .select('id')
    if (error || !data?.length) {
      pointSynced = false
      console.error('Bascule du point en vendu :', error?.message ?? 'refusée (RLS)')
    }
    // Journalisé même si la bascule carte a échoué : la VENTE doit compter
    // dans les stats (le RDV, lui, est bien vendu).
    const { error: e2 } = await supabase.from('point_events').insert({
      organization_id: profile.organization_id,
      point_id: appt.point_id,
      author_id: profile.id,
      status: 'vendu',
    })
    if (e2) {
      pointSynced = false
      console.error('Journal de la vente :', e2.message)
    }
  }
  return { appointment: updated, pointSynced }
}

/** Abonnement temps réel aux RDV. `onStatus` : re-SUBSCRIBED après une
    coupure (veille iOS) = événements perdus → l'appelant doit recharger. */
let apptsChannelSeq = 0

export function subscribeAppointments(
  reload: () => void,
  onStatus?: (status: string) => void,
): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`appointments-changes-${++apptsChannelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => reload())
    .subscribe((status) => onStatus?.(status))
  return () => {
    supabase?.removeChannel(channel)
  }
}
