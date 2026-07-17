import { useState } from 'react'
import { Toaster } from 'sonner'
import { MapView, type MapFocus } from './components/MapView'
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
  // Cible « Voir sur la carte » (depuis l'agenda ou l'accueil) : consommée par MapView.
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
  const showOnMap = (target: MapFocus) => {
    setMapFocus(target)
    setTab('carte')
  }

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
        {/* La carte reste montée en permanence (masquée en CSS quand un autre
            onglet est actif) : retour instantané, position/zoom conservés,
            pas de re-téléchargement des tuiles. */}
        <div className={`map-slot ${tab === 'carte' ? '' : 'is-hidden'}`}>
          <MapView
            profile={profile}
            active={tab === 'carte'}
            focus={mapFocus}
            onFocusHandled={() => setMapFocus(null)}
          />
        </div>
        {tab === 'accueil' ? <AccueilScreen onShowOnMap={showOnMap} /> : null}
        {tab === 'agenda' ? <AgendaScreen profile={profile} onShowOnMap={showOnMap} /> : null}
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
