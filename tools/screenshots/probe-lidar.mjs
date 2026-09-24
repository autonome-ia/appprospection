// Sonde LiDAR de bout en bout (lecture seule, agence de démo) : tap sur une
// maison -> fiche maison -> attend le verdict de la mesure du toit.
// Journalise la console, chaque requête réseau de la chaîne (IGN, RNB, COPC)
// et échoue (exit 1) si la fiche ne montre pas « Toiture mesurée » + m².
// Usage : node probe-lidar.mjs ["adresse"] [baseUrl]
// PANNE=1 : simule le serveur COPC IGN injoignable -> attend « mesure laser
// indisponible » + « Réessayer », rétablit le réseau, tape « Réessayer » et
// exige la mesure (le chemin de repli, vérifié de bout en bout).
// WARM=20 : attend 20 s carte arrêtée avant le tap (préchauffage du quartier).
// SECOND="adresse" ou "px:dx,dy" : puis mesure une 2e maison (la tournée) ; AGAIN=1 : puis
// re-tape la 1re maison (cache par bâtiment, db/0026).
// Chaque mesure est chronométrée (tap -> verdict).
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
// Garde-fou anti-prod (cf. shoot.mjs) : uniquement les comptes sondes.
if (!/^sondes-/.test(env.GUIDE_EMAIL ?? '')) {
  console.error('! GUIDE_EMAIL doit être un compte sondes-* (agence de démo)')
  process.exit(2)
}
const ADDRESS = process.argv[2] ?? '18 Rue du Retalaire Lesneven'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const PANNE = process.env.PANNE === '1'
const WARM_S = Number(process.env.WARM ?? 0)
const SECOND = process.env.SECOND ?? null
const AGAIN = process.env.AGAIN === '1'
const COPC = /data\.geopf\.fr\/telechargement\//

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
const t0 = Date.now()
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const CHAIN = /geopf\.fr|rnb-api|\.wasm|lidar|copc|laz-perf|three|roof_measures|cache_building/i
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning' || /lidar|mesure|prewarm/i.test(m.text()))
    console.log(`[${ts()}] console.${m.type()}: ${m.text().slice(0, 400)}`)
})
page.on('pageerror', (e) => console.log(`[${ts()}] pageerror: ${e.message}`))
page.on('requestfailed', (r) => {
  if (CHAIN.test(r.url())) console.log(`[${ts()}] FAILED ${r.url().slice(0, 160)} : ${r.failure()?.errorText}`)
})
page.on('response', (r) => {
  const u = r.url()
  if (!CHAIN.test(u) || /wmts|tms|\/tiles?\//i.test(u)) return
  const range = r.request().headers()['range']
  console.log(`[${ts()}] ${r.status()} ${u.slice(0, 150)}${range ? ` (${range})` : ''}`)
})

if (PANNE) await page.route(COPC, (route) => route.abort('connectionrefused'))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(2000)
const input = page.getByPlaceholder(/Rechercher/)
const VP = page.viewportSize()
const sheet = page.locator('.drawer-content')
async function goTo(address, waitMs) {
  await input.fill(address)
  await page.waitForTimeout(2500)
  await page.locator('.address-results button').first().click()
  await page.waitForTimeout(waitMs)
  await input.fill('')
  await page.evaluate(() => document.activeElement?.blur?.())
}
let tapAt = 0
async function tapHouse(label, dx = 0, dy = 0) {
  console.log(`[${ts()}] tap maison (${label})`)
  tapAt = Date.now()
  await page.mouse.click(Math.round(VP.width / 2) + dx, Math.round(VP.height / 2) + dy)
  for (let i = 0; i < 12 && !(await sheet.count()); i++) await page.waitForTimeout(250)
  if (!(await sheet.count())) {
    console.log('! pas de fiche maison après le tap')
    await page.screenshot({ path: resolve(OUT, 'probe-lidar-fail.png') })
    await browser.close()
    process.exit(1)
  }
}
const chrono = () => `${((Date.now() - tapAt) / 1000).toFixed(1)} s`
await goTo(ADDRESS, 4500 + WARM_S * 1000)
await tapHouse(ADDRESS)
// Verdict : module « Toiture mesurée » OU disparition du « mesure… » (100 s
// > garde-fou de 90 s de la mesure).
async function waitVerdict() {
  for (let i = 0; i < 400; i++) {
    // Un seul instantané du texte par tour : pas de course entre deux lectures.
    const txt = (await sheet.innerText().catch(() => '')) || ''
    if (/Toiture mesurée/.test(txt)) return 'ok'
    // « Mesure laser du toit » (carte de progression, 24/09) ou l'ancienne
    // pastille « mesure du toit… ».
    if (i > 12 && !/mesure (laser )?du toit/i.test(txt)) {
      return /mesure laser indisponible/i.test(txt) ? 'indisponible' : 'sans-module'
    }
    await page.waitForTimeout(250)
  }
  return 'timeout'
}
let verdict = await waitVerdict()
console.log(`[${ts()}] MESURE 1 : ${verdict} en ${chrono()}`)
async function closeSheet() {
  await sheet.getByRole('button', { name: 'Fermer' }).first().click()
  await page.waitForTimeout(800)
}
if (SECOND && verdict === 'ok') {
  await closeSheet()
  // « px:dx,dy » : maison voisine à un décalage écran du 1er centre (zoom 18
  // après recherche ≈ 0,2 m/px) — les points BAN tombent souvent hors toit.
  const px = SECOND.match(/^px:(-?\d+),(-?\d+)$/)
  await goTo(px ? ADDRESS : SECOND, 3000)
  await tapHouse(SECOND, px ? Number(px[1]) : 0, px ? Number(px[2]) : 0)
  verdict = await waitVerdict()
  console.log(`[${ts()}] MESURE 2 (voisine) : ${verdict} en ${chrono()}`)
}
if (AGAIN && verdict === 'ok') {
  await closeSheet()
  await goTo(ADDRESS, 3000)
  await tapHouse(`${ADDRESS}, à nouveau`)
  verdict = await waitVerdict()
  console.log(`[${ts()}] MESURE 3 (même maison) : ${verdict} en ${chrono()}`)
}
if (PANNE) {
  const retry = sheet.getByRole('button', { name: 'Réessayer' })
  const shown = verdict === 'indisponible' && (await retry.count()) === 1
  console.log(`[${ts()}] panne simulée : ${verdict}, bouton Réessayer ${shown ? 'présent' : 'ABSENT'}`)
  await page.screenshot({ path: resolve(OUT, 'probe-lidar-panne.png') })
  if (!shown) verdict = 'panne-mal-affichee'
  else {
    await page.unroute(COPC)
    await retry.click()
    console.log(`[${ts()}] réseau rétabli, tap Réessayer`)
    verdict = await waitVerdict()
  }
}
const text = (await sheet.innerText().catch(() => '')).replace(/\n+/g, ' | ')
console.log(`[${ts()}] VERDICT ${verdict}\n  fiche : ${text.slice(0, 600)}`)
await page.screenshot({ path: resolve(OUT, `probe-lidar-${verdict}.png`) })
await browser.close()
process.exit(verdict === 'ok' ? 0 : 1)
