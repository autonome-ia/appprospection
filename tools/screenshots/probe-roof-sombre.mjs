// Sonde mode sombre du module « Toiture mesurée » (lecture seule) :
// fiche maison mesurée en sombre — 3D + pastilles, Plan coté, Rapport
// (qui doit rester PAPIER). Aucune écriture.
import { chromium, devices } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const browser = await chromium.launch()
const page = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(2000)
const input = page.getByPlaceholder(/Rechercher/)
await input.fill('18 Rue du Retalaire Lesneven')
await page.waitForTimeout(2500)
await page.locator('.address-results button').first().click()
await page.waitForTimeout(4500)
await input.fill('')
await page.evaluate(() => document.activeElement?.blur?.())
const VP = page.viewportSize()
await page.mouse.click(Math.round(VP.width / 2), Math.round(VP.height / 2))
await page.waitForTimeout(2500)
const sheet = page.locator('.drawer-content')
if (!(await sheet.count())) { console.log('! pas de sheet'); process.exit(1) }
await page.waitForTimeout(9000)
const roofToggle = sheet.getByRole('button', { name: /Toiture mesurée/ })
if (!(await roofToggle.count())) { console.log('! module toiture absent'); process.exit(1) }
await roofToggle.first().click()
await page.waitForTimeout(6000)
await sheet.locator('.drawer-body').evaluate((el) => el.scrollBy({ top: 120, behavior: 'instant' }))
await page.waitForTimeout(500)
await page.screenshot({ path: resolve(OUT, 'roof-sombre-3d.png') })
console.log('✔ roof-sombre-3d.png')
const plan = sheet.getByRole('button', { name: 'Plan', exact: true })
if (await plan.count()) {
  await plan.first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve(OUT, 'roof-sombre-plan.png') })
  console.log('✔ roof-sombre-plan.png')
}
const report = sheet.getByRole('button', { name: 'Rapport', exact: true })
if (await report.count()) {
  await report.first().click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: resolve(OUT, 'roof-sombre-rapport.png') })
  console.log('✔ roof-sombre-rapport.png')
  await page.getByRole('button', { name: 'Fermer le rapport' }).click({ force: true })
}
await browser.close()
console.log('✔ probe-roof-sombre')
