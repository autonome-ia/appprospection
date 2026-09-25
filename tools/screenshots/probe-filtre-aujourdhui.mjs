// Sonde lecture seule (25/09) : le filtre « Aujourd’hui » de la carte remplace
// « À relancer » et ne garde que les points posés ce jour.
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(root, 'screenshoots', 'filtre-aujourdhui')
mkdirSync(OUT, { recursive: true })
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
if (!/^sondes-/.test(env.GUIDE_EMAIL ?? '')) throw new Error('GUIDE_EMAIL doit être un compte sondes')

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
const page = await ctx.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Carte' }).first().click()
await page.waitForTimeout(4000)

// Nombre de points dans la source de la carte (via les features rendues).
const count = () =>
  page.evaluate(() => document.querySelectorAll('.maplibregl-canvas').length)
await page.getByRole('button', { name: 'Filtrer (statut, ancienneté)' }).click()
await page.waitForTimeout(600)
const relancer = await page.getByRole('button', { name: /À relancer/ }).count()
const chip = page.getByRole('button', { name: /Aujourd’hui/ })
console.log(`chip « À relancer » présente : ${relancer} · chip « Aujourd’hui » : ${await chip.count()}`)
await page.screenshot({ path: resolve(OUT, 'filtres-ouverts.png') })
await chip.click()
await page.waitForTimeout(1200)
const active = await chip.getAttribute('class')
console.log(`chip active : ${active?.includes('is-active')} · canvas : ${await count()}`)
await page.screenshot({ path: resolve(OUT, 'filtre-actif.png') })
await browser.close()
