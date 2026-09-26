// Sonde : les Stats de la PROSPECTION comptent les ventes Numbers avec leurs
// parts (vente à deux = 0,5 chacun), origine Prospection seulement (db/0033).
// Agence jetable « RLS Test — jetable », compte manager de test. Lecture seule.
//   BASE_URL=https://appprospection-design.onrender.com node probe-ventes-parts.mjs
import { chromium, devices } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const H = { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
const tok = await (
  await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: 'rlstest-manager@example.com', password: 'rls-test-2026!' }),
  })
).json()
const A = { ...H, Authorization: `Bearer ${tok.access_token}` }
const get = async (q) => (await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${q}`, { headers: A })).json()

// Attendu : ventes du mois en cours, actives, origine Prospection ou vide.
const d = new Date()
const pad = (n) => String(n).padStart(2, '0')
const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1)
const end = `${nx.getFullYear()}-${pad(nx.getMonth() + 1)}-01`
const rows = await get(`sales_board?select=seller1_id,seller2_id,status,origin&sold_on=gte.${start}&sold_on=lt.${end}`)
const profiles = await get('profiles?select=id,full_name')
const name = (id) => profiles.find((p) => p.id === id)?.full_name
const expected = {}
for (const s of rows) {
  if (s.status !== 'active' || (s.origin && s.origin !== 'prospection')) continue
  const sellers = [s.seller1_id, s.seller2_id].filter(Boolean)
  for (const id of sellers) expected[name(id)] = (expected[name(id)] ?? 0) + (sellers.length > 1 ? 0.5 : 1)
}
console.log('attendu :', expected)

const browser = await chromium.launch()
const page = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
await page.addInitScript(() => {
  localStorage.setItem('app-space', 'prospection')
  localStorage.setItem('guide-auto', '1')
})
await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill('rlstest-manager@example.com')
await page.getByPlaceholder('Mot de passe').fill('rls-test-2026!')
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('.bottom-nav', { timeout: 25000 })
await page.locator('.bottom-nav').getByRole('button', { name: 'Stats' }).click()
await page.locator('.seg').first().getByRole('button', { name: 'Mois' }).click()
await page.waitForTimeout(5000)
const shown = await page.$$eval('.rank', (els) =>
  els.map((el) => ({
    name: el.querySelector('.rank-name')?.textContent?.trim(),
    sales: el.querySelector('.rank-sales')?.textContent?.trim(),
  })),
)
console.log('affiché :', shown)
await page.screenshot({ path: resolve(root, 'screenshoots', 'numbers', 'probe-stats-prospection.png'), fullPage: true })
let ok = true
for (const [n, v] of Object.entries(expected)) {
  const row = shown.find((r) => r.name?.includes(n))
  const got = row ? Number(row.sales.split(' ')[0].replace(',', '.')) : null
  const pass = got === v
  if (!pass) ok = false
  console.log(`${pass ? 'PASS' : 'ÉCHEC'}  ${n} : attendu ${v}, affiché ${got}`)
}
await browser.close()
process.exit(ok ? 0 : 1)
