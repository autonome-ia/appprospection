// =============================================================================
// Captures de l'espace Numbers (tour UI/UX du 26/09). Lecture seule.
// Décor : node numbers-seed.mjs (agence jetable « RLS Test — jetable »).
//   node numbers-shots.mjs                → manager + commercial, clair
//   THEME=dark node numbers-shots.mjs     → idem en sombre (suffixe -sombre)
// Sortie : screenshoots/numbers/<role>-<écran>[-sombre].png
// Viewport iPhone 13 mais TRÈS haut : chaque écran tient en une image.
// =============================================================================
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'numbers')
mkdirSync(OUT, { recursive: true })
const DARK = process.env.THEME === 'dark'
const SUF = DARK ? '-sombre' : ''
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const ROLES = {
  manager: 'rlstest-manager@example.com',
  commercial: 'rlstest-commercial1@example.com',
}

const browser = await chromium.launch()

async function shoot(role, email) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 2200 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  })
  const page = await ctx.newPage()
  await page.addInitScript((dark) => {
    localStorage.setItem('app-space', 'numbers')
    localStorage.setItem('guide-auto', '1')
    if (dark) localStorage.setItem('theme', 'dark')
  }, DARK)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Mot de passe').fill('rls-test-2026!')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForSelector('.numbers-home', { timeout: 25000 })
  await page.waitForTimeout(2500)
  const snap = async (name) => {
    await page.waitForTimeout(900)
    await page.screenshot({ path: resolve(OUT, `${role}-${name}${SUF}.png`) })
    console.log(`✔ ${role}-${name}${SUF}.png`)
  }
  const tab = (label) => page.locator('.bottom-nav').getByRole('button', { name: label }).click()

  await snap('1-accueil')

  await tab('Ventes')
  await page.waitForSelector('.sale-card', { timeout: 15000 }).catch(() => {})
  await snap('2-cahier')
  if (role === 'manager') {
    await page.locator('.seg').first().getByRole('button', { name: 'Agence' }).click()
    await snap('2b-cahier-agence')
  }

  // 3e onglet : « Équipe » (manager) ou « Commissions » (commercial).
  if (role === 'manager') {
    await tab('Équipe')
    await snap('3-equipe')
  } else {
    await tab('Commissions')
    await snap('3-commissions')
    await page.locator('.seg').first().getByRole('button', { name: 'Tableau général' }).click()
    await snap('3b-commissions-agence')
  }

  await tab('Stats')
  await snap('4-stats-mois')
  await page.locator('.seg').first().getByRole('button', { name: 'Trimestre' }).click()
  await snap('4b-stats-trimestre')
  if (role === 'manager') {
    const bar = page.locator('.seller-row.is-clickable').first()
    if (await bar.count()) {
      await bar.click()
      await snap('4c-stats-drill')
    }
  }

  // Formulaire : une vente du cahier, puis « + Vente ».
  await tab('Ventes')
  await page.locator('.sale-card.is-clickable').first().click()
  await page.waitForSelector('.sale-amount', { timeout: 15000 }).catch(() => {})
  await snap('5-vente-ouverte')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.locator('.head-action').click()
  await page.waitForSelector('.sale-amount', { timeout: 15000 }).catch(() => {})
  await snap('5b-nouvelle-vente')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  if (role === 'manager') {
    await tab('Accueil')
    await page.getByRole('button', { name: 'Réglages' }).click()
    await page.getByText('Équipe', { exact: false }).first().click().catch(() => {})
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
      const body = [...document.querySelectorAll('.drawer-body')].pop()
      if (body) body.scrollTop = body.scrollHeight
    })
    await snap('6-equipe-numbers')
  }
  await ctx.close()
}

for (const [role, email] of Object.entries(ROLES)) await shoot(role, email)
await browser.close()
