// Thème clair/sombre (chantier mode sombre 29/07). La préférence vit sur
// l'appareil (localStorage) : 'light' (défaut), 'dark', ou 'system' (suit le
// réglage du téléphone). Le PREMIER rendu est couvert par le script inline
// d'index.html (pas de flash blanc au lancement de la PWA) — ce module ne
// fait qu'exposer la préférence en hook et la faire évoluer à chaud.
// En clair, l'attribut data-theme est RETIRÉ : le DOM clair reste
// strictement celui d'avant le chantier (zéro régression).
import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'theme'
const META_LIGHT = '#ffffff'
const META_DARK = '#121214' // = --bg sombre (barre système / encoche iOS)

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

const isDark = (pref: ThemePref) => pref === 'dark' || (pref === 'system' && media.matches)

function apply(pref: ThemePref) {
  const dark = isDark(pref)
  if (dark) document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? META_DARK : META_LIGHT)
}

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // stockage indisponible : le thème vaut pour la session en cours
  }
  apply(pref)
  notify()
}

// « Auto » : bascule à chaud quand le téléphone change de mode.
media.addEventListener('change', () => {
  if (themePref() === 'system') {
    apply('system')
    notify()
  }
})

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Préférence courante (pour le sélecteur de la sheet de profil). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, themePref)
}

/** Thème effectif (pour les briques hors CSS : Toaster Sonner…). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => isDark(themePref()))
}
