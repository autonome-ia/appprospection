import { useState } from 'react'
import { Toaster } from 'sonner'
import { MapView } from './components/MapView'
import { BottomNav, type Tab } from './components/BottomNav'
import { AuthScreen } from './components/AuthScreen'
import { AccueilScreen } from './components/AccueilScreen'
import { AgendaScreen } from './components/AgendaScreen'
import { StatsScreen } from './components/StatsScreen'
import { SessionProvider, useSession } from './lib/session'
import { isSupabaseConfigured } from './lib/supabase'
import './App.css'

function AppInner() {
  const { loading, session, profile } = useSession()
  const [tab, setTab] = useState<Tab>('carte')

  if (loading) {
    return (
      <div className="app-loading">
        <span className="spinner" />
      </div>
    )
  }

  // Si Supabase est configuré, on exige une connexion.
  if (isSupabaseConfigured && !session) {
    return <AuthScreen />
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'carte' ? <MapView profile={profile} /> : null}
        {tab === 'accueil' ? <AccueilScreen /> : null}
        {tab === 'agenda' ? <AgendaScreen profile={profile} /> : null}
        {tab === 'stats' ? <StatsScreen profile={profile} /> : null}
      </main>

      {!isSupabaseConfigured && <div className="mode-badge">Mode local (sans base)</div>}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            fontFamily: 'var(--font-sans)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
          },
        }}
      />
    </SessionProvider>
  )
}
