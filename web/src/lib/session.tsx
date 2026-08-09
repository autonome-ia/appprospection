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
    .select('id, organization_id, full_name, role, disabled_at')
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
    let disposed = false
    // Identité courante, tenue à jour de façon SYNCHRONE : toute réponse de
    // fetchProfile arrivée pour un autre utilisateur est jetée — sinon, au
    // changement de compte, le profil de l'ANCIEN utilisateur pouvait écraser
    // celui du nouveau (écritures avec la mauvaise identité, rejets RLS —
    // contre-audit, bugs 4 et 15).
    let currentUserId: string | null = null
    let profileLoaded = false
    let retryTimer: number | undefined
    let retryDelay = 5000

    const switchUser = (uid: string | null) => {
      if (uid === currentUserId) return
      currentUserId = uid
      profileLoaded = false
      retryDelay = 5000
      window.clearTimeout(retryTimer)
    }

    // Sans retry, un échec du chargement au lancement (zone blanche) laissait
    // profile à null jusqu'au prochain événement d'auth (~1 h de JWT) : la
    // pose refusait chaque tentative avec un toast mensonger (contre-audit,
    // bug 13). Backoff 5 s → 60 s + relance au retour au premier plan.
    const scheduleRetry = (userId: string) => {
      window.clearTimeout(retryTimer)
      const delay = retryDelay
      retryDelay = Math.min(retryDelay * 2, 60_000)
      retryTimer = window.setTimeout(() => {
        if (disposed || userId !== currentUserId || profileLoaded) return
        void loadProfile(userId)
      }, delay)
    }

    const loadProfile = async (userId: string) => {
      const p = await fetchProfile(userId)
      if (disposed || userId !== currentUserId) return // autre compte depuis : réponse jetée
      if (p) {
        profileLoaded = true
        setProfile(p)
        return
      }
      // Échec transitoire (réveil de la PWA, réseau) : on GARDE le profil
      // déjà chargé — le remettre à null faisait basculer les poses en
      // « mode local » silencieux, points perdus au rafraîchissement.
      setProfile((prev) => (prev && prev.id === userId ? prev : null))
      if (!profileLoaded) scheduleRetry(userId)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (disposed) return
      setSession(data.session)
      if (data.session) {
        switchUser(data.session.user.id)
        void loadProfile(data.session.user.id)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Callback SYNCHRONE : un await de requête supabase ICI bloque le
      // verrou interne d'auth (deadlock connu de supabase-js) — le profil se
      // charge hors du callback.
      setSession(newSession)
      switchUser(newSession?.user.id ?? null)
      setTimeout(() => {
        if (disposed) return
        if (!newSession) {
          setProfile(null)
          return
        }
        void loadProfile(newSession.user.id)
      }, 0)
    })

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (currentUserId && !profileLoaded) void loadProfile(currentUserId)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      sub.subscription.unsubscribe()
    }
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
