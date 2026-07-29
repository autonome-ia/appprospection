// Contrôle visuel rapide : Accueil connecté (section Guide avec covers) +
// sheet du 1er tuto ouverte. Lecture seule.
// THEME=dark node check-accueil.mjs → mode sombre (suffixe -sombre).
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
mkdirSync(OUT, { recursive: true })

const DARK = process.env.THEME === 'dark'
const SUF = DARK ? '-sombre' : ''
const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
if (DARK) await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.guide-card', { timeout: 15000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: resolve(OUT, `accueil${SUF}.png`) })
console.log(`✔ accueil${SUF}.png`)
await page.locator('.guide-card').first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, `tuto-sheet${SUF}.png`) })
console.log(`✔ tuto-sheet${SUF}.png`)
await browser.close()
