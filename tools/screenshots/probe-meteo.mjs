// Sonde LECTURE SEULE : chip météo de la carte « Aujourd'hui » (Open-Meteo,
// géoloc simulée à Lesneven). THEME=dark node probe-meteo.mjs → -sombre.
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
if (!/^sondes-\d@example\.com$/.test(env.GUIDE_EMAIL ?? '')) {
  console.error(`GUIDE_EMAIL doit être un compte sondes (reçu : ${env.GUIDE_EMAIL})`)
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const DARK = process.env.THEME === 'dark'
const SUF = DARK ? '-sombre' : ''
const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  geolocation: { latitude: 48.5712, longitude: -4.3153 }, // Lesneven
  permissions: ['geolocation'],
})
const page = await ctx.newPage()
if (DARK) await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.weather-chip', { timeout: 15000 })
await page.waitForTimeout(1500)

await page.screenshot({ path: resolve(OUT, `meteo-accueil${SUF}.png`) })
console.log(`✔ meteo-accueil${SUF}.png`)
await browser.close()
