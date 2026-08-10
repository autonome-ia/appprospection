// Contrôle ponctuel : teinte « pluie » du chip météo via un cache localStorage
// factice (aucun appel met.no). Lecture seule.
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
mkdirSync(OUT, { recursive: true })

const DARK = process.env.THEME === 'dark'
const SUF = DARK ? '-sombre' : ''
const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
await page.addInitScript((dark) => {
  if (dark) localStorage.setItem('theme', 'dark')
  localStorage.setItem(
    'meteo-cache-v2',
    JSON.stringify({ temp: 13.6, symbol: 'rainshowers_day', at: Date.now() }),
  )
}, DARK)
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.weather-chip', { timeout: 15000 })
await page.waitForTimeout(1500)
await page.locator('.today-card').screenshot({ path: resolve(OUT, `meteo-pluie${SUF}.png`) })
console.log(`✔ meteo-pluie${SUF}.png`)
await browser.close()
