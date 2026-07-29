// Sonde : formulaire « Nouveau contact » (27/07). LECTURE SEULE — on ne
// clique « Créer le contact » QUE sur une adresse déjà occupée (garde
// anti-doublon : le flux doit s'arrêter au toast, sans écrire).
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

// Adresse d'un point EXISTANT (occupée -> le garde doit refuser).
const TAKEN = '26 Rue du Rétalaire 29260 Le Folgoët'

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
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Contacts' }).click()
await page.waitForTimeout(800)

await page.getByRole('button', { name: 'Nouveau contact' }).click()
await page.waitForTimeout(900)
await page.getByPlaceholder(/^Nom/).fill('M. Le Gall')
await page.getByPlaceholder('06…').fill('06 12 34 56 78')
await page.getByPlaceholder(/Contexte/).fill('Rappeler après 18 h')
const addr = page.getByPlaceholder('Adresse de la maison…')
await addr.fill(TAKEN.replace(' 29260', ''))
await page.waitForTimeout(2200)
const options = await page.locator('.form-address-results .address-label').allTextContents()
console.log('Suggestions BAN :', options.join(' | '))
const exact = page.locator('.form-address-results button', { hasText: TAKEN })
if (!(await exact.count())) {
  console.log('! Pas de suggestion au libellé exact — on n’appuie PAS sur Créer (aucune écriture).')
  await page.screenshot({ path: resolve(OUT, 'contact-form.png') })
} else {
  await exact.first().click()
  await page.waitForTimeout(500)
  const value = await addr.inputValue()
  await page.screenshot({ path: resolve(OUT, 'contact-form.png') })
  if (value !== TAKEN) {
    console.log(`! Libellé choisi "${value}" ≠ adresse en base — on n’appuie pas sur Créer.`)
  } else {
    await page.getByRole('button', { name: 'Créer le contact' }).click()
    await page.waitForTimeout(2500)
    const refused = await page.getByText('Un point existe déjà à cette adresse').count()
    console.log(refused ? '✔ Garde anti-doublon : création refusée' : '✗ PAS DE TOAST — vérifier !')
    await page.screenshot({ path: resolve(OUT, 'contact-form-doublon.png') })
  }
}
await page.getByRole('button', { name: 'Annuler', exact: true }).click()
await browser.close()
