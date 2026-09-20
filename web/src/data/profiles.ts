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
}

/** Tous les profils de l'organisation (RLS scope automatiquement). */
export async function fetchOrgProfiles(): Promise<OrgProfile[]> {
  if (!supabase) return []
  let { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, color, weekly_rdv_target, disabled_at, is_support, created_at')
  // Migration 0022 pas encore passée : repli sans la colonne (personne n'est
  // support) plutôt que de casser tous les écrans qui chargent les profils.
  if (error && /is_support/.test(error.message)) {
    ;({ data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, color, weekly_rdv_target, disabled_at, created_at'))
  }
  if (error) throw error
  const list = (data ?? []).map((r) => ({
    ...r,
    is_support: (r as { is_support?: boolean }).is_support ?? false,
  })) as OrgProfile[]
  // Garde-fou couleurs : la table d'attribution se calcule sur TOUTE
  // l'agence (les appelants filtrent ensuite support/désactivés) — même
  // résultat sur chaque appareil.
  registerTeamColors(list)
  return list
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
