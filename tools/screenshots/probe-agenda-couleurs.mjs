// Sonde refonte couleurs agenda (10/08, lecture seule) : légende-filtre
// « ● Prénom », pastilles de type dans les pilules du mois, relances à la
// couleur du commercial. Aucune écriture (les chips de filtre sont locales).
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
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(2500)
// Repli 10/08 : la légende est derrière le bouton filtre — capture fermée…
await page.screenshot({ path: resolve(OUT, `probe-agenda-couleurs-${THEME}.png`) })
// …puis dépliée (tap local, aucune écriture).
await page.locator('.agenda-who-btn').click()
await page.waitForTimeout(400)
const chips = await page.locator('.agenda-mine .chip').allTextContents()
console.log('chips :', chips.join(' | '))
const dots = await page.locator('.cal-dot').count()
console.log('pastilles de type dans la grille :', dots)
await page.screenshot({ path: resolve(OUT, `probe-agenda-legende-${THEME}.png`) })
// Filtre : tap sur la 2e chip membre (pas le bouton, pas « + Tâche ») — local.
const memberChips = page.locator('.agenda-mine .chip:not(.agenda-add-task):not(.agenda-who-btn)')
if ((await memberChips.count()) > 1) {
  await memberChips.nth(1).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: resolve(OUT, `probe-agenda-filtre-${THEME}.png`) })
  await memberChips.nth(1).click()
}
await browser.close()
console.log(`✔ probe-agenda-couleurs (${THEME})`)
