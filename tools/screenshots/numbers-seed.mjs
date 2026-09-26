// =============================================================================
// Décor Numbers pour les captures (chantier Numbers, tour UI/UX du 26/09).
// Remplit l'agence JETABLE « RLS Test — jetable » (comptes rlstest-*, banc
// tools/rls-test) de ventes réalistes sur 4 mois. Ne touche AUCUNE autre
// agence : tout passe par les comptes de test, la RLS borne à leur agence.
//
//   node numbers-seed.mjs          → nettoie puis remplit
//   node numbers-seed.mjs clean    → nettoie seulement
// Prérequis : db/0031 + numbers_activate sur « RLS Test — jetable ».
// =============================================================================
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
const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const PASSWORD = 'rls-test-2026!'
const ACCOUNTS = {
  manager: { email: 'rlstest-manager@example.com', name: 'Julien Morvan', target: 0 },
  chef: { email: 'rlstest-chef@example.com', name: 'Sophie Le Bris', target: 30000 },
  k: { email: 'rlstest-commercial1@example.com', name: 'Marie Le Gall', target: 40000 },
  k2: { email: 'rlstest-commercial2@example.com', name: 'Thomas Kerleau', target: 35000 },
}
export const SEED_TAG = 'DÉCOR NUMBERS'

async function api(path, { method = 'GET', token, body, prefer } = {}) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* vide */
  }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

const s = {}
for (const [k, a] of Object.entries(ACCOUNTS)) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: a.email, password: PASSWORD } })
  s[k] = { token: r.access_token, id: r.user.id }
}
const M = s.manager.token
const prof = await api(`/rest/v1/profiles?id=eq.${s.manager.id}&select=organization_id`, { token: M })
const org = prof[0].organization_id
const orgRow = await api(`/rest/v1/organizations?id=eq.${org}&select=name`, { token: M })
if (orgRow[0]?.name !== 'RLS Test — jetable') throw new Error(`Agence inattendue : ${orgRow[0]?.name} (garde-fou)`)

// Ménage : ventes du décor (note taguée) puis toutes les ventes de l'agence de test.
await api(`/rest/v1/sales?organization_id=eq.${org}`, { method: 'DELETE', token: M, prefer: 'return=minimal' })
console.log('✔ ventes de l’agence de test supprimées')
if (process.argv[2] === 'clean') process.exit(0)

// Noms et objectifs réalistes (personnages fictifs).
for (const [k, a] of Object.entries(ACCOUNTS)) {
  await api(`/rest/v1/profiles?id=eq.${s[k].id}`, {
    method: 'PATCH',
    token: M,
    body: { full_name: a.name, monthly_ca_target: a.target },
    prefer: 'return=minimal',
  })
}
console.log('✔ noms et objectifs posés')

// Générateur déterministe (même décor à chaque fois).
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const CLIENTS = ['M. et Mme Le Goff', 'M. Tanguy', 'Mme Quéméner', 'M. Abgrall', 'Mme Guivarc’h', 'M. Riou', 'M. et Mme Cloarec', 'Mme Le Roux', 'M. Salaün', 'M. Podeur', 'Mme Jaouen', 'M. Kerbrat', 'M. et Mme Floc’h', 'Mme Bescond', 'M. Le Meur', 'M. Priol']
const STREETS = ['rue de Siam', 'rue Jean Jaurès', 'route du Conquet', 'rue de Paris', 'chemin de Kervallon', 'rue Victor Hugo', 'rue de la Liberté', 'allée des Mouettes']
const TOWNS = ['Brest', 'Guipavas', 'Plouzané', 'Gouesnou', 'Le Relecq-Kerhuon']
const PREST = [
  ['toiture', 14000, 32000],
  ['toiture', 12000, 28000],
  ['toiture', 15000, 26000],
  ['facade', 7000, 16000],
  ['isolation', 5000, 12000],
  ['traitement_bois', 2500, 6000],
  ['gouttiere', 1500, 4500],
  ['energie', 8000, 18000],
]
const ORIGINS = ['prospection', 'prospection', 'prospection', 'lead_entrant', 'ancien_client']
const SELLERS = ['k', 'k', 'k', 'k2', 'k2', 'k2', 'chef', 'manager']

const today = new Date()
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const rows = []
for (let i = 0; i < 34; i++) {
  const d = new Date(today)
  d.setDate(d.getDate() - Math.floor(rnd() * 115))
  const [prestation, lo, hi] = pick(PREST)
  const amount = Math.round((lo + rnd() * (hi - lo)) / 50) * 50
  const financement = rnd() < 0.45
  const s1 = pick(SELLERS)
  let s2 = null
  if (rnd() < 0.18) s2 = pick(['k', 'k2', 'chef'].filter((x) => x !== s1))
  rows.push({
    organization_id: org,
    sold_on: day(d),
    client_name: pick(CLIENTS),
    address: `${1 + Math.floor(rnd() * 90)} ${pick(STREETS)}, ${pick(TOWNS)}`,
    note: rnd() < 0.25 ? pick(['Acompte versé', 'Démarrage chantier en octobre', 'Voisin intéressé au 14', 'Dossier de financement en cours']) : null,
    origin: pick(ORIGINS),
    prestation,
    amount_ht: amount,
    payment: financement ? 'financement' : 'comptant',
    financed_ht: financement ? Math.round((amount * (0.5 + rnd() * 0.5)) / 50) * 50 : null,
    seller1_id: s[s1].id,
    seller2_id: s2 ? s[s2].id : null,
  })
}
// Deux ventes « à compléter » (nées d'un Vendu, formulaire fermé) et une annulée.
rows.push({ organization_id: org, sold_on: day(today), client_name: 'M. Uguen', address: '12 rue de Brest, Guipavas', seller1_id: s.k.id })
rows.push({ organization_id: org, sold_on: day(new Date(today.getTime() - 86400e3 * 2)), client_name: 'Mme Pellen', address: '4 rue Kerfautras, Brest', prestation: 'toiture', seller1_id: s.k2.id })
// PostgREST : insertion groupée = mêmes clés partout.
const KEYS = [...new Set(rows.flatMap((r) => Object.keys(r)))]
const uniform = rows.map((r) => Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null])))
const created = await api('/rest/v1/sales', { method: 'POST', token: M, body: uniform, prefer: 'return=representation' })
const toCancel = created.find((r) => r.amount_ht && r.seller1_id === s.k.id)
await api(`/rest/v1/sales?id=eq.${toCancel.id}`, { method: 'PATCH', token: M, body: { status: 'annulee' }, prefer: 'return=minimal' })
console.log(`✔ ${created.length} ventes créées (dont 2 à compléter, 1 annulée)`)
