// Prototypage DA : injecte chaque variante de tokens (da/*.css) par-dessus
// l'app locale et capture les 4 mêmes écrans. Rien n'est modifié dans l'app.
// Puis assemble des planches comparatives par écran (3 variantes côte à côte).
import { chromium, devices } from 'playwright'
import sharp from 'sharp'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const OUT = resolve(root, 'screenshoots', 'da')
const env = Object.fromEntries(
  readFileSync(resolve(root, 'web', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
mkdirSync(OUT, { recursive: true })

const VARIANTS = readdirSync(resolve(here, 'da'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ id: f.replace('.css', ''), css: resolve(here, 'da', f) }))

const browser = await chromium.launch()
for (const v of VARIANTS) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  })
  const page = await ctx.newPage()
  const shot = async (name) => {
    await page.waitForTimeout(700)
    await page.screenshot({ path: resolve(OUT, `${v.id}--${name}.png`) })
    console.log(`✔ ${v.id}--${name}.png`)
  }
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
  await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForSelector('canvas', { timeout: 20000 })
  await page.addStyleTag({ path: v.css })
  await page.waitForTimeout(2500) // webfonts éventuelles (Fraunces)

  await page.getByRole('button', { name: 'Accueil' }).click()
  await page.waitForSelector('.guide-card', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2200)
  await shot('accueil')

  await page.getByRole('button', { name: 'Agenda' }).click()
  await page.waitForTimeout(1500)
  await shot('agenda')

  const today = page.locator('.cal-cell.is-today')
  if (await today.count()) {
    await today.click()
    await page.waitForTimeout(1000)
    await shot('jour')
    const close = page.locator('.drawer-content').getByRole('button', { name: 'Fermer' })
    if (await close.count()) await close.first().click()
    await page.waitForTimeout(600)
  }

  await page.getByRole('button', { name: 'Stats' }).click()
  await page.waitForSelector('.stats-hero', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await shot('stats')

  await ctx.close()
}
await browser.close()

// Planches comparatives : 3 variantes côte à côte, par écran.
for (const screen of ['accueil', 'agenda', 'jour', 'stats']) {
  const cols = []
  for (const v of VARIANTS) {
    cols.push(await sharp(resolve(OUT, `${v.id}--${screen}.png`)).resize({ width: 500 }).toBuffer())
  }
  const metas = await Promise.all(cols.map((b) => sharp(b).metadata()))
  const H = Math.max(...metas.map((m) => m.height))
  await sharp({
    create: { width: 500 * cols.length + 40, height: H + 20, channels: 3, background: '#222' },
  })
    .composite(cols.map((input, i) => ({ input, left: 10 + i * 510, top: 10 })))
    .png()
    .toFile(resolve(OUT, `compare--${screen}.png`))
  console.log(`✔ compare--${screen}.png`)
}
