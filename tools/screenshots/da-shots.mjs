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

// Sans argument : toutes les variantes (comportement historique).
// Avec arguments : `node da-shots.mjs clair sombre-etage sombre-ligne`.
const only = process.argv.slice(2)
const VARIANTS = readdirSync(resolve(here, 'da'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ id: f.replace('.css', ''), css: resolve(here, 'da', f) }))
  .filter((v) => !only.length || only.includes(v.id))

// Zone à points du compte guide : la planche « carte » montre de vrais
// marqueurs, et le tap au centre ouvre une vraie fiche (lecture seule).
const CARTE_ADDR = process.env.CARTE_ADDR ?? '26 Rue de la Paix 29260 Le Folgoët'

/** Centroïde du marqueur ambre « À revoir » dans une capture (px CSS).
    Filtre couleur serré (la famille du dégradé #d97706) + cellule la plus
    dense pour ignorer d'éventuels pixels chauds isolés de l'ortho. */
const DPR = devices['iPhone 13'].deviceScaleFactor
const findAmbre = async (pngPath) => {
  const { data, info } = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true })
  const cells = new Map()
  const y0 = Math.round(120 * DPR)
  const y1 = Math.min(info.height, Math.round(620 * DPR)) // hors barre du haut, FAB et nav
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (r >= 190 && g >= 90 && g <= 165 && b <= 80 && r - b >= 120) {
        const k = `${(x / (14 * DPR)) | 0},${(y / (14 * DPR)) | 0}`
        const c = cells.get(k) ?? { n: 0, sx: 0, sy: 0 }
        c.n++
        c.sx += x
        c.sy += y
        cells.set(k, c)
      }
    }
  }
  let best = null
  for (const c of cells.values()) if (!best || c.n > best.n) best = c
  return best && best.n >= 30 ? { x: best.sx / best.n / DPR, y: best.sy / best.n / DPR } : null
}

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

  // Carte : centrage BAN sur la zone à points, barre vidée (anti-artefact),
  // puis tap au centre pour ouvrir la fiche du point (lecture seule).
  await page.getByRole('button', { name: 'Carte' }).click()
  await page.waitForTimeout(1500)
  const input = page.getByPlaceholder(/Rechercher/)
  for (let essai = 1; essai <= 3; essai++) {
    await input.fill('')
    await page.waitForTimeout(300)
    await input.fill(CARTE_ADDR)
    await page.waitForTimeout(1200 + essai * 800)
    const first = page.locator('.address-results button').first()
    if (await first.count()) {
      await first.click()
      await page.waitForTimeout(4500) // flyTo + tuiles ortho au zoom maison
      await input.fill('')
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.waitForTimeout(400)
      break
    }
    if (essai === 3) console.log(`  ! aucune suggestion BAN pour ${CARTE_ADDR}`)
  }
  await shot('carte')
  // Fiche du point : les marqueurs vivent dans le canvas (pas de DOM à
  // cliquer) et le balayage aveugle dérive (recadrage easeTo à chaque
  // sheet ouverte/refermée) — on REPÈRE le marqueur ambre « À revoir »
  // dans les pixels de la capture carte, et on clique pile dessus.
  const target = await findAmbre(resolve(OUT, `${v.id}--carte.png`))
  if (target) {
    await page.mouse.click(Math.round(target.x), Math.round(target.y))
    await page.waitForTimeout(2000)
    const sheet = page.locator('.drawer-content')
    if (await sheet.getByText('Statut', { exact: true }).count()) await shot('fiche')
    else console.log('  ! fiche : le clic n’a pas ouvert une fiche de point')
    const close = sheet.getByRole('button', { name: 'Fermer' })
    if (await close.count()) await close.first().click()
    await page.waitForTimeout(800)
  } else {
    console.log('  ! fiche : marqueur ambre introuvable dans la capture carte')
  }

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
for (const screen of ['accueil', 'carte', 'fiche', 'agenda', 'jour', 'stats']) {
  const cols = []
  for (const v of VARIANTS) {
    const path = resolve(OUT, `${v.id}--${screen}.png`)
    try {
      cols.push(await sharp(path).resize({ width: 500 }).toBuffer())
    } catch {
      console.log(`  ! ${v.id}--${screen}.png manquant — planche sans cette colonne`)
    }
  }
  if (!cols.length) continue
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
