import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import './lib/theme' // écoute « Auto » (prefers-color-scheme) dès le boot
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// Mises à jour de l'app (26/09 : un manager restait sur l'ancienne version,
// même après s'être reconnecté). Une PWA iOS rouverte depuis l'arrière-plan
// ne vérifie RIEN : il fallait deux fermetures complètes. Désormais :
//  - on demande au service worker de chercher une nouvelle version à chaque
//    retour au premier plan (et toutes les 30 min app ouverte) ;
//  - quand elle est prête, un toast propose « Mettre à jour » (jamais de
//    rechargement imposé : un commercial peut être en pleine saisie).
const updateSW = registerSW({
  onNeedRefresh() {
    toast('Nouvelle version de l’app disponible', {
      duration: Infinity,
      action: { label: 'Mettre à jour', onClick: () => void updateSW(true) },
    })
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
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
