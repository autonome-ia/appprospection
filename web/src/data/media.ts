// Photos de profil et logo d'agence (db/0025, chantier design 24/09).
// Petite mémoire partagée : chargée une fois, tenue à jour après un envoi,
// lue par <Avatar> / <OrgLogo> partout dans l'app. Repli : tant que la
// migration 0025 n'est pas passée, `supported` = false — initiales et
// monogramme partout, boutons de changement masqués, rien ne casse.
import { useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { squareImage } from '../lib/image'

type MediaState = {
  loaded: boolean
  supported: boolean
  avatars: Record<string, string | null>
  org: { id: string; name: string; logo_url: string | null } | null
}

let state: MediaState = { loaded: false, supported: false, avatars: {}, org: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<MediaState>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
let loading: Promise<void> | null = null

export function loadMedia(force = false): Promise<void> {
  if (!supabase) return Promise.resolve()
  if (loading && !force) return loading
  const sb = supabase
  loading = (async () => {
    const [profiles, org] = await Promise.all([
      sb.from('profiles').select('id, avatar_url'),
      sb.from('organizations').select('id, name, logo_url').limit(1).maybeSingle(),
    ])
    const supported = !profiles.error && !org.error
    const avatars: Record<string, string | null> = {}
    if (!profiles.error) {
      for (const p of (profiles.data ?? []) as { id: string; avatar_url: string | null }[]) {
        avatars[p.id] = p.avatar_url ?? null
      }
    }
    let orgRow = org.error ? null : (org.data as MediaState['org'])
    if (org.error) {
      // Colonne logo absente : on garde au moins le NOM (monogramme).
      const r = await sb.from('organizations').select('id, name').limit(1).maybeSingle()
      orgRow = r.data ? { ...(r.data as { id: string; name: string }), logo_url: null } : null
    }
    emit({ loaded: true, supported, avatars, org: orgRow })
  })().catch((e) => {
    console.error('Photos / logo :', e)
    emit({ loaded: true })
  })
  return loading
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  if (!state.loaded) void loadMedia()
  return () => {
    listeners.delete(cb)
  }
}
export function useMedia(): MediaState {
  return useSyncExternalStore(subscribe, () => state)
}

const publicUrl = (path: string) =>
  `${supabase!.storage.from('media').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`

/** Change SA photo (chacun la sienne — garde-fou en base). */
export async function uploadMyAvatar(userId: string, file: File): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const blob = await squareImage(file, { size: 256, type: 'image/jpeg' })
  const path = `avatars/${userId}.jpg`
  const up = await supabase.storage
    .from('media')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const url = publicUrl(path)
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) throw error
  emit({ avatars: { ...state.avatars, [userId]: url } })
}

/** Retire SA photo (retour aux initiales). */
export async function removeMyAvatar(userId: string): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) throw error
  await supabase.storage.from('media').remove([`avatars/${userId}.jpg`])
  emit({ avatars: { ...state.avatars, [userId]: null } })
}

/** Change le logo de l'agence (manager seul — policy + garde-fou en base). */
export async function uploadOrgLogo(orgId: string, file: File): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const blob = await squareImage(file, { size: 256, type: 'image/png', contain: true })
  const path = `logos/${orgId}.png`
  const up = await supabase.storage
    .from('media')
    .upload(path, blob, { upsert: true, contentType: 'image/png' })
  if (up.error) throw up.error
  const url = publicUrl(path)
  const { data, error } = await supabase
    .from('organizations')
    .update({ logo_url: url })
    .eq('id', orgId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Modification refusée')
  if (state.org) emit({ org: { ...state.org, logo_url: url } })
}

/** Retire le logo (retour au monogramme). */
export async function removeOrgLogo(orgId: string): Promise<void> {
  if (!supabase) throw new Error('Hors ligne')
  const { error } = await supabase.from('organizations').update({ logo_url: null }).eq('id', orgId)
  if (error) throw error
  await supabase.storage.from('media').remove([`logos/${orgId}.png`])
  if (state.org) emit({ org: { ...state.org, logo_url: null } })
}
