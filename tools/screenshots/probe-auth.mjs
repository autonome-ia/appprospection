// Sonde écran de connexion/inscription (lecture seule — AUCUN compte créé) :
// captures des deux modes et des deux thèmes, vérification du code invalide
// (RPC validate_invite en direct), puis connexion réelle du compte sondes
// (les autres sondes dépendent des placeholders Email / Mot de passe et du
// bouton « Se connecter » — cette sonde garantit qu'ils n'ont pas bougé).
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

// Mode connexion
await page.waitForSelector('.auth-card')
await page.screenshot({ path: resolve(OUT, `probe-auth-login-${THEME}.png`) })

// Mode inscription : code bidon → le statut « Code inconnu » doit apparaître
// (préuve que la RPC validate_invite répond — migration 0019 en place).
await page.getByRole('button', { name: /code d’invitation/i }).click()
await page.locator('.auth-code').fill('XXXXXXXX')
await page.waitForSelector('.auth-code-status.is-bad', { timeout: 10000 })
const badMsg = await page.locator('.auth-code-status').textContent()
console.log('code bidon →', badMsg?.trim())
const submitDisabled = await page.getByRole('button', { name: 'Créer mon compte' }).isDisabled()
console.log('« Créer mon compte » désactivé sans code valide :', submitDisabled)
await page.screenshot({ path: resolve(OUT, `probe-auth-signup-${THEME}.png`) })

// Retour connexion + login réel du compte sondes (mêmes sélecteurs que les
// autres sondes — s'ils cassent, tout le banc de captures casse).
await page.getByRole('button', { name: 'Déjà un compte ? Se connecter' }).click()
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
console.log('connexion sondes OK (carte chargée)')
await browser.close()
console.log(`✔ probe-auth (${THEME})`)
