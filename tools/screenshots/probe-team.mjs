// Sonde sheet « Équipe » (lecture seule — AUCUN tap sur Nouveau code / rôles).
// Le compte sondes est manager de sa propre agence de test : le code
// d'invitation doit s'afficher (RLS organization_invites) et sa propre ligne
// être inerte (pas d'auto-édition).
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
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
if (THEME === 'dark') await ctx.addInitScript(() => localStorage.setItem('theme', 'dark'))
const page = await ctx.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Accueil' }).click()
await page.waitForTimeout(1500)
await page.locator('.accueil-settings').click()
await page.waitForTimeout(600)
await page.screenshot({ path: resolve(OUT, `probe-team-reglages-${THEME}.png`) })
await page.getByRole('button', { name: 'Équipe' }).click()
await page.waitForSelector('.team-code', { timeout: 10000 })
const code = await page.locator('.team-code').textContent()
console.log('code affiché :', code, code?.trim().length === 8 ? '(8 caractères ✓)' : '⚠ longueur inattendue')
const rows = await page.locator('.team-row').count()
console.log('membres listés :', rows)
const selfRow = page.locator('.team-row', { hasText: '(toi)' })
console.log('sa propre ligne inerte :', await selfRow.isDisabled())
console.log('membres :', (await page.locator('.team-name').allTextContents()).join(' | '))
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(OUT, `probe-team-${THEME}.png`) })
await browser.close()
console.log(`✔ probe-team (${THEME})`)
