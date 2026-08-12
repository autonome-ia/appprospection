// =============================================================================
// Semis de l'AGENCE DE DÉMO (guides v3, 10/08) — zéro dépendance (fetch nu).
// Peuple l'agence de test avec des données fictives plausibles couvrant les
// 21 captures des tutos : points de chaque statut, RDV à chaque état (à venir
// aujourd'hui, en attente, vendu, annulé, orphelin pour le popup du matin),
// relance échue, tâches (dont une en retard), 3 commerciaux colorés.
//
//   node seed-demo.mjs signup <CODE>   -> crée les 3 comptes sondes
//   node seed-demo.mjs run             -> vide puis re-sème (rejouable)
//
// GARDE-FOU ANTI-PROD : avant toute écriture, le script liste les profils de
// l'agence du compte sondes — s'il y a UN SEUL membre qui n'est pas un compte
// sondes, il s'arrête net. Impossible d'écrire chez Mister Toiture : Brest.
// =============================================================================

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(here, '..', '..', 'web', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY

const PASSWORD = 'sondes-demo-2026!'
// Prénoms bretons plausibles : ils apparaissent dans les captures (légende
// agenda, notes, rapport client). sondes-1 = LE compte de capture (GUIDE_*).
const ACCOUNTS = [
  { email: 'sondes-1@example.com', name: 'Julien Le Gall', color: '#4263eb' },
  { email: 'sondes-2@example.com', name: 'Marie Tanguy', color: '#c2255c' },
  { email: 'sondes-3@example.com', name: 'Thomas Quéré', color: '#0e9384' },
]

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
    /* 204 */
  }
  if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`)
  return data
}
const rest = (token, method, path, body) =>
  api(`/rest/v1/${path}`, { method, token, body, headers: { Prefer: 'return=representation' } })

/** Coordonnées BAN d'une adresse (les points de démo sont de vraies maisons). */
async function geocode(q) {
  const r = await fetch(
    `https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(q)}&limit=1`,
  )
  const j = await r.json()
  const f = j.features?.[0]
  if (!f) throw new Error(`BAN sans résultat : ${q}`)
  return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties.label }
}

// --- signup ------------------------------------------------------------------
async function signup(code) {
  if (!code) {
    console.error('Usage : node seed-demo.mjs signup <CODE_AGENCE_DEMO>')
    process.exit(1)
  }
  const org = await api('/rest/v1/rpc/validate_invite', { method: 'POST', body: { invite_code: code } })
  if (!org) {
    console.error('Code invalide.')
    process.exit(1)
  }
  console.log(`Code valide — agence « ${org} ».`)
  for (const a of ACCOUNTS) {
    try {
      await api('/auth/v1/signup', {
        method: 'POST',
        body: { email: a.email, password: PASSWORD, data: { invite_code: code, full_name: a.name } },
      })
      console.log(`✔ ${a.email} créé (${a.name})`)
    } catch (e) {
      console.log(`· ${a.email} : ${String(e.message).includes('registered') ? 'existe déjà' : e.message}`)
    }
  }
  console.log(`\nMot de passe des comptes sondes : ${PASSWORD}`)
  console.log('Mettre GUIDE_EMAIL=sondes-1@example.com et GUIDE_PASSWORD dans web/.env, puis « node seed-demo.mjs run ».')
}

// --- run ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Date locale décalée de `days` jours à `h:mm`. */
function at(days, h, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

async function run() {
  // Connexions.
  const s = {}
  for (const a of ACCOUNTS) {
    const r = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: a.email, password: PASSWORD },
    })
    s[a.email] = { token: r.access_token, id: r.user.id, ...a }
  }
  const julien = s['sondes-1@example.com']
  const marie = s['sondes-2@example.com']
  const thomas = s['sondes-3@example.com']

  // Profil + org du compte de capture.
  const me = await rest(julien.token, 'GET', `profiles?id=eq.${julien.id}&select=organization_id`)
  const org = me[0].organization_id

  // ============ GARDE-FOU ANTI-PROD ============
  // L'agence ne doit contenir QUE les comptes sondes — sinon on est ailleurs
  // (Mister Toiture : Brest a 5 vrais membres) : arrêt immédiat.
  const members = await rest(julien.token, 'GET', 'profiles?select=id,full_name')
  const allowed = new Set(Object.values(s).map((x) => x.id))
  const strangers = members.filter((m) => !allowed.has(m.id))
  if (strangers.length > 0) {
    console.error('⛔ REFUS : l’agence contient d’autres membres que les comptes sondes :')
    strangers.forEach((m) => console.error('   -', m.full_name))
    console.error('Ce script n’écrit JAMAIS dans une agence habitée. Vérifie web/.env / le code utilisé.')
    process.exit(1)
  }
  console.log(`Garde-fou OK : agence ${org} — ${members.length} comptes sondes, personne d’autre.`)

  // Couleurs d'agenda (chacun la sienne : profiles_update_self l'autorise).
  for (const x of Object.values(s)) {
    await rest(x.token, 'PATCH', `profiles?id=eq.${x.id}`, { color: x.color })
  }

  // ---- Ménage (rejouable) : Thomas est MANAGER de l'agence de démo (SQL
  // briac 10/08) — il purge TOUT, y compris les vieux points de test de
  // l'époque où l'agence servait à briac. Repli si pas encore promu :
  // chaque compte supprime les siens (les vieux restent).
  const thomasRole = (await rest(thomas.token, 'GET', `profiles?id=eq.${thomas.id}&select=role`))[0]?.role
  if (thomasRole === 'manager') {
    await rest(thomas.token, 'DELETE', 'appointments?id=not.is.null')
    // Les point_events suivent par cascade FK.
    await rest(thomas.token, 'DELETE', 'points?id=not.is.null')
    console.log('Agence entièrement purgée (Thomas manager).')
  } else {
    for (const x of Object.values(s)) {
      await rest(x.token, 'DELETE', `appointments?commercial_id=eq.${x.id}`)
      await rest(x.token, 'DELETE', `points?created_by=eq.${x.id}`)
    }
    console.log('⚠ Purge partielle (Thomas pas encore manager) : les vieux points de test restent.')
  }

  // ---- Helpers d'écriture (mêmes payloads que l'app) ----
  async function point(owner, addr, status, extra = {}, occurredAt = null) {
    const g = await geocode(addr)
    const rows = await rest(owner.token, 'POST', 'points', {
      organization_id: org,
      created_by: owner.id,
      status,
      lat: g.lat,
      lng: g.lng,
      address: g.label,
      notes: extra.note ?? null,
      client_name: extra.client ?? null,
      client_phone: extra.phone ?? null,
      revisit_at: extra.revisit ?? null,
    })
    const p = rows[0]
    await rest(owner.token, 'POST', 'point_events', {
      organization_id: org,
      point_id: p.id,
      author_id: owner.id,
      status,
      note: extra.note ?? null,
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
    })
    return p
  }
  async function rdv(owner, when, status, extra = {}) {
    const rows = await rest(owner.token, 'POST', 'appointments', {
      organization_id: org,
      created_by: owner.id,
      commercial_id: owner.id,
      point_id: extra.point ?? null,
      scheduled_at: when,
      address: extra.address ?? null,
      client_name: extra.client ?? null,
      client_phone: extra.phone ?? null,
      notes: extra.note ?? null,
      status,
      kind: extra.kind ?? 'rdv',
    })
    return rows[0]
  }
  /** Porte « décor » : un événement de tournée passé (tunnel + graphe). */
  async function porte(owner, addr, status, daysAgo, hour) {
    await point(owner, addr, status, {}, at(-daysAgo, hour))
  }

  // ---- Le décor : la semaine de Julien (tunnel, graphe, carte) ----
  console.log('Semis en cours (géocodage BAN, ~1 min)…')
  const DECOR = [
    ['8 Rue Alsace Lorraine 29260 Lesneven', 'absent', 4, 10],
    ['10 Rue Alsace Lorraine 29260 Lesneven', 'absent', 4, 10],
    ['3 Rue des Remparts 29260 Lesneven', 'hors_cible', 4, 11],
    ['12 Rue Notre Dame 29260 Lesneven', 'absent', 3, 9],
    ['14 Rue Notre Dame 29260 Lesneven', 'impossible', 3, 10],
    ['5 Rue du Comte Even 29260 Lesneven', 'absent', 2, 14],
    ['9 Rue du Comte Even 29260 Lesneven', 'absent', 2, 15],
    ['2 Rue de Jerusalem 29260 Lesneven', 'absent', 1, 10],
    ['11 Place le Flo 29260 Lesneven', 'hors_cible', 1, 11],
  ]
  for (const [addr, st, d, h] of DECOR) await porte(julien, addr, st, d, h)

  // ---- Les acteurs des captures ----
  // Relance ÉCHUE (Accueil « À relancer », chip carte, agenda ambre).
  await point(julien, '15 Rue de la Marne 29260 Lesneven', 'a_revoir', {
    client: 'Mme Salaün',
    phone: '06 71 42 88 19',
    note: 'Repasser en fin de journée — mari présent après 18 h.',
    revisit: dayKey(new Date()),
  })
  // Relance datée à venir.
  await point(julien, '22 Rue de la Marne 29260 Lesneven', 'a_revoir', {
    client: 'M. Guiziou',
    note: 'Intéressé pour l’an prochain, rappeler après les impôts.',
    revisit: dayKey(new Date(Date.now() + 7 * 864e5)),
  })
  // RDV pris AUJOURD'HUI (planning du jour, solder, fiche, contact).
  const caradec = await point(julien, '6 Rue Dixmude 29260 Lesneven', 'rdv_pris', {
    client: 'M. et Mme Caradec',
    phone: '06 63 05 47 92',
    note: 'Ardoises en fin de vie côté rue — devis complet à préparer.',
  })
  await rdv(julien, at(0, 17, 30), 'a_venir', {
    point: caradec.id,
    address: caradec.address,
    client: 'M. et Mme Caradec',
    phone: '06 63 05 47 92',
  })
  // VENDU hier (pastille verte, tunnel, statut Client sur la carte).
  const abgrall = await point(julien, '4 Rue de Verdun 29260 Lesneven', 'vendu', {
    client: 'Famille Abgrall',
    phone: '06 88 12 30 54',
  }, at(-1, 10))
  await rdv(julien, at(-1, 10), 'vendu', {
    point: abgrall.id,
    address: abgrall.address,
    client: 'Famille Abgrall',
  })
  // EN ATTENTE (issues Vendu/Refus encore ouvertes dans la fiche). Depuis le
  // 12/08 le point RESTE « RDV pris » (relance posée, statut intact).
  const leon = await point(julien, '18 Rue du Général de Gaulle 29260 Lesneven', 'rdv_pris', {
    client: 'M. Léon',
    phone: '06 52 77 41 08',
    note: 'Devis remis, réfléchit avec son fils.',
    revisit: dayKey(new Date(Date.now() + 4 * 864e5)),
  })
  await rdv(julien, at(-3, 11), 'effectue', {
    point: leon.id,
    address: leon.address,
    client: 'M. Léon',
  })
  // ANNULÉ (bouton « Replanifier »).
  const inizan = await point(julien, '25 Rue de Brest 29260 Lesneven', 'rdv_pris', {
    client: 'Mme Inizan',
    phone: '06 45 90 13 66',
  })
  await rdv(julien, at(-1, 15), 'annule', {
    point: inizan.id,
    address: inizan.address,
    client: 'Mme Inizan',
  })
  // RDV passé SANS issue (popup du matin, via ?popup-rdv).
  const kerbrat = await point(julien, '31 Rue de Brest 29260 Lesneven', 'rdv_pris', {
    client: 'M. Kerbrat',
    phone: '06 09 34 72 15',
  })
  await rdv(julien, at(-1, 18), 'a_venir', {
    point: kerbrat.id,
    address: kerbrat.address,
    client: 'M. Kerbrat',
  })
  // Tâches : une aujourd'hui, une EN RETARD (Accueil).
  await rdv(julien, at(0, 12), 'a_venir', { kind: 'tache', note: 'Récupérer l’acompte Caradec' })
  await rdv(julien, at(-2, 9), 'a_venir', { kind: 'tache', note: 'Reposer le panneau chantier Abgrall' })

  // ---- Les collègues : la grille du mois en couleurs ----
  await rdv(marie, at(2, 10), 'a_venir', { client: 'M. Kerouanton', address: 'Rue de la Libération, Lesneven' })
  await rdv(marie, at(5, 14, 30), 'a_venir', { client: 'Mme Bihan', address: 'Le Folgoët' })
  await rdv(thomas, at(1, 9), 'a_venir', { client: 'M. Cloarec', address: 'Rue Georges Le Bail, Lesneven' })
  await rdv(thomas, at(3, 16), 'a_venir', { client: 'Famille Roudaut', address: 'Plouider' })
  // Leurs portes du jour (feed / stats équipe plausibles).
  await porte(marie, '7 Place du Château 29260 Lesneven', 'absent', 0, 9)
  await porte(thomas, '1 Rue Général le Flo 29260 Lesneven', 'absent', 0, 10)

  const pts = await rest(julien.token, 'GET', 'points?select=id')
  const appts = await rest(julien.token, 'GET', 'appointments?select=id')
  console.log(`✔ Semis terminé : ${pts.length} points, ${appts.length} entrées d'agenda.`)
}

const [, , cmd, arg] = process.argv
if (cmd === 'signup') await signup(arg)
else if (cmd === 'run') await run()
else {
  console.log('Usage : node seed-demo.mjs signup <CODE>   puis   node seed-demo.mjs run')
  process.exit(1)
}
