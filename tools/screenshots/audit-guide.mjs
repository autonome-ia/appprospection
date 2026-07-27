// Audit du Guide (chantier 27/07) : ouvre chaque tuto de l'Accueil et capture
// chaque étape TELLE QUE RENDUE (capture + texte ensemble) pour confronter
// l'image à sa phrase. Lecture seule — aucun clic hors navigation du guide.
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide-audit')
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
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForSelector('.guide-card', { timeout: 15000 })
await page.waitForTimeout(2000)
await page.screenshot({ path: resolve(OUT, 'accueil.png') })
console.log('✔ accueil.png')

const cards = page.locator('.guide-card')
const n = await cards.count()
for (let g = 0; g < n; g++) {
  await cards.nth(g).click()
  await page.waitForTimeout(1200)
  const sheet = page.locator('.drawer-content')
  const dots = sheet.locator('.guide-dot')
  const steps = await dots.count()
  for (let s = 0; s < steps; s++) {
    await page.waitForTimeout(1000) // chargement lazy de l'image
    await page.screenshot({ path: resolve(OUT, `tuto${g + 1}-etape${s + 1}.png`) })
    console.log(`✔ tuto${g + 1}-etape${s + 1}.png`)
    if (s < steps - 1) await sheet.getByRole('button', { name: 'Suivant' }).click()
  }
  await sheet.getByRole('button', { name: 'Terminer' }).click()
  await page.waitForTimeout(900)
}
await browser.close()
console.log('Audit : captures dans screenshoots/guide-audit/')
