import { supabase } from '../lib/supabase'
import { registerTeamColors } from '../domain/colors'
import type { UserRole } from '../domain/types'

export interface OrgProfile {
  id: string
  full_name: string | null
  role: UserRole
  color: string | null
  weekly_rdv_target: number
  /** Compte désactivé par le manager (db/0019) — kill-switch RLS. */
  disabled_at: string | null
  /** Compte dev/test (db/0022, posé en SQL uniquement) : son activité est
      invisible pour le reste de l'équipe — stats, carte, agenda, listes. */
  is_support: boolean
  /** Ordre d'arrivée : sert à l'attribution automatique des couleurs. */
  created_at: string | null
  /** Manager : coché = figure au classement des stats de l'équipe (db/0023).
      Sans effet pour les autres rôles. */
  stats_visible: boolean
  /** Numbers (db/0031) : objectif de CA mensuel HT, fixé par le manager. */
  monthly_ca_target: number
  /** Numbers (db/0031) : chef des ventes autorisé à modifier les ventes. */
  can_edit_sales: boolean
}

/** Tous les profils de l'organisation (RLS scope automatiquement). */
export async function fetchOrgProfiles(): Promise<OrgProfile[]> {
  if (!supabase) return []
  const BASE = 'id, full_name, role, color, weekly_rdv_target, disabled_at, created_at'
  // Colonnes optionnelles (migrations 0022 / 0023) : si l'une manque en base,
  // on la retire et on réessaie — repli neutre (personne n'est support,
  // aucun manager visible) plutôt que de casser tous les écrans qui chargent
  // les profils. L'ordre migration/déploiement est indifférent.
  const optional = ['is_support', 'stats_visible', 'monthly_ca_target', 'can_edit_sales']
  let data: Record<string, unknown>[] | null = null
  for (;;) {
    const cols = [BASE, ...optional].join(', ')
    const r = await supabase.from('profiles').select(cols)
    if (!r.error) {
      data = (r.data ?? []) as unknown as Record<string, unknown>[]
      break
    }
    const missing = optional.find((c) => r.error!.message.includes(c))
    if (!missing) throw r.error
    optional.splice(optional.indexOf(missing), 1)
  }
  const list = (data ?? []).map((r) => ({
    ...r,
    is_support: (r.is_support as boolean | undefined) ?? false,
    stats_visible: (r.stats_visible as boolean | undefined) ?? false,
    monthly_ca_target: Number(r.monthly_ca_target ?? 0),
    can_edit_sales: (r.can_edit_sales as boolean | undefined) ?? false,
  })) as OrgProfile[]
  // Garde-fou couleurs : la table d'attribution se calcule sur TOUTE
  // l'agence (les appelants filtrent ensuite support/désactivés) — même
  // résultat sur chaque appareil.
  registerTeamColors(list)
  return list
}

/** Le manager choisit de figurer (ou non) au classement des stats vus par
    l'équipe (db/0023) — sa propre ligne, via profiles_update_self. */
export async function updateStatsVisible(id: string, visible: boolean): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase
    .from('profiles')
    .update({ stats_visible: visible })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Modification refusée')
}

/** Le manager fixe l'objectif hebdomadaire de RDV d'un commercial. */
export async function updateWeeklyTarget(id: string, target: number): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('profiles').update({ weekly_rdv_target: target }).eq('id', id)
  if (error) throw error
}

/** Nom affiché d'un membre, corrigé par le manager (écran Équipe) — les
    comptes d'avant l'inscription par code portaient leur email en guise de
    nom. 0 ligne modifiée sans erreur = refus RLS → on le dit. */
export async function updateMemberName(id: string, fullName: string): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: fullName })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Modification refusée')
}

/** Couleur d'agenda d'un membre (manager, écran Équipe — refonte 10/08). */
export async function updateMemberColor(id: string, color: string): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase
    .from('profiles')
    .update({ color })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Modification refusée')
}

/** Changement de rôle (manager seul — trigger profiles_guard en base).
    0 ligne modifiée sans erreur = refus RLS silencieux → on le dit. */
export async function updateMemberRole(id: string, role: UserRole): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Modification refusée')
}

/** Désactivation / réactivation d'un compte (manager seul). */
export async function setMemberDisabled(id: string, disabled: boolean): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase
    .from('profiles')
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Modification refusée')
}
