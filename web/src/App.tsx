import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { MotionConfig } from 'motion/react'
import { MapView, type MapFocus } from './components/MapView'
import { BottomNav, type Tab } from './components/BottomNav'
import { AuthScreen } from './components/AuthScreen'
import { AccueilScreen } from './components/AccueilScreen'
import { AgendaScreen } from './components/AgendaScreen'
import { StatsScreen } from './components/StatsScreen'
import { ScreenBoundary } from './components/ScreenBoundary'
import { PendingOutcomes } from './components/PendingOutcomes'
import { Celebration } from './components/ui/Celebration'
import { SessionProvider, useSession } from './lib/session'
import { useIsDark } from './lib/theme'
import { isSupabaseConfigured } from './lib/supabase'
import { isSecretaireRole } from './domain/types'
import './App.css'
import './styles/interactions.css'

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
      // Démarrage (chantier design 24/09) : la marque, pas un spinner — la
      // même que l'écran de connexion, qui prend le relais sans rupture. Elle
      // n'apparaît qu'après 250 ms (CSS) : une session qui répond vite ne
      // montre rien du tout.
      <div className="app-loading" aria-label="Chargement">
        <span className="auth-mark app-loading-mark">
          AppProspection<span className="auth-mark-dot">.</span>
        </span>
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
    // reducedMotion="user" : Motion suit le réglage Accessibilité du téléphone.
    <MotionConfig reducedMotion="user">
      <SessionProvider>
        <AppInner />
        <Celebration />
        <Toaster
          position="top-center"
          theme={dark ? 'dark' : 'light'}
          toastOptions={{
            // Relief de la DA (chantier design 24/09) : rayon des cartes,
            // ombre franche, corps 15 — le toast est la confirmation de
            // chaque pose, il doit avoir la qualité du reste.
            style: {
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-lg)',
              padding: '14px 16px',
            },
          }}
        />
      </SessionProvider>
    </MotionConfig>
  )
}
