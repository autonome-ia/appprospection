// =============================================================================
// Banc de test RLS — chantier Équipe (étape 1). AUCUNE dépendance (fetch nu).
// Vérifie la matrice rôle par rôle de db/0019 avec des comptes JETABLES dans
// une agence de test — ne touche à AUCUNE donnée réelle (tout ce qui est créé
// est marqué « RLS TEST » et supprimé en fin de banc).
//
// Mode d'emploi (après exécution de 0018 puis 0019 dans Supabase) :
//   1. Créer l'agence de test :  db/../tools/rls-test/seed.sql (SQL Editor)
//      → noter le code d'invitation affiché.
//   2. node tools/rls-test/rls-test.mjs signup <CODE>
//      → crée 5 comptes jetables (tous « commercial »), affiche le SQL de
//        promotion (manager / chef_ventes / secretaire) à exécuter.
//   3. Exécuter ce SQL de promotion dans Supabase.
//   4. node tools/rls-test/rls-test.mjs run
//      → déroule ~45 vérifications (surtout les REFUS), nettoie, résume.
//
// Si la connexion échoue avec « Email not confirmed » : Dashboard Supabase →
// Authentication → Providers → Email → décocher « Confirm email » (ou
// confirmer les 5 comptes à la main), puis relancer.
//
// Ménage final (quand le chantier est validé) : supprimer les 5 utilisateurs
// rlstest-* dans Authentication (les profils suivent en cascade), puis
// l'agence « RLS Test — jetable » (delete restreint tant que des profils
// pointent dessus — d'où l'ordre).
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envText = readFileSync(join(here, '..', '..', 'web', '.env'), 'utf8')
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
if (!SUPA || !ANON) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY introuvables dans web/.env')
  process.exit(1)
}

const PASSWORD = 'rls-test-2026!'
const ROLES = {
  manager: 'rlstest-manager@example.com',
  chef: 'rlstest-chef@example.com',
  secretaire: 'rlstest-secretaire@example.com',
  k: 'rlstest-commercial1@example.com',
  k2: 'rlstest-commercial2@example.com',
}

async function api(path, { method = 'GET', token = null, body, headers = {} } = {}) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* réponse vide (204) */
  }
  return { status: res.status, data }
}

const rest = (token, method, path, body) =>
  api(`/rest/v1/${path}`, {
    method,
    token,
    body,
    headers: { Prefer: 'return=representation' },
  })

// --- Phase « signup » --------------------------------------------------------

async function signup(code) {
  if (!code) {
    console.error('Usage : node rls-test.mjs signup <CODE_INVITATION_AGENCE_TEST>')
    process.exit(1)
  }
  // Le code est-il bon ? (même RPC que l'écran d'inscription)
  const check = await api('/rest/v1/rpc/validate_invite', {
    method: 'POST',
    body: { invite_code: code },
  })
  if (check.status !== 200 || !check.data) {
    console.error(`Code « ${code} » invalide (validate_invite → ${check.status}, ${JSON.stringify(check.data)}).`)
    console.error('0018/0019 exécutées ? seed.sql exécuté ? Bon code recopié ?')
    process.exit(1)
  }
  console.log(`Code valide — agence « ${check.data} ».\n`)

  // Négatifs d'inscription : sans code et mauvais code doivent échouer.
  for (const [label, meta] of [
    ['inscription SANS code', {}],
    ['inscription avec un MAUVAIS code', { invite_code: 'XXXXXXXX' }],
  ]) {
    const r = await api('/auth/v1/signup', {
      method: 'POST',
      body: { email: `rlstest-refus-${Date.now()}@example.com`, password: PASSWORD, data: meta },
    })
    console.log(`${r.status >= 400 ? 'PASS' : 'ÉCHEC'}  ${label} refusée (HTTP ${r.status})`)
  }

  for (const [who, email] of Object.entries(ROLES)) {
    const r = await api('/auth/v1/signup', {
      method: 'POST',
      body: {
        email,
        password: PASSWORD,
        data: { invite_code: code, full_name: `RLS ${who}` },
      },
    })
    const already = r.status === 400 || r.status === 422
    console.log(
      r.status === 200
        ? `PASS  compte ${email} créé (commercial)`
        : already
          ? `OK    compte ${email} existe déjà`
          : `ÉCHEC compte ${email} : HTTP ${r.status} ${JSON.stringify(r.data)}`,
    )
  }

  console.log(`\nÀ exécuter dans le SQL Editor Supabase (promotion des rôles), puis « node rls-test.mjs run » :\n`)
  console.log(`update public.profiles set role = 'manager'     where id = (select id from auth.users where email = '${ROLES.manager}');`)
  console.log(`update public.profiles set role = 'chef_ventes' where id = (select id from auth.users where email = '${ROLES.chef}');`)
  console.log(`update public.profiles set role = 'secretaire'  where id = (select id from auth.users where email = '${ROLES.secretaire}');`)
}

// --- Phase « run » -----------------------------------------------------------

let pass = 0
let fail = 0
function verdict(ok, label, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${label}`)
  } else {
    fail++
    console.log(`ÉCHEC ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
// Une écriture REFUSÉE par la RLS = erreur HTTP (403/400) OU 0 ligne touchée.
const refused = (r) => r.status >= 400 || !Array.isArray(r.data) || r.data.length === 0
const okRows = (r) => r.status < 300 && Array.isArray(r.data) && r.data.length > 0

async function run() {
  const s = {} // sessions : { manager: {token, id, org}, ... }
  for (const [who, email] of Object.entries(ROLES)) {
    const r = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password: PASSWORD },
    })
    if (r.status !== 200) {
      console.error(`Connexion ${email} impossible : HTTP ${r.status} ${JSON.stringify(r.data)}`)
      if (JSON.stringify(r.data).includes('not confirmed'))
        console.error('→ Désactiver « Confirm email » (Authentication → Providers) ou confirmer les comptes.')
      process.exit(1)
    }
    s[who] = { token: r.data.access_token, id: r.data.user.id }
  }
  for (const who of Object.keys(s)) {
    const r = await rest(s[who].token, 'GET', `profiles?id=eq.${s[who].id}&select=organization_id,role`)
    s[who].org = r.data?.[0]?.organization_id
    s[who].role = r.data?.[0]?.role
  }
  console.log(`Rôles en base : ${Object.entries(s).map(([w, x]) => `${w}=${x.role}`).join(', ')}\n`)
  const expected = { manager: 'manager', chef: 'chef_ventes', secretaire: 'secretaire', k: 'commercial', k2: 'commercial' }
  for (const [w, want] of Object.entries(expected))
    if (s[w].role !== want) {
      console.error(`Le compte « ${w} » a le rôle ${s[w].role}, attendu ${want} — SQL de promotion exécuté ?`)
      process.exit(1)
    }

  const org = s.k.org
  const P = (who, created_by) => ({
    organization_id: org,
    created_by,
    status: 'absent',
    lat: 48.0,
    lng: -4.0,
    address: 'RLS TEST — jetable',
  })
  const RDV = (created_by, commercial_id, kind = 'rdv') => ({
    organization_id: org,
    created_by,
    commercial_id,
    scheduled_at: new Date().toISOString(),
    client_name: 'RLS TEST',
    kind,
  })
  const cleanup = { points: [], appointments: [] }

  // ---- points ----
  let r = await rest(s.k.token, 'POST', 'points', P('k', s.k.id))
  verdict(okRows(r), 'commercial pose un point (pour lui)', JSON.stringify(r.data))
  const p1 = r.data?.[0]?.id
  if (p1) cleanup.points.push(p1)

  r = await rest(s.k.token, 'POST', 'points', P('k', s.k2.id))
  verdict(refused(r), 'commercial NE pose PAS au nom d’un collègue')

  r = await rest(s.secretaire.token, 'POST', 'points', P('s', s.k.id))
  verdict(okRows(r), 'secrétaire crée un contact AU NOM d’un commercial', JSON.stringify(r.data))
  const p2 = r.data?.[0]?.id
  if (p2) cleanup.points.push(p2)

  r = await rest(s.chef.token, 'POST', 'points', P('c', s.k.id))
  verdict(okRows(r), 'chef des ventes pose au nom d’un commercial')
  if (r.data?.[0]?.id) cleanup.points.push(r.data[0].id)

  r = await rest(s.k2.token, 'PATCH', `points?id=eq.${p1}`, { notes: 'RLS TEST k2' })
  verdict(refused(r), 'commercial NE modifie PAS le point d’un collègue')

  r = await rest(s.k.token, 'PATCH', `points?id=eq.${p1}`, { notes: 'RLS TEST k' })
  verdict(okRows(r), 'commercial modifie SON point')

  r = await rest(s.secretaire.token, 'PATCH', `points?id=eq.${p1}`, { notes: 'RLS TEST s' })
  verdict(refused(r), 'secrétaire NE modifie AUCUN point')

  r = await rest(s.chef.token, 'PATCH', `points?id=eq.${p1}`, { notes: 'RLS TEST chef' })
  verdict(okRows(r), 'chef des ventes modifie le point d’un commercial')

  r = await rest(s.secretaire.token, 'DELETE', `points?id=eq.${p1}`)
  verdict(refused(r), 'secrétaire NE supprime PAS de point')

  // ---- point_events ----
  r = await rest(s.k.token, 'POST', 'point_events', { organization_id: org, point_id: p1, author_id: s.k.id, status: 'absent' })
  verdict(okRows(r), 'commercial journalise SA visite')
  const ev1 = r.data?.[0]?.id

  r = await rest(s.k.token, 'POST', 'point_events', { organization_id: org, point_id: p1, author_id: s.k2.id, status: 'absent' })
  verdict(refused(r), 'commercial NE journalise PAS au nom d’un collègue')

  r = await rest(s.secretaire.token, 'POST', 'point_events', { organization_id: org, point_id: p2, author_id: s.k.id, status: 'a_revoir' })
  verdict(okRows(r), 'secrétaire journalise le contact au nom du commercial')

  r = await rest(s.k.token, 'DELETE', `point_events?id=eq.${ev1}`)
  verdict(refused(r), 'commercial NE supprime PAS d’événement du journal')

  r = await rest(s.chef.token, 'DELETE', `point_events?id=eq.${ev1}`)
  verdict(okRows(r), 'chef des ventes supprime un événement du journal')

  // ---- point_notes ----
  r = await rest(s.k.token, 'POST', 'point_notes', { organization_id: org, point_id: p1, author_id: s.k.id, body: 'RLS TEST note k' })
  verdict(okRows(r), 'commercial écrit une note signée de lui')
  const n1 = r.data?.[0]?.id

  r = await rest(s.secretaire.token, 'POST', 'point_notes', { organization_id: org, point_id: p2, author_id: s.k.id, body: 'RLS TEST usurpée' })
  verdict(refused(r), 'secrétaire NE signe PAS une note du nom d’un autre')

  r = await rest(s.secretaire.token, 'POST', 'point_notes', { organization_id: org, point_id: p2, author_id: s.secretaire.id, body: 'RLS TEST note secrétaire' })
  verdict(okRows(r), 'secrétaire écrit une note signée d’elle')

  r = await rest(s.k2.token, 'DELETE', `point_notes?id=eq.${n1}`)
  verdict(refused(r), 'commercial NE supprime PAS la note d’un collègue')

  r = await rest(s.chef.token, 'DELETE', `point_notes?id=eq.${n1}`)
  verdict(okRows(r), 'chef des ventes supprime une note')

  // ---- appointments ----
  r = await rest(s.k.token, 'POST', 'appointments', RDV(s.k.id, s.k.id))
  verdict(okRows(r), 'commercial crée SON RDV')
  const a1 = r.data?.[0]?.id
  if (a1) cleanup.appointments.push(a1)

  r = await rest(s.k.token, 'POST', 'appointments', RDV(s.k.id, s.k2.id))
  verdict(refused(r), 'commercial NE crée PAS de RDV pour un collègue')

  r = await rest(s.k.token, 'POST', 'appointments', RDV(s.k.id, crypto.randomUUID()))
  verdict(refused(r), 'titulaire hors agence refusé (trou fermé)')

  r = await rest(s.secretaire.token, 'POST', 'appointments', RDV(s.secretaire.id, s.k.id))
  verdict(okRows(r), 'secrétaire crée un RDV au nom d’un commercial')
  const a2 = r.data?.[0]?.id
  if (a2) cleanup.appointments.push(a2)

  r = await rest(s.secretaire.token, 'POST', 'appointments', RDV(s.secretaire.id, s.k.id, 'tache'))
  verdict(refused(r), 'secrétaire NE crée PAS de tâche')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { status: 'vendu' })
  verdict(refused(r), 'secrétaire NE solde PAS le RDV d’un commercial')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a2}`, { scheduled_at: new Date(Date.now() + 3600e3).toISOString() })
  verdict(okRows(r), 'secrétaire décale le RDV qu’elle a créé')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a2}`, { status: 'vendu' })
  verdict(refused(r), 'secrétaire NE marque PAS « Vendu », même sur son RDV')

  r = await rest(s.k2.token, 'PATCH', `appointments?id=eq.${a1}`, { status: 'annule' })
  verdict(refused(r), 'commercial NE touche PAS au RDV d’un collègue')

  r = await rest(s.chef.token, 'PATCH', `appointments?id=eq.${a1}`, { status: 'effectue' })
  verdict(okRows(r), 'chef des ventes solde le RDV d’un commercial')

  // ---- profiles / objectif / rôles ----
  r = await rest(s.k.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { full_name: 'RLS k (renommé)' })
  verdict(okRows(r), 'commercial édite son nom')
  await rest(s.k.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { full_name: 'RLS k' })

  r = await rest(s.k.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { role: 'manager' })
  verdict(refused(r), 'AUTO-PROMOTION manager refusée (LE trou fermé)')

  r = await rest(s.k.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { weekly_rdv_target: 99 })
  verdict(refused(r), 'commercial NE change PAS son objectif hebdo')

  r = await rest(s.chef.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { weekly_rdv_target: 42 })
  verdict(refused(r), 'chef des ventes NE change PAS l’objectif hebdo')

  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { weekly_rdv_target: 12 })
  verdict(okRows(r), 'manager fixe l’objectif hebdo')
  await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { weekly_rdv_target: 10 })

  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.manager.id}`, { role: 'commercial' })
  verdict(refused(r), 'manager NE change PAS son propre rôle')

  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k2.id}`, { role: 'chef_ventes' })
  verdict(okRows(r), 'manager attribue un rôle')
  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k2.id}`, { role: 'commercial' })
  verdict(okRows(r), 'manager rétablit le rôle')

  r = await rest(s.chef.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { role: 'secretaire' })
  verdict(refused(r), 'chef des ventes NE gère PAS les comptes')

  // ---- désactivation (kill-switch) ----
  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k2.id}`, { disabled_at: new Date().toISOString() })
  verdict(okRows(r), 'manager désactive un compte')

  r = await rest(s.k2.token, 'GET', `points?select=id&limit=1`)
  verdict(r.status < 300 && Array.isArray(r.data) && r.data.length === 0, 'compte désactivé : plus AUCUNE donnée lisible')

  r = await rest(s.k2.token, 'GET', `profiles?id=eq.${s.k2.id}&select=disabled_at`)
  verdict(okRows(r) && r.data[0].disabled_at !== null, 'compte désactivé : lit encore SON profil (écran dédié)')

  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k2.id}`, { disabled_at: null })
  verdict(okRows(r), 'manager réactive le compte')

  // ---- code d’invitation ----
  r = await rest(s.manager.token, 'GET', 'organization_invites?select=code')
  verdict(okRows(r), 'manager lit le code d’invitation')
  r = await rest(s.chef.token, 'GET', 'organization_invites?select=code')
  verdict(okRows(r), 'chef des ventes lit le code')
  r = await rest(s.k.token, 'GET', 'organization_invites?select=code')
  verdict(r.status < 300 && r.data?.length === 0, 'commercial NE lit PAS le code')
  r = await rest(s.secretaire.token, 'GET', 'organization_invites?select=code')
  verdict(r.status < 300 && r.data?.length === 0, 'secrétaire NE lit PAS le code')

  r = await api('/rest/v1/rpc/regen_invite_code', { method: 'POST', token: s.k.token, body: {} })
  verdict(r.status >= 400, 'commercial NE régénère PAS le code')
  r = await api('/rest/v1/rpc/regen_invite_code', { method: 'POST', token: s.manager.token, body: {} })
  verdict(r.status === 200 && typeof r.data === 'string' && r.data.length === 8, 'manager régénère le code')
  if (r.status === 200) console.log(`      (nouveau code de l’agence de test : ${r.data})`)

  // ---- ménage ----
  for (const id of cleanup.appointments) await rest(s.manager.token, 'DELETE', `appointments?id=eq.${id}`)
  if (cleanup.points.length)
    await rest(s.manager.token, 'DELETE', `points?id=in.(${cleanup.points.join(',')})`)
  const left = await rest(s.manager.token, 'GET', `points?address=eq.${encodeURIComponent('RLS TEST — jetable')}&select=id`)
  if (left.data?.length) await rest(s.manager.token, 'DELETE', `points?address=eq.${encodeURIComponent('RLS TEST — jetable')}`)

  console.log(`\n${pass} PASS, ${fail} ÉCHEC${fail > 1 ? 'S' : ''}.`)
  process.exit(fail ? 1 : 0)
}

const [, , cmd, arg] = process.argv
if (cmd === 'signup') await signup(arg)
else if (cmd === 'run') await run()
else {
  console.log('Usage : node rls-test.mjs signup <CODE>   puis   node rls-test.mjs run')
  process.exit(1)
}
