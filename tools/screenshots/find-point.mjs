// Trouve un point « à revoir » (ou absent) AVEC adresse dans les données —
// pour recapturer pose-2 sur une fiche cohérente avec le texte du tuto.
// Lecture seule (REST Supabase, RLS du compte).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY

const auth = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.GUIDE_EMAIL, password: env.GUIDE_PASSWORD }),
}).then((r) => r.json())
if (!auth.access_token) {
  console.error('Auth échouée :', auth)
  process.exit(1)
}

const rows = await fetch(
  `${URL}/rest/v1/points?select=status,address,client_name,notes,revisit_at&status=in.(a_revoir,absent)&address=not.is.null&order=status.asc&limit=25`,
  { headers: { apikey: KEY, Authorization: `Bearer ${auth.access_token}` } },
).then((r) => r.json())

for (const p of rows) {
  console.log(
    `${p.status}\t${p.revisit_at ?? '-'}\t${p.client_name ?? '-'}\t${p.address}\t${(p.notes ?? '').slice(0, 40)}`,
  )
}
if (!rows.length) console.log('Aucun point a_revoir/absent avec adresse.')
