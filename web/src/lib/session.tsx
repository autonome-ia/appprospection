import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../domain/types'

interface SessionState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name, role')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('Chargement du profil :', error.message)
    return null
  }
  return data as Profile | null
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // En mode local (pas de Supabase), on ne charge rien.
  const [loading, setLoading] = useState(supabase !== null)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) setProfile(await fetchProfile(data.session.user.id))
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      setProfile(newSession ? await fetchProfile(newSession.user.id) : null)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase?.auth.signOut()
  }

  return (
    <SessionContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  return useContext(SessionContext)
}
