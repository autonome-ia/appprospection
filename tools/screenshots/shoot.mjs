// ---------------------------------------------------------------------------
// Captures d'écran du Guide (Playwright, viewport iPhone).
//
//   node shoot.mjs --probe   → capture l'écran de connexion (valide le pipeline)
//   node shoot.mjs           → connexion + captures automatiques
//
// Prérequis : `npm run dev` lancé dans web/ (http://localhost:5173), et pour
// le mode connecté deux lignes dans web/.env (NON versionné) :
//   GUIDE_EMAIL=… / GUIDE_PASSWORD=…
// Les PNG sortent dans screenshoots/guide/ (non versionné), puis sont
// convertis en WebP vers web/public/guide/.
//
// GARDE-FOU : uniquement des actions en LECTURE (ouvrir des fiches, viser
// sans poser). Ne jamais cliquer Poser / issues / Enregistrer / Supprimer.
// ---------------------------------------------------------------------------
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const PROBE = process.argv.includes('--probe')
// Adresse de centrage (zone réellement prospectée — RDV existant).
const SEARCH = process.env.GUIDE_ADDR ?? '18 Rue du Retalaire Lesneven'

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
  await page.waitForTimeout(600)
  await page.screenshot({ path: resolve(OUT, `${name}.png`) })
  console.log(`✔ ${name}.png`)
}
/** Ferme la sheet ouverte si elle existe (bouton Fermer du gabarit). */
const closeSheet = async () => {
  const close = page.locator('.drawer-content').getByRole('button', { name: 'Fermer' })
  if (await close.count()) {
    await close.first().click()
    await page.waitForTimeout(700)
  }
}

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

// --- Carte : centrage sur la zone prospectée -------------------------------
const search = page.getByPlaceholder(/Rechercher/)
await search.fill(SEARCH)
await page.waitForTimeout(1200)
const firstResult = page.locator('.address-results button').first()
if (await firstResult.count()) {
  await firstResult.click()
  console.log('Adresse centrée :', SEARCH)
} else {
  console.log('! aucune suggestion pour', SEARCH)
}
await page.waitForTimeout(4500) // flyTo + tuiles ortho au zoom maison

// maison-1 : tap au centre = fiche AVANT prospection (badges + pans dessinés
// sur l'ortho — la maison du RDV n'a pas de point posé).
await page.mouse.click(CX, CY)
await page.waitForTimeout(2500)
const sheet = page.locator('.drawer-content')
if (await sheet.count()) {
  await page.waitForTimeout(9000) // badges + mesure laser + pans sur l'ortho
  await shot('maison-1')

  // maison-2 : module « Toiture mesurée » → 3D (chunk three à la demande).
  const roofToggle = sheet.getByRole('button', { name: /Toiture mesurée/ })
  if (await roofToggle.count()) {
    await roofToggle.first().click()
    await page.waitForTimeout(6000) // chargement three + entrée de la maquette
    await shot('maison-2')

    // maison-3 : segment « Rapport » (overlay plein écran).
    const report = sheet.getByRole('button', { name: 'Rapport', exact: true })
    if (await report.count()) {
      await report.first().click()
      await page.waitForTimeout(2500)
      await shot('maison-3')
      const back = page.getByRole('button', { name: /Fermer|Retour/ }).last()
      if (await back.count()) await back.click()
      await page.waitForTimeout(800)
    }
  } else {
    console.log('! module « Toiture mesurée » absent de cette fiche')
  }
  await closeSheet()
} else {
  console.log('! aucune fiche ne s’est ouverte au tap centre')
}

// pose-1 : mode visée (réticule + statuts). AUCUN clic sur « Poser ».
await page.getByRole('button', { name: 'Poser un point' }).click()
await page.waitForTimeout(1500)
await shot('pose-1')

// --- Agenda ----------------------------------------------------------------
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1500)
await shot('rdv-2')

const todayCell = page.locator('.cal-cell.is-today')
if (await todayCell.count()) {
  await todayCell.click()
  await page.waitForTimeout(900)
  await shot('rdv-3')
  // rdv-1 : formulaire pré-daté, rempli avec des valeurs d'EXEMPLE puis
  // fermé par « Annuler » — jamais Enregistrer (données réelles).
  const addBtn = page.getByRole('button', { name: 'RDV ce jour' })
  if (await addBtn.count()) {
    await addBtn.click()
    await page.waitForTimeout(900)
    await page.getByPlaceholder('Nom').fill('M. Le Gall')
    await page.getByPlaceholder('06').fill('06 12 34 56 78')
    await page.getByPlaceholder('Adresse', { exact: true }).fill('4 rue des Écoles, Lesneven')
    await page.getByPlaceholder(/sonner 2 fois/).fill('Sonner 2 fois, devis à préparer')
    await shot('rdv-1')
    await page.getByRole('button', { name: 'Annuler', exact: true }).click()
    await page.waitForTimeout(700)
  }
}

// pose-2 : fiche d'un POINT posé — via la vue Clients → fiche client →
// bouton « Carte » (bascule + fiche du point ouverte sur la carte).
await page.getByRole('button', { name: 'Clients' }).click()
await page.waitForTimeout(1000)
const clientRow = page.locator('.home-row').first()
if (await clientRow.count()) {
  await clientRow.click()
  await page.waitForTimeout(2000)
  const mapBtn = page.locator('.drawer-content').getByRole('button', { name: 'Carte', exact: true })
  if (await mapBtn.count()) {
    await mapBtn.click()
    await page.waitForTimeout(7000) // bascule carte + recadrage + fiche point
    await shot('pose-2')
    await closeSheet()
  } else {
    await closeSheet()
    console.log('! bouton Carte absent de la fiche client (point non lié ?)')
  }
} else {
  console.log('! aucun client dans la vue Clients')
}

// --- Accueil (contrôle visuel du guide) -------------------------------------
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.today-card', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1200)
await shot('accueil')

console.log('Reste à faire à la main : pose-3 (drag — mutation, jamais en auto).')
await browser.close()
