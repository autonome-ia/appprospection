// =============================================================================
// Test du temps réel Numbers (db/0032) sur l'agence JETABLE « RLS Test ».
//   node tools/rls-test/realtime-test.mjs
// k2 (commercial) et la secrétaire écoutent le canal privé de l'agence ; k
// (commercial) crée puis supprime-annule une vente. Attendu : k2 reçoit le
// signal (vente d'un COLLÈGUE, qu'il ne peut pas lire), la secrétaire rien.
// Tout ce qui est créé est supprimé en fin de test.
// =============================================================================
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', '..', 'web', 'package.json'))
const { createClient } = require('@supabase/supabase-js')
const env = Object.fromEntries(
  readFileSync(join(here, '..', '..', 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const PASSWORD = 'rls-test-2026!'

async function client(email) {
  const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`${email} : ${error.message}`)
  await c.realtime.setAuth(data.session.access_token)
  return { c, id: data.user.id }
}

const k = await client('rlstest-commercial1@example.com')
const k2 = await client('rlstest-commercial2@example.com')
const sec = await client('rlstest-secretaire@example.com')
const { data: prof } = await k.c.from('profiles').select('organization_id').eq('id', k.id).single()
const topic = `numbers:${prof.organization_id}`

function listen(who, label) {
  const got = []
  return new Promise((resolve) => {
    const ch = who.c
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'sales_changed' }, (m) => got.push(m.payload?.op))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve({ label, got, status, ch })
        }
      })
  })
}

const [l2, lSec] = await Promise.all([listen(k2, 'commercial collègue'), listen(sec, 'secrétaire')])
console.log(`abonnements : collègue=${l2.status}, secrétaire=${lSec.status}`)

const { data: sale, error } = await k.c
  .from('sales')
  .insert({
    organization_id: prof.organization_id,
    seller1_id: k.id,
    sold_on: new Date().toISOString().slice(0, 10),
    client_name: 'TEST TEMPS RÉEL',
    prestation: 'toiture',
    amount_ht: 1000,
    payment: 'comptant',
    origin: 'prospection',
  })
  .select('id')
  .single()
if (error) throw error
await new Promise((r) => setTimeout(r, 5000))

const ok2 = l2.got.includes('INSERT')
const okSec = lSec.got.length === 0
console.log(`${ok2 ? 'PASS' : 'ÉCHEC'}  le collègue reçoit le signal d'une vente qu'il ne peut pas lire (${JSON.stringify(l2.got)})`)
console.log(`${okSec ? 'PASS' : 'ÉCHEC'}  la secrétaire ne reçoit rien (${JSON.stringify(lSec.got)})`)

// Ménage : la vente de test (le manager supprime).
const m = await client('rlstest-manager@example.com')
await m.c.from('sales').delete().eq('id', sale.id)
for (const who of [k, k2, sec, m]) await who.c.removeAllChannels()
process.exit(ok2 && okSec ? 0 : 1)
