// ---------------------------------------------------------------------------
// Captures d'écran du Guide v2 (Playwright, viewport iPhone 13).
// Plan de contenu : docs/plan-guides-v2.md (validé briac 27/07).
//
//   node shoot.mjs --probe   → capture l'écran de connexion (valide le pipeline)
//   node shoot.mjs           → connexion + moisson des 11 captures
//
// Prérequis : `npm run dev` lancé dans web/ (http://localhost:5173), et
// GUIDE_EMAIL / GUIDE_PASSWORD dans web/.env (NON versionné).
// Les PNG plein écran sortent dans screenshoots/guide/ ; le RECADRAGE par
// capture vit dans convert.mjs (PNG → WebP vers web/public/guide/).
//
// GARDE-FOU : uniquement des actions en LECTURE (ouvrir des fiches, viser
// sans poser, remplir un formulaire sans l'enregistrer, exclure un pan 3D —
// état local). Ne jamais cliquer Poser / issues / Enregistrer / Supprimer,
// ne jamais draguer un point.
//
// Certaines captures exigent des DONNÉES SEMÉES la veille par briac
// (plan-guides-v2.md § Préparation) : le script vérifie la précondition et
// SAUTE la capture (ancienne image supprimée → placeholder honnête) sinon.
// ---------------------------------------------------------------------------
import { chromium, devices } from 'playwright'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const PROBE = process.argv.includes('--probe')

// --- Adresses figées par capture (surchargées par env si besoin) -----------
// Zone réellement prospectée : Lesneven / Le Folgoët.
const ADDR = {
  // pose-1 (carte + FAB « + ») et pose-2 (visée sur un toit) : un quartier
  // avec des points posés ET une maison visible sous le centre.
  pose: process.env.POSE_ADDR ?? '26 Rue du Rétalaire Le Folgoët',
  // pose-3 : point AVEC section Client (statut À revoir / RDV pris / Vendu)
  // et nom + téléphone renseignés — ≠ du point de relance-1 pour que les
  // deux guides ne montrent pas la même fiche.
  pose3: process.env.POSE3_ADDR ?? '24 Rue du Rétalaire Le Folgoët',
  // relance-1 : point « À revoir » avec « Revoir le » daté. ATTENTION : on
  // centre sur « 18 Rue du Retalaire » (empirique 27/07) — la BAN place le
  // « 26 Rue de la Paix » (adresse du point, géocodage inverse) hors de la
  // grille de balayage, alors que le marqueur est près du 18.
  relance1: process.env.RELANCE1_ADDR ?? '18 Rue du Retalaire Lesneven',
  // rdv-1 : point « RDV pris » SANS RDV à venir → bouton « Planifier »
  // ouvre le formulaire pré-rempli sans rien écrire. Au 27/07 tous les
  // points RDV pris ont leur RDV : briac sème ce point et passe RDV1_ADDR.
  rdv1: process.env.RDV1_ADDR ?? '24 Rue du Rétalaire Le Folgoët',
  // maison-1 : maison SANS point, badges BDNB présents + toit mesuré.
  // Liste de candidates : la BDNB est muette sur certains bâtiments — le
  // script prend la première fiche avec badges (surcharge : MAISON1_ADDR).
  maison1: process.env.MAISON1_ADDR
    ? [process.env.MAISON1_ADDR]
    : [
        '28 Rue de la Paix Le Folgoët',
        '25 Rue de la Paix Le Folgoët',
        '31 Rue du Rétalaire Le Folgoët',
        '33 Rue du Rétalaire Le Folgoët',
        '20 Rue du Retalaire Lesneven',
        '16B Rue du Retalaire Lesneven',
      ],
  // maison-2/3 : maison au toit LISIBLE en 3D (2 pans nets, pas d'annexes
  // excluses qui grisent la maquette) — la fiche maison suffit (module
  // Toiture identique), le 26 Rue du Rétalaire donnait un modèle confus.
  maison2: process.env.MAISON2_ADDR ?? '18 Rue du Retalaire Lesneven',
}

function dotenv(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  } catch {
    return {}
  }
}
const env = dotenv(resolve(root, 'web', '.env'))

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
})
const page = await ctx.newPage()
const VP = page.viewportSize()
const CX = Math.round(VP.width / 2)
const CY = Math.round(VP.height / 2)

const shot = async (name) => {
  // Anti-artefact (audit 27/07) : jamais d'anneau de focus résiduel.
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.waitForTimeout(600)
  await page.screenshot({ path: resolve(OUT, `${name}.png`) })
  console.log(`✔ ${name}.png`)
}

/** Halo orange DA sur la cible d'une étape (décision briac n° 2) : anneau
    sobre injecté sur l'élément réel — suit l'élément, pas de coordonnées. */
const halo = (locator) =>
  locator.evaluate((el) => {
    el.style.outline = '3px solid #f54e00'
    el.style.outlineOffset = '2px'
  })
const unhalo = (locator) =>
  locator.evaluate((el) => {
    el.style.outline = ''
    el.style.outlineOffset = ''
  })

const closeSheet = async () => {
  const close = page.locator('.drawer-content').getByRole('button', { name: 'Fermer' })
  if (await close.count()) {
    await close.first().click()
    await page.waitForTimeout(700)
  }
}

/** Recherche BAN + centrage, puis VIDE la barre (anti-artefact audit 27/07 :
    une adresse tapée + croix dans le cadre = capture de script, pas d'usage).
    3 essais : la BAN répond parfois hors délai sur des appels rapprochés. */
const search = async (addr) => {
  const input = page.getByPlaceholder(/Rechercher/)
  for (let essai = 1; essai <= 3; essai++) {
    await input.fill('')
    await page.waitForTimeout(300)
    await input.fill(addr)
    await page.waitForTimeout(1200 + essai * 800)
    const first = page.locator('.address-results button').first()
    if (await first.count()) {
      await first.click()
      await page.waitForTimeout(4500) // flyTo + tuiles ortho au zoom maison
      await input.fill('')
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.waitForTimeout(400)
      return true
    }
  }
  console.log('  ! aucune suggestion BAN pour', addr)
  return false
}

/** Balayage en grille autour du centre pour ouvrir la fiche d'un POINT
    (tolérance de tap ±14 px) ; `predicate(sheet)` valide la bonne fiche
    (les autres sont refermées). */
const scanForPointSheet = async (predicate) => {
  for (const dy of [0, -26, 26, -52, 52, -78, 78]) {
    for (const dx of [-52, -26, 0, 26, -78, 52, -104, 78]) {
      await page.mouse.click(CX + dx, CY + dy)
      await page.waitForTimeout(1600)
      const sheet = page.locator('.drawer-content')
      if (!(await sheet.count())) continue
      if (await predicate(sheet)) return sheet
      await closeSheet()
    }
  }
  return null
}
const isPointSheet = (sheet) =>
  sheet
    .getByText('Statut', { exact: true })
    .count()
    .then((n) => n > 0)

await page.goto(BASE, { waitUntil: 'networkidle' })

if (PROBE || !env.GUIDE_EMAIL || !env.GUIDE_PASSWORD) {
  await shot('probe-login')
  if (!PROBE) console.log('GUIDE_EMAIL / GUIDE_PASSWORD absents de web/.env — arrêt.')
  await browser.close()
  process.exit(0)
}

// --- Connexion (onglet d'ouverture : Carte) --------------------------------
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(3000)
console.log('Connecté.')

const skipped = []

// === pose-1 : la carte et le bouton « + » (halo) ============================
if (await search(ADDR.pose)) {
  // Dézoome un peu : on veut le QUARTIER avec ses points, pas une maison.
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(2500)
  const fab = page.getByRole('button', { name: 'Poser un point' })
  await halo(fab)
  await shot('pose-1')
  await unhalo(fab)

  // === pose-2 : mode visée, réticule sur un toit ============================
  // Re-centre sur la maison avant d'ouvrir la visée (le réticule = centre).
  await search(ADDR.pose)
  await fab.click()
  await page.waitForTimeout(1500)
  await shot('pose-2')
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForTimeout(700)
} else {
  skipped.push('pose-1', 'pose-2')
}

// === pose-3 : fiche du point — Client, téléphone, note =====================
if (await search(ADDR.pose3)) {
  const sheet = await scanForPointSheet(isPointSheet)
  if (sheet && (await sheet.getByText('Client', { exact: true }).count())) {
    const nom = await sheet.getByPlaceholder(/^Nom/).inputValue()
    if (!nom) console.log('  ! champ Nom vide — capture moins parlante (semis briac ?)')
    // Cadre la section Client + notes (l'en-tête carte et ses pans sortent).
    await sheet.getByText('Client', { exact: true }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await shot('pose-3')
    await closeSheet()
  } else {
    if (sheet) await closeSheet()
    console.log('  ! pose-3 : pas de fiche avec section Client à', ADDR.pose3)
    skipped.push('pose-3')
  }
} else {
  skipped.push('pose-3')
}

// === relance-1 : « Revoir le » daté sur un point À revoir (halo) ===========
if (await search(ADDR.relance1)) {
  const sheet = await scanForPointSheet(async (s) =>
    (await isPointSheet(s)) && (await s.getByText('Revoir le', { exact: true }).count()) > 0,
  )
  if (sheet) {
    const dateInput = sheet.locator('input[type="date"]').first()
    if (!(await dateInput.inputValue()))
      console.log('  ! « Revoir le » vide — semer une date de relance (briac)')
    await sheet.getByText('Revoir le', { exact: true }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await halo(dateInput)
    await shot('relance-1')
    await unhalo(dateInput)
    await closeSheet()
  } else {
    console.log('  ! relance-1 : pas de point « À revoir » à', ADDR.relance1)
    skipped.push('relance-1')
  }
} else {
  skipped.push('relance-1')
}

// === rdv-1 : formulaire pré-rempli via « Planifier » d'un point RDV pris ===
if (await search(ADDR.rdv1)) {
  const sheet = await scanForPointSheet(async (s) =>
    (await isPointSheet(s)) && (await s.getByRole('button', { name: 'Planifier' }).count()) > 0,
  )
  if (sheet) {
    await sheet.getByRole('button', { name: 'Planifier' }).click()
    await page.waitForTimeout(1200)
    const adresse = await page.getByPlaceholder('Adresse', { exact: true }).inputValue()
    if (!adresse) console.log('  ! adresse du formulaire vide — pré-remplissage attendu')
    await shot('rdv-1')
    await page.getByRole('button', { name: 'Annuler', exact: true }).click()
    await page.waitForTimeout(700)
    await closeSheet()
  } else {
    console.log(
      '  ! rdv-1 : pas de point « RDV pris » sans RDV à venir à',
      ADDR.rdv1,
      '(semis briac)',
    )
    skipped.push('rdv-1')
  }
} else {
  skipped.push('rdv-1')
}

// === maison-1 : fiche maison sans point — badges + toit mesuré =============
{
  let done = false
  for (const addr of ADDR.maison1) {
    if (done) break
    if (!(await search(addr))) continue
    await page.mouse.click(CX, CY)
    await page.waitForTimeout(2500)
    const sheet = page.locator('.drawer-content')
    if (!(await sheet.count())) continue
    if (await isPointSheet(sheet)) {
      console.log(`  · maison-1 : ${addr} a déjà un point, candidate suivante`)
      await closeSheet()
      continue
    }
    await page.waitForTimeout(9000) // badges BDNB + mesure laser + pans
    // Au moins 2 vrais badges (année + matériau) : la div .house-badges peut
    // exister vide ou réduite au badge d'attente (24 Rue de la Paix, 27/07).
    if ((await sheet.locator('.house-badges .house-badge').count()) < 2) {
      console.log(`  · maison-1 : pas assez de badges à ${addr}, candidate suivante`)
      await closeSheet()
      continue
    }
    await shot('maison-1')
    await closeSheet()
    done = true
  }
  if (!done) {
    console.log('  ! maison-1 : aucune candidate avec badges — étoffer ADDR.maison1')
    skipped.push('maison-1')
  }
}

// === maison-2 : 3D dépliée, un pan exclu au tap ============================
// === maison-3 : segment Rapport ============================================
if (await search(ADDR.maison2)) {
  await page.mouse.click(CX, CY)
  await page.waitForTimeout(2500)
  const sheet = page.locator('.drawer-content')
  if (await sheet.count()) {
    await page.waitForTimeout(9000) // mesure laser (le module arrive avec elle)
    const roofToggle = sheet.getByRole('button', { name: /Toiture mesurée/ })
    if (await roofToggle.count()) {
      await roofToggle.first().click()
      await page.waitForTimeout(6000) // chunk three + entrée de la maquette
      // Dégage la légende des pans du pied sticky (« Poser · … » la
      // recouvrait — constat n° 8) : on scrolle le module vers le haut.
      await sheet
        .locator('.drawer-body')
        .evaluate((el) => el.scrollBy({ top: 120, behavior: 'instant' }))
      await page.waitForTimeout(500)
      // Tap sur le pan ARRIÈRE de la maquette (raycast local, RIEN n'est
      // écrit en base) : il passe gris + le total Σ se recalcule. Le pan
      // AVANT (essai 27/07) « creusait » la maquette — on vise l'arrière
      // pour garder une maison solide, avec repli si le tap tombe à côté.
      const canvas = sheet.locator('canvas').last()
      const box = await canvas.boundingBox()
      if (box) {
        const sigma = () =>
          sheet
            .getByText(/^Σ/)
            .first()
            .textContent()
            .then((t) => t ?? '')
            .catch(() => '')
        const before = await sigma()
        for (const [fx, fy] of [
          [0.55, 0.18], // bande orange du pan arrière (garde la maison pleine)
          [0.34, 0.3],
          [0.3, 0.38],
          [0.68, 0.45],
        ]) {
          await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
          await page.waitForTimeout(900)
          if ((await sigma()) !== before) break // un pan a bien été exclu
        }
      }
      await shot('maison-2')

      const report = sheet.getByRole('button', { name: 'Rapport', exact: true })
      if (await report.count()) {
        await report.first().click()
        await page.waitForTimeout(2500)
        await shot('maison-3')
        // L'icône d'attribution MapLibre intercepte le clic (overlay sous
        // l'angle du bouton) : force = on clique l'élément résolu tel quel.
        await page
          .getByRole('button', { name: 'Fermer le rapport' })
          .click({ force: true })
        await page.waitForTimeout(800)
      } else {
        skipped.push('maison-3')
      }
    } else {
      console.log('  ! maison-2 : module « Toiture mesurée » absent à', ADDR.maison2)
      skipped.push('maison-2', 'maison-3')
    }
    await closeSheet()
  } else {
    skipped.push('maison-2', 'maison-3')
  }
} else {
  skipped.push('maison-2', 'maison-3')
}

// === rdv-2 : grille du mois, couleurs par commercial, chip Mes RDV (halo) ==
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1800)
const pills = await page.locator('.cal-event').count()
if (pills < 4)
  console.log(`  ! rdv-2 : ${pills} pilule(s) seulement — semer 5-8 RDV depuis 2 comptes (briac)`)
const chip = page.getByRole('button', { name: 'Mes RDV' })
if (await chip.count()) await halo(chip)
await shot('rdv-2')
if (await chip.count()) await unhalo(chip)

// === rdv-3 : sheet du jour avec la rangée d'issues (RDV du jour « à venir »)
const todayCell = page.locator('.cal-cell.is-today')
if (await todayCell.count()) {
  await todayCell.click()
  await page.waitForTimeout(1200)
  if (await page.locator('.appt-outcomes').count()) {
    await shot('rdv-3')
  } else {
    console.log('  ! rdv-3 : aucune rangée d’issues — semer un RDV « à venir » daté du jour (briac)')
    skipped.push('rdv-3')
  }
  await closeSheet()
} else {
  skipped.push('rdv-3')
}

// === relance-2 : Accueil, section « À relancer » ===========================
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.today-card', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1500)
// Le TITRE de la section (pas le « 0 à relancer » de la carte Aujourd'hui,
// faux positif du 27/07) : elle n'existe que si des relances sont échues.
if (await page.locator('.section-title', { hasText: 'À relancer' }).count()) {
  await shot('relance-2')
} else {
  console.log('  ! relance-2 : pas de section « À relancer » — semer une relance échue (briac)')
  skipped.push('relance-2')
}
await shot('accueil') // contrôle visuel des covers, pas une capture du guide

// Une capture sautée ne doit pas laisser un PNG périmé que convert.mjs
// convertirait en toute confiance : on le retire du dossier de moisson.
for (const name of skipped) {
  const stale = resolve(OUT, `${name}.png`)
  if (existsSync(stale)) {
    unlinkSync(stale)
    console.log(`  · ${name}.png périmé supprimé (précondition manquante)`)
  }
}

if (skipped.length) {
  console.log('\nCAPTURES SAUTÉES (précondition manquante) :', skipped.join(', '))
  console.log('→ semis de données à faire par briac (docs/plan-guides-v2.md § Préparation),')
  console.log('  puis relancer : node shoot.mjs && node convert.mjs')
}
await browser.close()
