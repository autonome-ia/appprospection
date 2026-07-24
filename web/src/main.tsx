import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'

// Après un déploiement Render, une PWA restée ouverte référence des chunks
// dynamiques (lidar, three, enrich…) qui n'existent plus : l'import échouait
// en silence (mesure/3D « morts » jusqu'à un rechargement manuel — audit).
// Vite émet cet événement dédié : on recharge, le SW récupère la version neuve.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
