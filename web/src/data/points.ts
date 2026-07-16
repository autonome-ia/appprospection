import { supabase } from '../lib/supabase'
import type { MapPoint, Profile } from '../domain/types'
import type { PointStatus } from '../domain/status'

const COLS = 'id, lng, lat, status'

/** Détail complet d'un point (panneau au clic). */
export interface PointDetail extends MapPoint {
  note: string | null
  created_at: string
  author_name: string | null
}

function rowToPoint(r: Record<string, unknown>): MapPoint {
  return {
    id: r.id as string,
    lng: r.lng as number,
    lat: r.lat as number,
    status: r.status as PointStatus,
  }
}

/** Charge tous les points visibles (RLS = ceux de l'organisation de l'utilisateur). */
export async function fetchPoints(): Promise<MapPoint[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('points').select(COLS)
  if (error) throw error
  return (data ?? []).map(rowToPoint)
}

/** Détail d'un point + nom de l'auteur (2 requêtes, robuste sans jointure implicite). */
export async function getPointDetail(id: string): Promise<PointDetail | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('points')
    .select('id, lng, lat, status, notes, created_at, created_by')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const d = data as Record<string, unknown>
  let authorName: string | null = null
  if (d.created_by) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', d.created_by as string)
      .maybeSingle()
    authorName = (prof?.full_name as string | null) ?? null
  }

  return {
    ...rowToPoint(d),
    note: (d.notes as string | null) ?? null,
    created_at: d.created_at as string,
    author_name: authorName,
  }
}

/** Insère un point + une ligne de journal (point_events) pour les statistiques. */
export async function insertPoint(
  profile: Profile,
  lng: number,
  lat: number,
  status: PointStatus,
): Promise<MapPoint> {
  if (!supabase) throw new Error('Supabase non configuré')

  const { data, error } = await supabase
    .from('points')
    .insert({ organization_id: profile.organization_id, created_by: profile.id, status, lat, lng })
    .select(COLS)
    .single()
  if (error) throw error

  const point = rowToPoint(data as Record<string, unknown>)
  await logEvent(profile, point.id, status)
  return point
}

/** Met à jour le statut et/ou la note d'un point. Journalise si le statut change. */
export async function updatePoint(
  profile: Profile,
  id: string,
  changes: { status?: PointStatus; note?: string | null },
): Promise<MapPoint> {
  if (!supabase) throw new Error('Supabase non configuré')

  const patch: Record<string, unknown> = {}
  if (changes.status !== undefined) patch.status = changes.status
  if (changes.note !== undefined) patch.notes = changes.note

  const { data, error } = await supabase.from('points').update(patch).eq('id', id).select(COLS).single()
  if (error) throw error

  if (changes.status !== undefined) await logEvent(profile, id, changes.status)
  return rowToPoint(data as Record<string, unknown>)
}

/** Supprime un point (le journal lié est supprimé en cascade). */
export async function deletePoint(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('points').delete().eq('id', id)
  if (error) throw error
}

async function logEvent(profile: Profile, pointId: string, status: PointStatus) {
  if (!supabase) return
  const { error } = await supabase.from('point_events').insert({
    organization_id: profile.organization_id,
    point_id: pointId,
    author_id: profile.id,
    status,
  })
  if (error) console.error('Journal (point_events) :', error.message)
}

interface RealtimeHandlers {
  onInsert?: (point: MapPoint) => void
  onUpdate?: (point: MapPoint) => void
  onDelete?: (id: string) => void
}

/** Abonnement temps réel aux points de l'équipe (INSERT / UPDATE / DELETE). */
export function subscribePoints(handlers: RealtimeHandlers): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('points-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'points' }, (p) =>
      handlers.onInsert?.(rowToPoint(p.new as Record<string, unknown>)),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'points' }, (p) =>
      handlers.onUpdate?.(rowToPoint(p.new as Record<string, unknown>)),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'points' }, (p) =>
      handlers.onDelete?.((p.old as Record<string, unknown>).id as string),
    )
    .subscribe()
  return () => {
    supabase?.removeChannel(channel)
  }
}
