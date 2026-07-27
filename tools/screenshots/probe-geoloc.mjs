// Sonde jetable : le point de position suit-il un déplacement GPS simulé,
// sans que la caméra bouge ? (chantier géoloc vivante 27/07 — lecture seule)
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'guide')
mkdirSync(OUT, { recursive: true })
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

// Position A : rue du Rétalaire, Le Folgoët — B : ~120 m plus loin.
const A = { latitude: 48.567, longitude: -4.335, accuracy: 8 }
const B = { latitude: 48.5678, longitude: -4.3338, accuracy: 8 }

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  geolocation: A,
  permissions: ['geolocation'],
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(5000) // 1er fix + easeTo d'accueil + tuiles
const center1 = await page.evaluate(() => {
  const c = document.querySelector('.maplibregl-canvas')
  return c ? 'canvas ok' : 'pas de canvas'
})
console.log(center1)
await page.screenshot({ path: resolve(OUT, 'geoloc-a.png') })
console.log('✔ geoloc-a.png (position A)')

await ctx.setGeolocation(B)
await page.waitForTimeout(2500)
await page.screenshot({ path: resolve(OUT, 'geoloc-b.png') })
console.log('✔ geoloc-b.png (déplacé en B — le point doit avoir bougé, pas la carte)')

// Bouton ⌖ : recentre sur le point.
await page.getByRole('button', { name: 'Ma position' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, 'geoloc-c.png') })
console.log('✔ geoloc-c.png (après ⌖ : recentré-zoomé sur B)')
await browser.close()
