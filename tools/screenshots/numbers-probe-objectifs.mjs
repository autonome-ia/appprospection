// Sonde : « Fixer les objectifs de CA » (Accueil Numbers, manager, agence
// sans objectif) ouvre l'écran Équipe directement sur sa section Ventes.
// Agence jetable « RLS Test — jetable » : objectifs mis à 0 le temps de la
// sonde, puis décor rétabli (node numbers-seed.mjs).
import { chromium, devices } from 'playwright'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const api = async (path, opts = {}) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  return r.json().catch(() => null)
}
const tok = await api('/auth/v1/token?grant_type=password', {
  method: 'POST',
  body: JSON.stringify({ email: 'rlstest-manager@example.com', password: 'rls-test-2026!' }),
})
const auth = { Authorization: `Bearer ${tok.access_token}`, Prefer: 'return=minimal' }
const me = await api(`/rest/v1/profiles?id=eq.${tok.user.id}&select=organization_id`, { headers: auth })
await api(`/rest/v1/profiles?organization_id=eq.${me[0].organization_id}`, {
  method: 'PATCH',
  headers: auth,
  body: JSON.stringify({ monthly_ca_target: 0 }),
})

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('app-space', 'numbers')
  localStorage.setItem('guide-auto', '1')
})
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill('rlstest-manager@example.com')
await page.getByPlaceholder('Mot de passe').fill('rls-test-2026!')
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('.numbers-home', { timeout: 25000 })
await page.getByRole('button', { name: 'Fixer les objectifs de CA' }).click()
await page.waitForTimeout(2000)
const out = resolve(root, 'screenshoots', 'numbers', 'probe-fixer-objectifs.png')
await page.screenshot({ path: out })
const visible = await page.locator('.team-sales-anchor').evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.top < window.innerHeight * 0.6
})
console.log(visible ? '✔ section Ventes visible en haut de l’écran Équipe' : '✘ section Ventes hors de vue')
await browser.close()
execSync('node numbers-seed.mjs', { cwd: here, stdio: 'inherit' })
