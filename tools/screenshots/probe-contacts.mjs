// Sonde jetable : vue « Contacts » (refonte 27/07) — liste, filtre, fiche.
// Lecture seule (navigation + ouverture de fiches uniquement).
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

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Contacts' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: resolve(OUT, 'contacts-liste.png') })
const rows = await page.locator('.home-row .home-row-title').allTextContents()
console.log('Contacts :', rows.length, '→', rows.join(' | '))

// Filtre « À revoir »
await page.getByRole('button', { name: 'À revoir', exact: true }).click()
await page.waitForTimeout(600)
console.log('Filtre À revoir :', (await page.locator('.home-row .home-row-title').allTextContents()).join(' | '))
await page.screenshot({ path: resolve(OUT, 'contacts-filtre.png') })
await page.getByRole('button', { name: 'À revoir', exact: true }).click()
await page.waitForTimeout(600)

// Fiche du premier contact
await page.locator('.home-row').first().click()
await page.waitForTimeout(2500)
const sheet = page.locator('.drawer-content')
const tel = await sheet.locator('a[href^="tel:"]').count()
const waze = await sheet.locator('a[href*="waze.com"]').count()
const toiture = await sheet.getByText('Toiture mesurée').count()
console.log(`Fiche : tel=${tel} waze=${waze} toiture=${toiture}`)
await page.waitForTimeout(4000) // backfill lidar éventuel
await page.screenshot({ path: resolve(OUT, 'contacts-fiche.png') })
await browser.close()
