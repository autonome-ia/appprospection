// ---------------------------------------------------------------------------
// Captures d'écran du Guide v3 (Playwright, viewport iPhone 13) — 10/08.
// UN GUIDE PAR ONGLET (+ le toit) : 22 captures, nommées <guide>-<étape>.png.
//
//   node shoot.mjs           → connexion compte sondes + moisson des 22
//   node shoot.mjs --probe   → capture l'écran de connexion (valide le pipeline)
//
// Prérequis : `npm run dev` dans web/, ET l'agence de démo semée
// (`node seed-demo.mjs run`) — le compte GUIDE_EMAIL de web/.env est
// sondes-1@example.com (Julien Le Gall), agence de démo UNIQUEMENT.
//
// GARDE-FOU : lecture seule. Exceptions bornées et sans écriture en base :
//   * ouvrir des fiches/formulaires sans jamais Enregistrer/Poser/issues ;
//   * exclure un pan 3D (état local) ;
//   * carte-6 : l'appui long DÉMARRE un drag (fantôme à l'écran) puis la page
//     est RECHARGÉE sans relâcher — l'écriture n'a jamais lieu ;
//   * « Plus tard » du popup du matin (localStorage du compte sondes).
// ---------------------------------------------------------------------------
import { chromium, devices } from 'playwright'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const PROBE = process.argv.includes('--probe')

// --- Adresses figées (l'agence de démo est semée par seed-demo.mjs) --------
const ADDR = {
  quartier: '8 Rue Alsace Lorraine 29260 Lesneven', // décor : points posés autour
  caradec: '6 Rue Dixmude 29260 Lesneven', // RDV pris + client + note (carte-3)
  drag: '10 Rue Alsace Lorraine 29260 Lesneven', // point « décor » pour carte-6
  // carte-4 : maison SANS point avec badges BDNB (Le Folgoët, hors semis).
  maison: [
    '28 Rue de la Paix Le Folgoët',
    '25 Rue de la Paix Le Folgoët',
    '31 Rue du Rétalaire Le Folgoët',
    '33 Rue du Rétalaire Le Folgoët',
  ],
  // toit-1/2/3 : toit LISIBLE en 3D (2 pans nets — étalon v2).
  toit: '18 Rue du Retalaire Lesneven',
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
if (!/^sondes-/.test(env.GUIDE_EMAIL ?? '')) {
  console.error('⛔ GUIDE_EMAIL n’est pas un compte sondes (web/.env) — jamais de captures sur la prod.')
  process.exit(1)
}

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
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.waitForTimeout(600)
  await page.screenshot({ path: resolve(OUT, `${name}.png`) })
  console.log(`✔ ${name}.png`)
}

/** Halo orange DA sur la cible d'une étape : anneau injecté sur l'élément réel. */
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

/** Recherche BAN + centrage, puis VIDE la barre (anti-artefact). */
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

/** Balayage en grille autour du centre pour ouvrir la fiche d'un POINT —
    le CENTRE d'abord : les points semés sont exactement aux coordonnées BAN. */
const scanForPointSheet = async (predicate) => {
  for (const dy of [0, -26, 26, -52, 52, -78, 78]) {
    for (const dx of [0, -26, 26, -52, 52, -78, -104, 78]) {
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

const login = async () => {
  await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
  await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForSelector('canvas', { timeout: 20000 })
  await page.waitForTimeout(3000)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
if (PROBE || !env.GUIDE_EMAIL || !env.GUIDE_PASSWORD) {
  await shot('probe-login')
  await browser.close()
  process.exit(0)
}
await login()
console.log(`Connecté (${env.GUIDE_EMAIL}).`)

const skipped = []

// ============================== LA CARTE ====================================

// carte-1 : le quartier + FAB « + » (halo).
if (await search(ADDR.quartier)) {
  await page.mouse.wheel(0, 400) // le QUARTIER, pas une maison
  await page.waitForTimeout(2500)
  const fab = page.getByRole('button', { name: 'Poser un point' })
  await halo(fab)
  await shot('carte-1')
  await unhalo(fab)

  // carte-2 : mode visée — réticule + GRILLE des 6 statuts.
  await search(ADDR.quartier)
  await fab.click()
  await page.waitForTimeout(1500)
  await shot('carte-2')
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForTimeout(700)
} else {
  skipped.push('carte-1', 'carte-2')
}

// carte-3 : la fiche du point Caradec (client + téléphone + note).
if (await search(ADDR.caradec)) {
  const sheet = await scanForPointSheet(async (s) =>
    (await isPointSheet(s)) && (await s.getByText('Client', { exact: true }).count()) > 0,
  )
  if (sheet) {
    await sheet.getByText('Client', { exact: true }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await shot('carte-3')
    await closeSheet()
  } else {
    console.log('  ! carte-3 : fiche Caradec introuvable — seed-demo.mjs passé ?')
    skipped.push('carte-3')
  }
} else {
  skipped.push('carte-3')
}

// carte-4 : la fiche maison SANS point (badges + toit mesuré).
{
  let done = false
  for (const addr of ADDR.maison) {
    if (done) break
    if (!(await search(addr))) continue
    await page.mouse.click(CX, CY)
    await page.waitForTimeout(2500)
    const sheet = page.locator('.drawer-content')
    if (!(await sheet.count())) continue
    if (await isPointSheet(sheet)) {
      await closeSheet()
      continue
    }
    await page.waitForTimeout(9000) // badges BDNB + mesure laser
    if ((await sheet.locator('.house-badges .house-badge').count()) < 2) {
      console.log(`  · carte-4 : pas assez de badges à ${addr}`)
      await closeSheet()
      continue
    }
    await shot('carte-4')
    await closeSheet()
    done = true
  }
  if (!done) skipped.push('carte-4')
}

// carte-5 : la barre de filtres dépliée (halo sur le bouton).
{
  const filterBtn = page.getByRole('button', { name: /[Ff]iltre/ })
  if (await filterBtn.count()) {
    await filterBtn.first().click()
    await page.waitForTimeout(900)
    await halo(filterBtn.first())
    await shot('carte-5')
    await unhalo(filterBtn.first())
    await filterBtn.first().click() // referme
    await page.waitForTimeout(500)
  } else {
    console.log('  ! carte-5 : bouton filtres introuvable')
    skipped.push('carte-5')
  }
}

// ========================= MESURER UN TOIT ==================================

if (await search(ADDR.toit)) {
  await page.mouse.click(CX, CY)
  await page.waitForTimeout(2500)
  const sheet = page.locator('.drawer-content')
  if (await sheet.count()) {
    await page.waitForTimeout(9000) // mesure laser + pans dessinés sur l'ortho
    // toit-1 : les pans + pastilles m² sur la photo, fiche en pied.
    await shot('toit-1')
    const roofToggle = sheet.getByRole('button', { name: /Toiture mesurée/ })
    if (await roofToggle.count()) {
      await roofToggle.first().click()
      await page.waitForTimeout(6000) // chunk three + entrée de la maquette
      await sheet
        .locator('.drawer-body')
        .evaluate((el) => el.scrollBy({ top: 120, behavior: 'instant' }))
      await page.waitForTimeout(500)
      // toit-2 : un pan exclu au tap (raycast local, rien en base).
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
          [0.55, 0.18],
          [0.34, 0.3],
          [0.3, 0.38],
          [0.68, 0.45],
        ]) {
          await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
          await page.waitForTimeout(900)
          if ((await sigma()) !== before) break
        }
      }
      await shot('toit-2')
      // toit-3 : le rapport client.
      const report = sheet.getByRole('button', { name: 'Rapport', exact: true })
      if (await report.count()) {
        await report.first().click()
        await page.waitForTimeout(2500)
        await shot('toit-3')
        await page.getByRole('button', { name: 'Fermer le rapport' }).click({ force: true })
        await page.waitForTimeout(800)
      } else {
        skipped.push('toit-3')
      }
    } else {
      skipped.push('toit-2', 'toit-3')
    }
    await closeSheet()
  } else {
    skipped.push('toit-1', 'toit-2', 'toit-3')
  }
} else {
  skipped.push('toit-1', 'toit-2', 'toit-3')
}

// ============================== L'AGENDA ====================================

await page.getByRole('button', { name: 'Agenda', exact: true }).click()
await page.waitForTimeout(2200)

// agenda-1 : la grille du mois (couleurs + pastilles de type).
if ((await page.locator('.cal-event').count()) < 4)
  console.log('  ! agenda-1 : peu de pilules — seed-demo.mjs passé ?')
await shot('agenda-1')

// agenda-2 : la légende-filtre (halo sur la rangée de chips).
{
  const chips = page.locator('.agenda-mine')
  await halo(chips)
  await shot('agenda-2')
  await unhalo(chips)
}

// agenda-3/4/6 : le planning du jour (Caradec 17 h 30 + tâche acompte).
{
  const todayCell = page.locator('.cal-cell.is-today')
  await todayCell.click()
  await page.waitForTimeout(1400)
  const daySheet = page.locator('.drawer-content')
  if (await daySheet.count()) {
    await shot('agenda-3')
    const outcomes = daySheet.locator('.appt-outcomes').first()
    if (await outcomes.count()) {
      await halo(outcomes)
      await shot('agenda-4')
      await unhalo(outcomes)
    } else {
      console.log('  ! agenda-4 : pas de rangée d’issues aujourd’hui')
      skipped.push('agenda-4')
    }
    const fait = daySheet.locator('.task-done-btn').first()
    if (await fait.count()) {
      await fait.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      await halo(fait)
      await shot('agenda-6')
      await unhalo(fait)
    } else {
      console.log('  ! agenda-6 : pas de tâche aujourd’hui')
      skipped.push('agenda-6')
    }
    await closeSheet()
  } else {
    skipped.push('agenda-3', 'agenda-4', 'agenda-6')
  }
}

// agenda-5 : le RDV annulé d'hier → « Replanifier » (halo).
{
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  // La case d'hier : même mois = la cellule qui porte le numéro du jour.
  const cell =
    yesterday.getMonth() === today.getMonth()
      ? page
          .locator('.cal-cell:not(.is-out)')
          .filter({ has: page.locator('.cal-daynum', { hasText: new RegExp(`^${yesterday.getDate()}$`) }) })
          .first()
      : null
  if (cell && (await cell.count())) {
    await cell.click()
    await page.waitForTimeout(1400)
    const replan = page.locator('.drawer-content').getByRole('button', { name: /Replanifier/ })
    if (await replan.count()) {
      // Centré (pas scrollIntoViewIfNeeded, minimal) : la carte ANNULÉE doit
      // être dans la bande de recadrage, pas le RDV du dessus.
      await replan.first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.waitForTimeout(400)
      await halo(replan.first())
      await shot('agenda-5')
      await unhalo(replan.first())
    } else {
      console.log('  ! agenda-5 : pas de bouton Replanifier hier')
      skipped.push('agenda-5')
    }
    await closeSheet()
  } else {
    console.log('  ! agenda-5 : hier est sur le mois précédent — relancer demain')
    skipped.push('agenda-5')
  }
}

// ============================ VOS CONTACTS ==================================

await page.getByRole('button', { name: 'Contacts', exact: true }).click()
await page.waitForTimeout(1800)
if ((await page.locator('.home-row').count()) < 3)
  console.log('  ! contacts-1 : liste maigre — seed-demo.mjs passé ?')
await shot('contacts-1')

{
  const add = page.locator('.contacts-add')
  await halo(add)
  await add.click() // le halo reste visible pendant l'ouverture ? Non : re-shot après.
  await page.waitForTimeout(1200)
  await shot('contacts-2') // formulaire vide — JAMAIS « Créer le contact »
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForTimeout(600)
  await unhalo(add)
}

// ============================== L'ACCUEIL ===================================

await page.getByRole('button', { name: 'Accueil', exact: true }).click()
await page.waitForSelector('.today-card', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1800)
await shot('accueil-1')

if (await page.locator('.section-title', { hasText: 'À relancer' }).count()) {
  await page
    .locator('.section-title', { hasText: 'À relancer' })
    .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForTimeout(600)
  // L'ANCRE téléphone de la section (a.home-row-call) — pas le « Fait ✓ »
  // des tâches, qui partage la classe (bouton).
  const call = page.locator('a.home-row-call').first()
  if (await call.count()) await halo(call)
  await shot('accueil-2')
  if (await call.count()) await unhalo(call)
} else {
  console.log('  ! accueil-2 : pas de section À relancer — relance échue manquante')
  skipped.push('accueil-2')
}

// ============================== LES STATS ===================================

await page.getByRole('button', { name: 'Stats', exact: true }).click()
await page.waitForTimeout(1500)
// « Mois » : la semaine de démo peut être quasi vide (un lundi, la semaine
// n'a qu'un jour) — le mois montre un tunnel complet.
await page.getByRole('button', { name: 'Mois' }).click()
await page.waitForTimeout(3500)
// stats-1 : héros + tunnel.
if (await page.getByText('Tunnel de conversion').count()) {
  await page.getByText('Tunnel de conversion').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
}
await shot('stats-1')
// stats-2 : naviguer — halo sur le bandeau période (segmented + chevrons).
await page.evaluate(() => window.scrollTo(0, 0))
await page.locator('.screen').evaluate((el) => el.scrollTo({ top: 0 }))
await page.waitForTimeout(400)
{
  const seg = page.locator('.seg').first()
  await halo(seg)
  await shot('stats-2')
  await unhalo(seg)
}

// ==================== accueil-3 : le popup du matin =========================
// `?popup-rdv` force l'ouverture (neutralisé sous webdriver sinon). Le RDV
// Kerbrat d'hier est sans issue. « Plus tard » = localStorage seulement.
await page.goto(`${BASE}/?popup-rdv`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
if (await page.getByText('Que s’est-il passé', { exact: false }).count()) {
  await shot('accueil-3')
  const later = page.getByRole('button', { name: 'Plus tard' })
  if (await later.count()) await later.click()
} else {
  console.log('  ! accueil-3 : popup absent (RDV orphelin manquant ?)')
  skipped.push('accueil-3')
}

// ==================== carte-6 : le drag (fantôme, jamais relâché) ===========
// mouse.down + appui long → le drag démarre (fantôme sous le doigt) ; on
// capture PENDANT, puis on RECHARGE la page sans relâcher : aucune écriture.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(2500)
if (await search(ADDR.drag)) {
  let dragged = false
  for (const [dx, dy] of [
    [0, 0],
    [-20, 0],
    [20, 0],
    [0, -20],
    [0, 20],
  ]) {
    await page.mouse.move(CX + dx, CY + dy)
    await page.mouse.down()
    await page.waitForTimeout(800) // > 550 ms : le drag démarre si un point est là
    // Détection AVANT tout mouvement : le fantôme .drag-ghost n'existe qu'en
    // drag. Sans lui, on relâche SUR PLACE (< 10 px = zéro écriture, garde
    // de finishDrag) — jamais un déplacement silencieux.
    dragged = (await page.locator('.drag-ghost').count()) > 0
    if (dragged) {
      await page.mouse.move(CX + dx + 34, CY + dy - 38, { steps: 8 })
      await page.waitForTimeout(600)
      await shot('carte-6')
      break
    }
    await page.mouse.up()
    await page.waitForTimeout(900)
    await closeSheet()
  }
  if (dragged) {
    // JAMAIS de mouse.up en drag : recharger la page abandonne le geste.
    await page.goto(BASE, { waitUntil: 'networkidle' })
  } else {
    console.log('  ! carte-6 : drag jamais démarré (marqueur hors grille ?)')
    skipped.push('carte-6')
  }
} else {
  skipped.push('carte-6')
}

// Une capture sautée ne doit pas laisser un PNG périmé.
for (const name of skipped) {
  const stale = resolve(OUT, `${name}.png`)
  if (existsSync(stale)) {
    unlinkSync(stale)
    console.log(`  · ${name}.png périmé supprimé`)
  }
}
if (skipped.length) console.log('\nCAPTURES SAUTÉES :', skipped.join(', '))
await browser.close()
