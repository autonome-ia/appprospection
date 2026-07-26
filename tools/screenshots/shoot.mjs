// ---------------------------------------------------------------------------
// Captures d'écran du Guide (Playwright, viewport iPhone).
//
//   node shoot.mjs --probe   → capture l'écran de connexion (valide le pipeline)
//   node shoot.mjs           → connexion + captures automatiques
//
// Prérequis : `npm run dev` lancé dans web/ (http://localhost:5173), et pour
// le mode connecté deux lignes dans web/.env (NON versionné) :
//   GUIDE_EMAIL=compte@exemple.fr
//   GUIDE_PASSWORD=…
// Les PNG sortent dans screenshoots/guide/ (non versionné) ; ils sont ensuite
// convertis en WebP vers web/public/guide/ (voir convert.mjs).
// ---------------------------------------------------------------------------
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const PROBE = process.argv.includes('--probe')

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
const EMAIL = env.GUIDE_EMAIL
const PASSWORD = env.GUIDE_PASSWORD

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
})
const page = await ctx.newPage()

const shot = async (name) => {
  await page.waitForTimeout(600) // laisse finir les animations Motion
  await page.screenshot({ path: resolve(OUT, `${name}.png`) })
  console.log(`✔ ${name}.png`)
}

await page.goto(BASE, { waitUntil: 'networkidle' })

if (PROBE || !EMAIL || !PASSWORD) {
  await shot('probe-login')
  if (!PROBE) {
    console.log('GUIDE_EMAIL / GUIDE_PASSWORD absents de web/.env — arrêt après la sonde.')
  }
  await browser.close()
  process.exit(0)
}

// --- Connexion -------------------------------------------------------------
await page.getByPlaceholder('Email').fill(EMAIL)
await page.getByPlaceholder('Mot de passe').fill(PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
// La carte est l'onglet d'ouverture : on attend son canvas WebGL.
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(3500) // tuiles IGN + points
console.log('Connecté, carte chargée.')

// --- Captures simples (écrans sans gestes carte) ---------------------------
// Agenda : grille du mois (rdv-2).
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1200)
await shot('rdv-2')

// Sheet du jour : on tape la cellule d'AUJOURD'HUI (rdv-3 — issues visibles
// si un RDV « à venir » existe ce jour).
const todayCell = page.locator('.cal-cell.is-today')
if (await todayCell.count()) {
  await todayCell.click()
  await page.waitForTimeout(800)
  await shot('rdv-3')
  // Formulaire pré-daté depuis la sheet (rdv-1).
  const addBtn = page.getByRole('button', { name: 'RDV ce jour' })
  if (await addBtn.count()) {
    await addBtn.click()
    await page.waitForTimeout(800)
    await shot('rdv-1')
    await page.keyboard.press('Escape')
  }
}

// Carte : vue d'ensemble avec les points (sert de base à pose-1/vendu).
await page.getByRole('button', { name: 'Carte', exact: true }).click()
await page.waitForTimeout(2000)
await shot('carte-brute')

// Accueil (contrôle visuel du guide lui-même).
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForTimeout(1000)
await shot('accueil')

console.log(
  'Captures carte à la main (gestes/état réel requis) : pose-1 (visée), pose-2 (fiche), pose-3 (drag), maison-1/2/3.',
)
await browser.close()
