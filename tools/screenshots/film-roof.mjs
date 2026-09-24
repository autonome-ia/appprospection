// Planches ANIMÉES du chargement de la mesure du toit (chantier design,
// 24/09/2026) : vidéo + images fixes d'une VRAIE mesure (cache en base
// contourné par ?lidar-nocache, serveur dev uniquement), compte sondes,
// agence de démo, lecture seule.
// Usage : node film-roof.mjs [ligne|etapes]   THEME=dark pour le sombre.
// Sortie : screenshoots/roof-ui/<variante>[-sombre].webm + -t<N>s.png
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
if (!/^sondes-/.test(env.GUIDE_EMAIL ?? '')) {
  console.error('! GUIDE_EMAIL doit être un compte sondes-* (agence de démo)')
  process.exit(2)
}
const VARIANT = process.argv[2] === 'etapes' ? 'etapes' : 'ligne'
const DARK = process.env.THEME === 'dark'
// PANNE=1 : serveur COPC injoignable -> planche de la carte d'échec.
const PANNE = process.env.PANNE === '1'
const NAME = `${VARIANT}${process.env.TAG ?? ''}${DARK ? '-sombre' : ''}${PANNE ? '-panne' : ''}${process.env.REDUCE === '1' ? '-reduit' : ''}`
const OUT = resolve(root, 'screenshoots', 'roof-ui')
const TMP = join(OUT, `.tmp-${NAME}`)
mkdirSync(TMP, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  recordVideo: { dir: TMP, size: { width: 390, height: 844 } },
  // REDUCE=1 : « réduire les animations » (ni faisceau ni éclat).
  reducedMotion: process.env.REDUCE === '1' ? 'reduce' : 'no-preference',
})
if (DARK) await ctx.addInitScript(() => localStorage.setItem('theme', 'dark'))
const page = await ctx.newPage()
if (PANNE) await page.route(/data\.geopf\.fr\/telechargement\//, (r) => r.abort('connectionrefused'))
await page.goto(`http://localhost:5173/?lidar-nocache&roofui=${VARIANT}`, { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(2000)
const input = page.getByPlaceholder(/Rechercher/)
await input.fill('18 Rue du Retalaire Lesneven')
await page.waitForTimeout(2500)
await page.locator('.address-results button').first().click()
await page.waitForTimeout(5000) // photo chargée ; le préchauffage démarre
await input.fill('')
await page.evaluate(() => document.activeElement?.blur?.())
const VP = page.viewportSize()
const t0 = Date.now()
await page.mouse.click(Math.round(VP.width / 2), Math.round(VP.height / 2))
const sheet = page.locator('.drawer-content')
// Le final (pans qui se matérialisent, ~0,5 s) : capturé sur l'événement.
const finaleShot = page
  .waitForSelector('.roof-finale', { state: 'attached', timeout: 90000 })
  .then(async () => {
    await page.waitForTimeout(140)
    await page.screenshot({ path: join(OUT, `${NAME}-final.png`) })
  })
  .catch(() => {})
const stills = [1.5, 3, 5, 7, 9, 12]
let verdict = 'timeout'
for (let i = 0; i < 400; i++) {
  const s = (Date.now() - t0) / 1000
  if (stills.length && s >= stills[0]) {
    await page.screenshot({ path: join(OUT, `${NAME}-t${String(stills.shift()).replace('.', '_')}s.png`) })
  }
  const txt = (await sheet.innerText().catch(() => '')) || ''
  if (/Toiture mesurée/.test(txt)) {
    verdict = 'ok'
    break
  }
  if (/Mesure laser indisponible/.test(txt)) {
    verdict = 'indisponible'
    break
  }
  await page.waitForTimeout(250)
}
const took = ((Date.now() - t0) / 1000).toFixed(1)
await finaleShot
await page.waitForTimeout(80) // en plein final (pans qui se matérialisent)
await page.screenshot({ path: join(OUT, `${NAME}-fin-a.png`) })
await page.waitForTimeout(1200) // fondu du balayage + chiffre qui roule
await page.screenshot({ path: join(OUT, `${NAME}-fin-b.png`) })
await page.close()
await ctx.close()
await browser.close()
const webm = readdirSync(TMP).find((f) => f.endsWith('.webm'))
if (webm) renameSync(join(TMP, webm), join(OUT, `${NAME}.webm`))
rmSync(TMP, { recursive: true, force: true })
console.log(`${NAME} : ${verdict} en ${took} s -> screenshoots/roof-ui/${NAME}.webm`)
process.exit(verdict === 'ok' ? 0 : 1)
