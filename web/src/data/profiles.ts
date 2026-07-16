import { supabase } from '../lib/supabase'

export interface OrgProfile {
  id: string
  full_name: string | null
  role: 'commercial' | 'manager'
  color: string | null
  weekly_rdv_target: number
}

/** Tous les profils de l'organisation (RLS scope automatiquement). */
export async function fetchOrgProfiles(): Promise<OrgProfile[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, color, weekly_rdv_target')
  if (error) throw error
  return (data ?? []) as OrgProfile[]
}

/** Le manager fixe l'objectif hebdomadaire de RDV d'un commercial. */
export async function updateWeeklyTarget(id: string, target: number): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('profiles').update({ weekly_rdv_target: target }).eq('id', id)
  if (error) throw error
}
