import { supabase } from '../lib/supabase'
import type { Profile } from '../domain/types'
import type { Appointment, AppointmentStatus } from '../domain/appointments'

// `point:points(...)` = jointure PostgREST sur le point lié : contexte
// terrain (note de la maison) + coordonnées pour « Voir sur la carte ».
const COLS =
  'id, point_id, commercial_id, scheduled_at, address, client_name, client_phone, status, notes, kind, point:points(id, lng, lat, notes)'
// Migration db/0016 (colonne kind) pas encore passée : repli sans la colonne
// (tout est alors un RDV) plutôt qu'un agenda cassé — même filet que
// fetchContacts pour db/0015.
const COLS_LEGACY = COLS.replace('kind, ', '')
const missingKind = (msg: string) => /kind/.test(msg) && /column|schema/i.test(msg)
const warnKind = () =>
  console.warn('Colonne kind absente — exécuter db/0016_appointment_kind.sql')
const withKind = (rows: unknown[]): Appointment[] =>
  (rows as Appointment[]).map((a) => ({ ...a, kind: a.kind ?? 'rdv' }))

export interface NewAppointment {
  point_id?: string | null
  scheduled_at: string
  address?: string | null
  client_name?: string | null
  client_phone?: string | null
  notes?: string | null
  /** Tâche d'agenda (29/07) : entrée libre sans point ni issues. */
  kind?: 'rdv' | 'tache'
  /** Titulaire ≠ soi (secrétaire qui crée AU NOM d'un commercial — étape 4 ;
      la RLS exige un membre de l'agence). Défaut : soi. */
  commercial_id?: string
}

export async function fetchAppointments(): Promise<Appointment[]> {
  if (!supabase) return []
  // Supabase tronque silencieusement à 1 000 lignes, et le tri ASCENDANT
  // faisait disparaître précisément les RDV À VENIR dès que l'équipe cumulait
  // 1 000 RDV (audit) : on pagine, comme fetchPoints.
  const PAGE = 1000
  const all: Appointment[] = []
  let cols = COLS
  for (let from = 0; ; from += PAGE) {
    let { data, error } = await supabase
      .from('appointments')
      .select(cols)
      // Tie-breaker unique : les RDV sont posés sur des créneaux :00/:30,
      // les ex æquo de scheduled_at sont la norme — sans lui, l'ordre entre
      // égaux change d'une requête à l'autre et un RDV peut être dupliqué
      // ou perdu à la frontière des 1 000 lignes.
      .order('scheduled_at')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error && missingKind(error.message)) {
      warnKind()
      cols = COLS_LEGACY
      ;({ data, error } = await supabase
        .from('appointments')
        .select(cols)
        .order('scheduled_at')
        .order('id')
        .range(from, from + PAGE - 1))
    }
    if (error) throw error
    const rows = data ?? []
    // Cast via unknown : l'embed `point` est typé tableau par le client (FK
    // inconnu sans types générés) mais PostgREST renvoie un objet (many-to-one).
    all.push(...withKind(rows as unknown[]))
    if (rows.length < PAGE) return all
  }
}

/** RDV liés à un point (bloc « Rendez-vous » de la fiche point — audit UX B1).
    Triés par date croissante ; un point n'a jamais qu'une poignée de RDV. */
export async function fetchPointAppointments(pointId: string): Promise<Appointment[]> {
  if (!supabase) return []
  const query = (cols: string) =>
    supabase!.from('appointments').select(cols).eq('point_id', pointId).order('scheduled_at').order('id')
  let { data, error } = await query(COLS)
  if (error && missingKind(error.message)) {
    warnKind()
    ;({ data, error } = await query(COLS_LEGACY))
  }
  if (error) throw error
  return withKind((data ?? []) as unknown[])
}

export async function createAppointment(
  profile: Profile,
  appt: NewAppointment,
): Promise<Appointment> {
  if (!supabase) throw new Error('Supabase non configuré')
  const payload = {
    organization_id: profile.organization_id,
    created_by: profile.id,
    commercial_id: appt.commercial_id ?? profile.id,
    point_id: appt.point_id ?? null,
    scheduled_at: appt.scheduled_at,
    address: appt.address ?? null,
    client_name: appt.client_name ?? null,
    client_phone: appt.client_phone ?? null,
    notes: appt.notes ?? null,
    status: 'a_venir',
    // Omise pour un RDV (défaut SQL) : la création de RDV survit à une
    // base pas encore migrée en 0016 — seule une tâche l'exige.
    ...(appt.kind === 'tache' ? { kind: 'tache' } : {}),
  }
  let { data, error } = await supabase.from('appointments').insert(payload).select(COLS).single()
  // Base pas migrée (0016) : on rejoue sans la colonne — SAUF pour une
  // tâche, qui serait silencieusement créée en RDV : l'erreur remonte.
  if (error && appt.kind !== 'tache' && missingKind(error.message)) {
    warnKind()
    ;({ data, error } = await supabase
      .from('appointments')
      .insert(payload)
      .select(COLS_LEGACY)
      .single())
  }
  if (error) throw error
  return withKind([data])[0]
}

export async function updateAppointment(
  id: string,
  changes: Partial<Pick<Appointment, 'scheduled_at' | 'client_name' | 'client_phone' | 'address' | 'notes' | 'status'>>,
): Promise<Appointment> {
  if (!supabase) throw new Error('Supabase non configuré')
  let { data, error } = await supabase.from('appointments').update(changes).eq('id', id).select(COLS).single()
  if (error && missingKind(error.message)) {
    warnKind()
    ;({ data, error } = await supabase
      .from('appointments')
      .update(changes)
      .eq('id', id)
      .select(COLS_LEGACY)
      .single())
  }
  if (error) throw error
  return withKind([data])[0]
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
  if (!data?.length) {
    // 0 ligne = refus RLS… ou ligne DÉJÀ supprimée par un collègue (le
    // realtime n'est pas encore arrivé sur cet appareil). On vérifie avant
    // d'accuser : absente = succès (contre-audit, bug 11).
    const { data: still, error: e2 } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (e2) throw e2
    if (still) throw new Error('Suppression refusée (RDV d’un autre commercial)')
  }
}

/** RDV passés (avant aujourd'hui) encore « à venir » du commercial : le
    popup du matin « que s'est-il passé ? » (30/07). Les tâches ont leur
    propre boucle « Fait ✓ » et remontent déjà dans l'Accueil. */
export async function fetchPendingOutcomes(profileId: string): Promise<Appointment[]> {
  if (!supabase) return []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const query = (cols: string) =>
    supabase!
      .from('appointments')
      .select(cols)
      .eq('commercial_id', profileId)
      .eq('status', 'a_venir')
      .lt('scheduled_at', start.toISOString())
      .order('scheduled_at')
      .order('id')
  let { data, error } = await query(COLS)
  if (error && missingKind(error.message)) {
    warnKind()
    ;({ data, error } = await query(COLS_LEGACY))
  }
  if (error) throw error
  return withKind((data ?? []) as unknown[]).filter((a) => a.kind !== 'tache')
}

/** Clé jour LOCALE à J+n (revisit_at attend YYYY-MM-DD). */
function localDayPlus(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Donne une issue à un RDV — et fait suivre LE POINT (refonte 29/07 soir,
 * amendée le 12/08 sur retour Alexis validé briac) :
 *   vendu    → point « Client » (valeur vendu : LA vente du tunnel)
 *   effectue → « En attente » : le point GARDE son statut (un « RDV pris »
 *              reste bleu tant que le procès est ouvert) — seule la relance
 *              J+7 est posée, et RIEN n'est journalisé : un RDV honoré n'est
 *              pas une porte toquée (les portes = la prospection pure).
 *   refus    → point « Refus »
 *   annule   → rien (le RDV n'a pas eu lieu — « Replanifier » est proposé)
 * Les bascules de statut (vendu, refus) restent journalisées : l'événement
 * `vendu` EST la vente du tunnel.
 */
export async function setAppointmentOutcome(
  profile: Profile,
  appt: Appointment,
  outcome: AppointmentStatus,
): Promise<{ appointment: Appointment; pointSynced: boolean }> {
  const updated = await updateAppointment(appt.id, { status: outcome })
  let pointSynced = true
  // LA DATE DU RÉEL (30/07, demande briac + chef des ventes) : solder un RDV
  // « à venir » — le soir même ou trois jours après via le popup du matin —
  // date la visite ET la vente AU JOUR DU RDV (c'est là que ça s'est passé).
  // La conclusion d'un « En attente » (le prospect répond plus tard) reste
  // datée d'AUJOURD'HUI : c'est le jour de la réponse.
  const when = appt.status === 'a_venir' ? appt.scheduled_at : new Date().toISOString()
  const pointPatch: Record<string, unknown> | null =
    outcome === 'vendu'
      ? // revisit_at effacé : la réponse d'un « En attente » est tombée, la
        // maison ne doit pas traîner dans « À relancer » (état ouvert 29/07).
        { status: 'vendu', revisit_at: null }
      : outcome === 'effectue'
        ? { revisit_at: localDayPlus(7) }
        : outcome === 'refus'
          ? { status: 'impossible', revisit_at: null }
          : null
  if (pointPatch && appt.point_id && supabase) {
    // .select() : la RLS (point d'un collègue) filtre 0 ligne SANS erreur —
    // le point restait « rdv_pris » sur la carte de toute l'équipe alors que
    // le RDV était soldé (audit). L'échec est remonté à l'UI.
    const { data, error } = await supabase
      .from('points')
      .update({ ...pointPatch, visited_at: when })
      .eq('id', appt.point_id)
      .select('id')
    if (error || !data?.length) {
      pointSynced = false
      console.error('Bascule du point :', error?.message ?? 'refusée (RLS)')
    } else if (pointPatch.status) {
      // Journalisée SEULEMENT si le STATUT change (« En attente » ne change
      // rien : pas de porte comptée) et si la bascule a réussi : en cas
      // d'échec, l'UI guide vers la correction par la fiche, qui journalise
      // elle-même — l'insert inconditionnel produisait alors une DEUXIÈME
      // vente dans les stats (contre-audit, bug 9).
      const { error: e2 } = await supabase.from('point_events').insert({
        organization_id: profile.organization_id,
        point_id: appt.point_id,
        author_id: profile.id,
        status: pointPatch.status,
        occurred_at: when, // stats datées du réel (jour du RDV, pas du tap)
      })
      if (e2) {
        pointSynced = false
        console.error('Journal de la visite :', e2.message)
      }
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
