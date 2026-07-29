// Sonde thème (lecture seule) : sheet de profil, bascule Sombre à chaud,
// persistance localStorage, retour Clair.
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
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForTimeout(2000)
await page.locator('.avatar-btn').click()
await page.waitForTimeout(1000)
await page.screenshot({ path: resolve(OUT, 'probe-theme-clair.png') })
await page.getByRole('button', { name: 'Sombre' }).click()
await page.waitForTimeout(800)
console.log('data-theme:', await page.evaluate(() => document.documentElement.dataset.theme))
console.log('localStorage:', await page.evaluate(() => localStorage.getItem('theme')))
console.log('meta theme-color:', await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content))
await page.screenshot({ path: resolve(OUT, 'probe-theme-sombre.png') })
await page.getByRole('button', { name: 'Clair', exact: true }).click()
await page.waitForTimeout(500)
console.log('retour clair — data-theme:', await page.evaluate(() => document.documentElement.dataset.theme ?? '(absent)'))
console.log('meta theme-color:', await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content))
await browser.close()
console.log('✔ probe-theme')
