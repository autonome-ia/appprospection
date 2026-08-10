import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cache inter-sessions des ressources IGN (audit carte 10/08) : les
        // CGU Géoplateforme tolèrent le cache des fonds en licence ouverte et
        // data.geopf.fr annonce lui-même max-age 21 j sur les tuiles. Le
        // quartier travaillé hier s'affiche instantanément le lendemain.
        // BAN (geocodage) et WFS volontairement HORS cache (données vivantes).
        runtimeCaching: [
          {
            // Tuiles ortho (WMTS raster jpeg).
            urlPattern: /^https:\/\/data\.geopf\.fr\/wmts/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ign-tuiles-ortho',
              expiration: { maxEntries: 1500, maxAgeSeconds: 21 * 86400, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tuiles vectorielles Plan IGN (labels).
            urlPattern: /^https:\/\/data\.geopf\.fr\/tms\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ign-tuiles-plan',
              expiration: { maxEntries: 1000, maxAgeSeconds: 21 * 86400, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Style, glyphes, sprites (la cascade du premier chargement) :
            // servis du cache, revalidés en arrière-plan.
            urlPattern: /^https:\/\/data\.geopf\.fr\/annexes\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ign-style',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 86400, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'AppProspection',
        short_name: 'Prospection',
        description: 'Cartographie de prospection porte-à-porte',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
