import { supabase } from '../lib/supabase'

/**
 * Écran Équipe (chantier Équipe, étape 3). La sécurité vit en base :
 * le code n'est lisible que par manager + chef des ventes (RLS
 * organization_invites), la rotation et les changements de rôle sont refusés
 * aux autres (RPC manager, trigger profiles_guard) — l'UI ne fait que suivre.
 */

/** Nom de l'agence (affiché dans le message d'invitation). */
export async function fetchOrgName(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('organizations').select('name').maybeSingle()
  if (error) throw error
  return data?.name ?? null
}

/** Code d'invitation — null si la RLS le refuse (ni manager ni chef). */
export async function fetchInviteCode(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('organization_invites').select('code').maybeSingle()
  if (error) throw error
  return data?.code ?? null
}

/** Rotation du code (fuite) — manager uniquement (la RPC vérifie). */
export async function regenInviteCode(): Promise<string> {
  if (!supabase) throw new Error('Hors ligne')
  const { data, error } = await supabase.rpc('regen_invite_code')
  if (error) throw error
  return data as string
}
