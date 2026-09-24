/// <reference types="vite/client" />

declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

/** Build du canal « design » (2e site Render) : repère β. */
declare const __BETA__: boolean

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_MAPTILER_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
