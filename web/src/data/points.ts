import { supabase } from '../lib/supabase'
import type { MapPoint, Profile } from '../domain/types'
import type { PointStatus } from '../domain/status'

const COLS = 'id, lng, lat, status, notes, client_name, address, revisit_at'

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
    note: (r.notes as string | null) ?? null,
    client_name: (r.client_name as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    revisit_at: (r.revisit_at as string | null) ?? null,
  }
}

/** Adresse la plus proche (géocodage inverse BAN). */
async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/reverse/?lon=${lng}&lat=${lat}`)
    const j = (await r.json()) as { features?: { properties?: { label?: string } }[] }
    return j.features?.[0]?.properties?.label ?? null
  } catch {
    return null
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
  note?: string | null,
): Promise<MapPoint> {
  if (!supabase) throw new Error('Supabase non configuré')

  const { data, error } = await supabase
    .from('points')
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      status,
      lat,
      lng,
      notes: note ?? null,
    })
    .select(COLS)
    .single()
  if (error) throw error

  const point = rowToPoint(data as Record<string, unknown>)
  await logEvent(profile, point.id, status, note)
  // Adresse en arrière-plan (n'attend pas : la pose doit rester instantanée).
  // Le temps réel propage la mise à jour à tous les clients.
  void reverseGeocode(lng, lat).then((label) => {
    if (label && supabase) {
      void supabase.from('points').update({ address: label }).eq('id', point.id)
    }
  })
  return point
}

/** Met à jour le statut et/ou la note d'un point. Journalise si le statut change. */
export async function updatePoint(
  profile: Profile,
  id: string,
  changes: {
    status?: PointStatus
    note?: string | null
    client_name?: string | null
    revisit_at?: string | null
  },
): Promise<MapPoint> {
  if (!supabase) throw new Error('Supabase non configuré')

  const patch: Record<string, unknown> = {}
  if (changes.status !== undefined) patch.status = changes.status
  if (changes.note !== undefined) patch.notes = changes.note
  if (changes.client_name !== undefined) patch.client_name = changes.client_name
  if (changes.revisit_at !== undefined) patch.revisit_at = changes.revisit_at

  const { data, error } = await supabase.from('points').update(patch).eq('id', id).select(COLS).single()
  if (error) throw error

  if (changes.status !== undefined) await logEvent(profile, id, changes.status, changes.note)
  return rowToPoint(data as Record<string, unknown>)
}

/** Supprime un point (le journal lié est supprimé en cascade). */
export async function deletePoint(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('points').delete().eq('id', id)
  if (error) throw error
}

/** Points « à revoir » dont la date de relance est atteinte ou dépassée. */
export async function fetchRelances(): Promise<MapPoint[]> {
  if (!supabase) return []
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('points')
    .select(COLS)
    .eq('status', 'a_revoir')
    .not('revisit_at', 'is', null)
    .lte('revisit_at', today)
    .order('revisit_at')
  if (error) throw error
  return (data ?? []).map(rowToPoint)
}

/** Une entrée du journal de notes d'une maison (table point_notes). */
export interface PointNote {
  id: string
  body: string
  created_at: string
  author_name: string | null
}

/** Journal de notes d'un point, la plus récente en premier. */
export async function fetchPointNotes(pointId: string): Promise<PointNote[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('point_notes')
    .select('id, body, created_at, author:profiles(full_name)')
    .eq('point_id', pointId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    body: r.body as string,
    created_at: r.created_at as string,
    author_name: (r.author as { full_name: string | null } | null)?.full_name ?? null,
  }))
}

/**
 * Ajoute une note au journal de la maison, et rafraîchit `points.notes`
 * (dernière note, dénormalisée : pastille carte + bloc contexte agenda).
 */
export async function addPointNote(profile: Profile, pointId: string, body: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('point_notes').insert({
    organization_id: profile.organization_id,
    point_id: pointId,
    author_id: profile.id,
    body,
  })
  if (error) throw error
  // Peut échouer en silence si le point appartient à un autre commercial
  // (RLS update = auteur/manager) : la note du journal, elle, est enregistrée.
  await supabase.from('points').update({ notes: body }).eq('id', pointId)
}

/** Synchronise le nom du client sur le point (depuis le formulaire RDV). */
export async function setPointClientName(pointId: string, clientName: string | null): Promise<void> {
  if (!supabase) return
  await supabase.from('points').update({ client_name: clientName }).eq('id', pointId)
}

async function logEvent(profile: Profile, pointId: string, status: PointStatus, note?: string | null) {
  if (!supabase) return
  const { error } = await supabase.from('point_events').insert({
    organization_id: profile.organization_id,
    point_id: pointId,
    author_id: profile.id,
    status,
    note: note ?? null,
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
