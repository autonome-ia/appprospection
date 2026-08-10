import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { MapView, type MapFocus } from './components/MapView'
import { BottomNav, type Tab } from './components/BottomNav'
import { AuthScreen } from './components/AuthScreen'
import { AccueilScreen } from './components/AccueilScreen'
import { AgendaScreen } from './components/AgendaScreen'
import { StatsScreen } from './components/StatsScreen'
import { ScreenBoundary } from './components/ScreenBoundary'
import { PendingOutcomes } from './components/PendingOutcomes'
import { SessionProvider, useSession } from './lib/session'
import { useIsDark } from './lib/theme'
import { isSupabaseConfigured } from './lib/supabase'
import { isSecretaireRole } from './domain/types'
import './App.css'

/** Compte désactivé par le manager (db/0019) : la RLS ne laisse plus rien
    lire — on le dit, au lieu d'une app vide qui « bugge ». */
function DisabledScreen() {
  const { signOut } = useSession()
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Compte désactivé</h1>
        <p className="auth-subtitle">
          Ton compte a été désactivé par le manager de l’agence. Contacte-le pour le réactiver.
        </p>
        <button type="button" className="btn btn-primary auth-submit" onClick={() => void signOut()}>
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

function AppInner() {
  const { loading, session, profile } = useSession()
  const [tab, setTab] = useState<Tab>('carte')
  // Cible « Voir sur la carte » (depuis l'agenda ou l'accueil) : consommée par MapView.
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
  const showOnMap = (target: MapFocus) => {
    setMapFocus(target)
    setTab('carte')
  }
  // Pont Stats→Carte (audit UX B5) : le drill-down d'un commercial bascule
  // sur la carte avec le filtre « Qui » pré-appliqué.
  const [mapWho, setMapWho] = useState<string | null>(null)

  // Premier lancement d'un compte NEUF (< 48 h) : on arrive sur l'Accueil —
  // le Guide s'y auto-ouvre (GuideSection). Un ancien compte reste sur la
  // carte ; jamais sous Playwright (sondes).
  useEffect(() => {
    if (!profile || navigator.webdriver) return
    try {
      if (localStorage.getItem('guide-auto')) return
      const created = profile.created_at ? Date.parse(profile.created_at) : NaN
      if (Number.isFinite(created) && Date.now() - created < 48 * 3600_000) setTab('accueil')
    } catch {
      /* stockage indisponible */
    }
  }, [profile])
  const showCommercialOnMap = (commercialId: string) => {
    setMapWho(commercialId)
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

  if (profile?.disabled_at) {
    return <DisabledScreen />
  }

  // Secrétaire (chantier Équipe) : l'agenda partagé est TOUTE son app —
  // pas de carte (jamais montée), ni d'accueil terrain, ni de stats, ni de
  // barre d'onglets. Ses réglages vivent dans l'en-tête de l'agenda.
  if (isSecretaireRole(profile?.role)) {
    return (
      <div className="app-shell">
        <main className="app-main app-main-solo">
          <ScreenBoundary>
            <AgendaScreen profile={profile} />
          </ScreenBoundary>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {/* La carte reste montée en permanence (masquée en CSS quand un autre
            onglet est actif) : retour instantané, position/zoom conservés,
            pas de re-téléchargement des tuiles. */}
        <div className={`map-slot ${tab === 'carte' ? '' : 'is-hidden'}`}>
          {/* Boundary aussi ici : MapView (MapLibre + realtime + toutes les
              sheets) est le composant le plus exposé — sans lui, une
              exception de rendu démontait TOUTE l'app en écran blanc muet,
              barre d'onglets comprise (contre-audit, bug 14). */}
          <ScreenBoundary>
            <MapView
              profile={profile}
              active={tab === 'carte'}
              focus={mapFocus}
              onFocusHandled={() => setMapFocus(null)}
              whoFocus={mapWho}
              onWhoFocusHandled={() => setMapWho(null)}
            />
          </ScreenBoundary>
        </div>
        {tab === 'accueil' ? (
          <ScreenBoundary>
            <AccueilScreen onShowOnMap={showOnMap} />
          </ScreenBoundary>
        ) : null}
        {tab === 'agenda' ? (
          <ScreenBoundary>
            <AgendaScreen profile={profile} onShowOnMap={showOnMap} />
          </ScreenBoundary>
        ) : null}
        {tab === 'stats' ? (
          <ScreenBoundary>
            <StatsScreen profile={profile} onShowCommercialOnMap={showCommercialOnMap} />
          </ScreenBoundary>
        ) : null}
      </main>

      {!isSupabaseConfigured && <div className="mode-badge">Mode local (sans base)</div>}

      {/* Popup du matin (30/07) : les RDV passés sans issue, à la première
          ouverture du jour — jamais pendant les sondes (navigator.webdriver). */}
      {profile && (
        <ScreenBoundary>
          <PendingOutcomes profile={profile} />
        </ScreenBoundary>
      )}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  // Sonner peint ses toasts hors tokens CSS : on lui passe le thème effectif
  // (réactif : bascule dans la sheet de profil comme réglage téléphone en Auto).
  const dark = useIsDark()
  return (
    <SessionProvider>
      <AppInner />
      <Toaster
        position="top-center"
        theme={dark ? 'dark' : 'light'}
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
