// Contrôle visuel rapide : onglet Stats connecté. Lecture seule.
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
const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Stats' }).click()
await page.waitForSelector('.stats-hero', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1800)
await page.screenshot({ path: resolve(OUT, 'check-stats.png') })
console.log('✔ check-stats.png')
// Bas de l'écran (graphe + « Points posés » + classement) : l'écran défile.
await page.evaluate(() => {
  const el = document.querySelector('.screen')
  if (el) el.scrollTop = el.scrollHeight
  else window.scrollTo(0, document.body.scrollHeight)
})
await page.waitForTimeout(800)
await page.screenshot({ path: resolve(OUT, 'check-stats-bas.png') })
console.log('✔ check-stats-bas.png')
await browser.close()
