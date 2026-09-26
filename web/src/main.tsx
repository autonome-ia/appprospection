import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import './lib/theme' // écoute « Auto » (prefers-color-scheme) dès le boot
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// Mises à jour de l'app, AUTOMATIQUES et SILENCIEUSES (26/09, choix briac :
// « se mettre à jour tout seul, sans message », mises en ligne fréquentes).
// Une PWA iOS rouverte depuis l'arrière-plan ne vérifiait rien : il fallait
// deux fermetures complètes (un manager de Brest restait sur l'ancienne
// version). Désormais :
//  - le service worker cherche une nouvelle version à l'ouverture, à chaque
//    retour au premier plan et toutes les 30 min ;
//  - la version prête est APPLIQUÉE (rechargement d'environ 1 s) seulement au
//    moment où l'utilisateur REVIENT dans l'app — l'instant où une relance
//    passe inaperçue — et jamais si une fiche, un formulaire ou une saisie
//    est en cours : on attend alors le retour suivant.
let updateReady = false
let lastVisibleAt = Date.now()

/** Rien en cours : aucune sheet ouverte, aucun champ en saisie. */
function safeToReload(): boolean {
  if (document.querySelector('.drawer-content')) return false
  const el = document.activeElement
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
}

const updateSW = registerSW({
  onNeedRefresh() {
    updateReady = true
    // Trouvée juste après un retour dans l'app (ou à l'ouverture) : on
    // applique tout de suite, c'est encore « le moment du retour ».
    if (Date.now() - lastVisibleAt < 8000 && safeToReload()) void updateSW(true)
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      lastVisibleAt = Date.now()
      if (updateReady && safeToReload()) void updateSW(true)
      else check()
    })
    window.setInterval(check, 30 * 60_000)
  },
})

// Après un déploiement Render, une PWA restée ouverte référence des chunks
// dynamiques (lidar, three, enrich…) qui n'existent plus : l'import échouait
// en silence (mesure/3D « morts » jusqu'à un rechargement manuel — audit).
// Vite émet cet événement dédié : on recharge, le SW récupère la version neuve.
window.addEventListener('vite:preloadError', (e) => {
  // Garde anti-boucle : si la version servie RESTE périmée (cache HTTP/SW,
  // déploiement cassé), chaque pose ou ouverture 3D re-déclencherait un
  // rechargement sans fin. Au-delà de 2 reloads en 2 min, on laisse l'échec
  // remonter aux .catch locaux et on prévient l'utilisateur.
  const KEY = 'preload-reloads'
  const now = Date.now()
  let past: number[] = []
  try {
    past = (JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as number[]).filter(
      (t) => now - t < 120_000,
    )
  } catch {
    past = []
  }
  if (past.length >= 2) {
    console.error('vite:preloadError répété — rechargement suspendu (version périmée toujours servie ?)')
    toast.error('Mise à jour indisponible : vérifiez le réseau, puis fermez et rouvrez l’app')
    return
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...past, now]))
  } catch {
    // stockage indisponible : on recharge quand même (au pire, boucle visible)
  }
  e.preventDefault()
  window.location.reload()
})

// iOS Safari pousse lui-même le viewport pour révéler un champ logé dans une
// couche fixed (sheets vaul non modales : la protection anti-poussée de vaul
// est coupée par modal={false}) et, en PWA installée, le décalage persiste
// parfois après la fermeture du clavier : tout l'écran reste remonté. On
// recolle le layout à chaque perte de focus d'un champ.
window.addEventListener('focusout', () => {
  requestAnimationFrame(() => window.scrollTo(0, 0))
})

// Canal « design » : pastille β discrète pour ne jamais confondre la version
// de test avec l'app des commerciaux (absente du build de main).
if (__BETA__) {
  document.title += ' β'
  const beta = document.createElement('div')
  beta.className = 'beta-pill'
  beta.textContent = 'β'
  beta.setAttribute('aria-hidden', 'true')
  document.body.appendChild(beta)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
