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

async function login() {
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
  return s
}

async function run() {
  const s = await login()
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

  // ---- matrice v2 secrétaire (db/0024) ----
  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { scheduled_at: new Date(Date.now() + 7200e3).toISOString() })
  verdict(okRows(r), 'v2 : secrétaire DÉCALE le RDV d’un commercial')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { commercial_id: s.k2.id })
  verdict(okRows(r), 'v2 : secrétaire RÉATTRIBUE le RDV à un autre commercial')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { commercial_id: crypto.randomUUID() })
  verdict(refused(r), 'v2 : réattribution hors agence refusée')

  r = await rest(s.k.token, 'POST', 'appointments', RDV(s.k.id, s.k.id, 'tache'))
  const t1 = r.data?.[0]?.id
  if (t1) cleanup.appointments.push(t1)
  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${t1}`, { notes: 'RLS TEST s' })
  verdict(refused(r), 'v2 : secrétaire NE touche PAS une tâche')

  r = await rest(s.secretaire.token, 'DELETE', `appointments?id=eq.${a1}`)
  verdict(refused(r), 'v2 : secrétaire NE supprime PAS un RDV')

  r = await api('/rest/v1/rpc/book_rdv_for', { method: 'POST', token: s.secretaire.token, body: { p_point_id: p1, p_commercial_id: s.k.id, p_scheduled_at: new Date(Date.now() + 86400e3).toISOString(), p_client_name: 'RLS TEST book' } })
  verdict(r.status === 200 && typeof r.data === 'string', 'v2 : book_rdv_for — secrétaire lie un RDV au point d’un commercial', JSON.stringify(r.data))
  if (typeof r.data === 'string') cleanup.appointments.push(r.data)
  r = await rest(s.manager.token, 'GET', `points?id=eq.${p1}&select=status,client_name`)
  verdict(r.data?.[0]?.status === 'rdv_pris' && r.data?.[0]?.client_name === 'RLS TEST book', 'v2 : le point est passé « RDV pris », client synchronisé', JSON.stringify(r.data))
  r = await rest(s.manager.token, 'GET', `point_events?point_id=eq.${p1}&status=eq.rdv_pris&select=author_id`)
  verdict(r.data?.some((e) => e.author_id === s.k.id), 'v2 : le journal « RDV pris » est signé du COMMERCIAL')

  r = await api('/rest/v1/rpc/book_rdv_for', { method: 'POST', token: s.k.token, body: { p_point_id: p1, p_commercial_id: s.k2.id, p_scheduled_at: new Date().toISOString() } })
  verdict(r.status >= 400, 'v2 : book_rdv_for — un commercial NE prend PAS de RDV pour un collègue')

  r = await api('/rest/v1/rpc/book_rdv_for', { method: 'POST', token: s.secretaire.token, body: { p_point_id: p1, p_commercial_id: crypto.randomUUID(), p_scheduled_at: new Date().toISOString() } })
  verdict(r.status >= 400, 'v2 : book_rdv_for — titulaire hors agence refusé')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { status: 'annule' })
  verdict(okRows(r), 'v2 : secrétaire ANNULE le RDV d’un commercial')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a1}`, { scheduled_at: new Date().toISOString() })
  verdict(refused(r), 'v2 : un RDV annulé n’est plus modifiable par la secrétaire')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a2}`, { scheduled_at: new Date(Date.now() + 3600e3).toISOString() })
  verdict(okRows(r), 'secrétaire décale le RDV qu’elle a créé')

  r = await rest(s.secretaire.token, 'PATCH', `appointments?id=eq.${a2}`, { status: 'vendu' })
  verdict(refused(r), 'secrétaire NE marque PAS « Vendu », même sur son RDV')

  // a2 (titulaire k) : a1 a été réattribué à k2 plus haut (matrice v2), il
  // en est devenu titulaire — le test visait le mauvais RDV.
  r = await rest(s.k2.token, 'PATCH', `appointments?id=eq.${a2}`, { status: 'annule' })
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

// --- Phase « numbers » (db/0031, chantier Numbers) ----------------------------
// Prérequis : 0031 exécutée ET option activée sur l'agence de test :
//   select public.numbers_activate(id) from public.organizations where name = 'RLS Test — jetable';

async function runNumbers() {
  const s = await login()
  const org = s.k.org
  const rpc = (who, fn, body) => api(`/rest/v1/rpc/${fn}`, { method: 'POST', token: s[who].token, body })
  const SALE = (seller1_id, extra = {}) => ({
    organization_id: org,
    seller1_id,
    sold_on: new Date().toISOString().slice(0, 10),
    client_name: 'RLS TEST vente',
    address: 'RLS TEST — jetable',
    prestation: 'toiture',
    amount_ht: 10000,
    payment: 'comptant',
    origin: 'prospection',
    ...extra,
  })
  const cleanup = { sales: [], points: [], appointments: [] }

  let r = await rest(s.k.token, 'GET', 'commission_rates?select=prestation,rate')
  if (!(r.status < 300 && r.data?.length === 6)) {
    console.error('Taux de l’agence de test absents : 0031 exécutée ? numbers_activate lancé sur « RLS Test — jetable » ?')
    process.exit(1)
  }

  // ---- création ----
  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id))
  verdict(okRows(r), 'commercial enregistre SA vente', JSON.stringify(r.data))
  const v1 = r.data?.[0]
  if (v1) cleanup.sales.push(v1.id)
  verdict(Number(v1?.rate1) === 0.13, 'taux figé posé par la base (toiture 13 %)', `rate1=${v1?.rate1}`)
  verdict(v1?.created_by === s.k.id && v1?.status === 'active', 'created_by et statut posés par la base')

  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k2.id))
  verdict(refused(r), 'commercial NE crée PAS une vente au seul nom d’un collègue')

  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id, { seller2_id: s.k.id }))
  verdict(refused(r), 'vente à deux avec deux fois le même vendeur refusée')

  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id, { seller2_id: crypto.randomUUID() }))
  verdict(refused(r), '2e vendeur hors agence refusé')

  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id, { seller2_id: s.secretaire.id }))
  verdict(refused(r), 'la secrétaire ne peut pas être vendeuse')

  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id, { payment: 'financement', financed_ht: 20000 }))
  verdict(refused(r), 'montant financé > montant de la vente refusé')

  r = await rest(s.secretaire.token, 'POST', 'sales', SALE(s.k.id))
  verdict(refused(r), 'secrétaire NE crée PAS de vente')

  // ---- lecture ----
  r = await rest(s.k2.token, 'GET', `sales?id=eq.${v1?.id}&select=id`)
  verdict(r.status < 300 && r.data?.length === 0, 'commercial NE lit PAS la vente complète d’un collègue (cahier)')

  r = await rest(s.k2.token, 'GET', `sales_board?id=eq.${v1?.id}&select=id,amount_ht,seller1_id`)
  verdict(okRows(r) && Number(r.data[0].amount_ht) === 10000, 'commercial lit le tableau de l’agence (montant, vendeur)')

  r = await rest(s.k2.token, 'GET', `sales_board?select=client_name&limit=1`)
  verdict(r.status >= 400, 'le tableau de l’agence N’expose PAS le client')

  r = await rest(s.secretaire.token, 'GET', `sales_board?select=id`)
  verdict(r.status < 300 && r.data?.length === 0, 'secrétaire NE lit PAS le tableau de l’agence')
  r = await rest(s.secretaire.token, 'GET', `sales?select=id`)
  verdict(r.status < 300 && r.data?.length === 0, 'secrétaire NE lit AUCUNE vente')
  r = await rest(s.secretaire.token, 'GET', `commission_rates?select=rate`)
  verdict(r.status < 300 && r.data?.length === 0, 'secrétaire NE lit PAS les taux')

  r = await rest(s.chef.token, 'GET', `sales?id=eq.${v1?.id}&select=id,client_name`)
  verdict(okRows(r), 'chef des ventes lit le cahier de l’agence')

  // ---- modification ----
  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v1?.id}`, { rate1: 0.5 })
  verdict(okRows(r) && Number(r.data[0].rate1) === 0.13, 'commercial NE réécrit PAS son taux (reste 13 %)', JSON.stringify(r.data))

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v1?.id}`, { amount_ht: 12000, note: 'RLS TEST' })
  verdict(okRows(r), 'commercial modifie SA vente')

  r = await rest(s.k2.token, 'PATCH', `sales?id=eq.${v1?.id}`, { amount_ht: 1 })
  verdict(refused(r), 'commercial NE modifie PAS la vente d’un collègue')

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v1?.id}`, { seller2_id: s.k2.id })
  verdict(okRows(r) && Number(r.data[0].rate2) === 0.13, 'vente passée à deux : taux du 2e vendeur posé')

  r = await rest(s.k2.token, 'PATCH', `sales?id=eq.${v1?.id}`, { note: 'RLS TEST k2' })
  verdict(okRows(r), 'le 2e vendeur modifie la vente commune')

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v1?.id}`, { seller1_id: s.k2.id, seller2_id: null })
  verdict(refused(r), 'un vendeur NE se retire PAS en donnant la vente à un autre')

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v1?.id}`, { organization_id: crypto.randomUUID() })
  verdict(refused(r), 'agence d’une vente immuable')

  r = await rest(s.chef.token, 'PATCH', `sales?id=eq.${v1?.id}`, { note: 'RLS TEST chef' })
  verdict(refused(r), 'chef des ventes SANS le droit NE modifie PAS')

  r = await rest(s.chef.token, 'PATCH', `profiles?id=eq.${s.chef.id}`, { can_edit_sales: true })
  verdict(refused(r), 'chef des ventes NE se donne PAS le droit de modifier')

  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.chef.id}`, { can_edit_sales: true })
  verdict(okRows(r), 'manager donne le droit de modifier au chef des ventes')
  r = await rest(s.chef.token, 'PATCH', `sales?id=eq.${v1?.id}`, { note: 'RLS TEST chef' })
  verdict(okRows(r), 'chef des ventes AVEC le droit modifie')
  await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.chef.id}`, { can_edit_sales: false })

  r = await rest(s.manager.token, 'PATCH', `sales?id=eq.${v1?.id}`, { amount_ht: 11000 })
  verdict(okRows(r), 'manager modifie la vente d’un commercial')

  // ---- objectifs et taux ----
  r = await rest(s.k.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { monthly_ca_target: 999999 })
  verdict(refused(r), 'commercial NE fixe PAS son objectif de CA')
  r = await rest(s.chef.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { monthly_ca_target: 1 })
  verdict(refused(r), 'chef des ventes NE fixe PAS l’objectif de CA')
  r = await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { monthly_ca_target: 40000 })
  verdict(okRows(r), 'manager fixe l’objectif de CA mensuel')
  await rest(s.manager.token, 'PATCH', `profiles?id=eq.${s.k.id}`, { monthly_ca_target: 0 })

  r = await rest(s.k.token, 'PATCH', `commission_rates?prestation=eq.toiture`, { rate: 0.5 })
  verdict(refused(r), 'commercial NE change PAS les taux de l’agence')
  r = await rest(s.k.token, 'POST', 'profile_commission_rates', { profile_id: s.k.id, prestation: 'gouttiere', organization_id: org, rate: 0.5 })
  verdict(refused(r), 'commercial NE se donne PAS un taux personnel')

  r = await rest(s.manager.token, 'POST', 'profile_commission_rates', { profile_id: s.k.id, prestation: 'gouttiere', organization_id: org, rate: 0.1 })
  verdict(okRows(r), 'manager surcharge le taux gouttière d’un commercial (10 %)')
  r = await rest(s.k.token, 'POST', 'sales', SALE(s.k.id, { prestation: 'gouttiere', amount_ht: 2000 }))
  verdict(okRows(r) && Number(r.data[0].rate1) === 0.1, 'nouvelle vente gouttière : taux personnel appliqué', JSON.stringify(r.data))
  const v2 = r.data?.[0]
  if (v2) cleanup.sales.push(v2.id)
  r = await rest(s.k2.token, 'GET', `profile_commission_rates?profile_id=eq.${s.k.id}&select=rate`)
  verdict(r.status < 300 && r.data?.length === 0, 'commercial NE lit PAS le taux personnel d’un collègue')
  await rest(s.manager.token, 'DELETE', `profile_commission_rates?profile_id=eq.${s.k.id}`)
  r = await rest(s.k.token, 'GET', `sales?id=eq.${v2?.id}&select=rate1`)
  verdict(Number(r.data?.[0]?.rate1) === 0.1, 'taux figé : la vente passée garde 10 % après retour au défaut')

  // ---- « Vendu » → vente, puis annulation (D16) ----
  r = await rest(s.k.token, 'POST', 'points', { organization_id: org, created_by: s.k.id, status: 'vendu', lat: 48, lng: -4, address: 'RLS TEST — jetable', client_name: 'RLS TEST client' })
  const pv = r.data?.[0]?.id
  if (pv) cleanup.points.push(pv)
  r = await rest(s.k.token, 'POST', 'point_events', { organization_id: org, point_id: pv, author_id: s.k.id, status: 'vendu' })
  const ev = r.data?.[0]?.id
  r = await rest(s.k.token, 'POST', 'appointments', { organization_id: org, created_by: s.k.id, commercial_id: s.k.id, point_id: pv, scheduled_at: new Date().toISOString(), client_name: 'RLS TEST client', status: 'vendu' })
  const av = r.data?.[0]?.id
  if (av) cleanup.appointments.push(av)
  verdict(Boolean(pv && ev && av), 'décor : point, événement « vendu » et RDV « Vendu »')

  r = await rpc('k2', 'ensure_vendu_sale', { p_point: pv, p_appointment: av })
  verdict(r.status >= 400, 'ensure_vendu_sale : un collègue NE crée PAS la vente d’un autre')

  r = await rpc('k', 'ensure_vendu_sale', { p_point: pv, p_appointment: av })
  verdict(r.status === 200 && typeof r.data === 'string', 'ensure_vendu_sale crée la vente « à compléter »', JSON.stringify(r.data))
  const v3 = r.data
  if (typeof v3 === 'string') cleanup.sales.push(v3)
  r = await rpc('k', 'ensure_vendu_sale', { p_point: pv, p_appointment: av })
  verdict(r.data === v3, 'ensure_vendu_sale rappelé : même vente (pas de doublon)')
  r = await rest(s.k.token, 'GET', `sales?id=eq.${v3}&select=event_id,appointment_id,seller1_id,amount_ht,client_name`)
  const row = r.data?.[0]
  verdict(
    row?.event_id === ev && row?.appointment_id === av && row?.seller1_id === s.k.id && row?.amount_ht === null && row?.client_name === 'RLS TEST client',
    'vente liée à l’événement et au RDV, vendeur = auteur, montant à compléter',
    JSON.stringify(row),
  )

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v3}`, { status: 'annulee' })
  verdict(okRows(r) && Boolean(r.data[0].cancelled_at), 'le vendeur annule SA vente')
  const [pp, ee, aa] = await Promise.all([
    rest(s.manager.token, 'GET', `points?id=eq.${pv}&select=status`),
    rest(s.manager.token, 'GET', `point_events?id=eq.${ev}&select=status`),
    rest(s.manager.token, 'GET', `appointments?id=eq.${av}&select=status`),
  ])
  verdict(pp.data?.[0]?.status === 'impossible', 'annulation : le point passe « Refus »', JSON.stringify(pp.data))
  verdict(ee.data?.[0]?.status === 'impossible', 'annulation : l’événement « vendu » est réécrit (plus de vente au tunnel)', JSON.stringify(ee.data))
  verdict(aa.data?.[0]?.status === 'refus', 'annulation : le RDV « Vendu » passe « Refus »', JSON.stringify(aa.data))
  r = await rest(s.manager.token, 'GET', `point_events?point_id=eq.${pv}&select=id`)
  verdict(r.data?.length === 1, 'annulation : AUCUN nouvel événement (la porte ne compte pas deux fois)')

  r = await rest(s.k.token, 'PATCH', `sales?id=eq.${v3}`, { status: 'active' })
  verdict(refused(r), 'le commercial NE réactive PAS une vente annulée')
  r = await rest(s.manager.token, 'PATCH', `sales?id=eq.${v3}`, { status: 'active' })
  verdict(okRows(r) && r.data[0].cancelled_at === null, 'le manager réactive la vente')
  const [pp2, ee2, aa2] = await Promise.all([
    rest(s.manager.token, 'GET', `points?id=eq.${pv}&select=status`),
    rest(s.manager.token, 'GET', `point_events?id=eq.${ev}&select=status`),
    rest(s.manager.token, 'GET', `appointments?id=eq.${av}&select=status`),
  ])
  verdict(
    pp2.data?.[0]?.status === 'vendu' && ee2.data?.[0]?.status === 'vendu' && aa2.data?.[0]?.status === 'vendu',
    'réactivation : point, journal et RDV reviennent à « Vendu »',
  )

  // ---- suppression ----
  r = await rest(s.k.token, 'DELETE', `sales?id=eq.${v1?.id}`)
  verdict(refused(r), 'commercial NE supprime PAS de vente (il annule)')
  r = await rest(s.manager.token, 'DELETE', `sales?id=eq.${v1?.id}`)
  verdict(okRows(r), 'manager supprime une vente')

  // ---- ménage ----
  if (cleanup.sales.length) await rest(s.manager.token, 'DELETE', `sales?id=in.(${cleanup.sales.join(',')})`)
  for (const id of cleanup.appointments) await rest(s.manager.token, 'DELETE', `appointments?id=eq.${id}`)
  if (cleanup.points.length) await rest(s.manager.token, 'DELETE', `points?id=in.(${cleanup.points.join(',')})`)

  console.log(`\n${pass} PASS, ${fail} ÉCHEC${fail > 1 ? 'S' : ''}.`)
  process.exit(fail ? 1 : 0)
}

const [, , cmd, arg] = process.argv
if (cmd === 'signup') await signup(arg)
else if (cmd === 'run') await run()
else if (cmd === 'numbers') await runNumbers()
else {
  console.log('Usage : node rls-test.mjs signup <CODE>   puis   node rls-test.mjs run | numbers')
  process.exit(1)
}
