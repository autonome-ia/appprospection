import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Client Supabase. Tant que le projet Supabase n'est pas configuré (variables
// d'environnement absentes), `supabase` vaut `null` et l'app tourne en mode
// local (les points restent en mémoire). Voir .env.example.

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export const isSupabaseConfigured = supabase !== null
