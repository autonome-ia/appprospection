/// <reference types="vite/client" />

declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_MAPTILER_KEY?: string
  readonly VITE_MAPILLARY_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
