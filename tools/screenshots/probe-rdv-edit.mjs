// Sonde : décalage d'un RDV depuis la fiche contact ET la fiche point (29/07).
// LECTURE SEULE — on ouvre le formulaire d'édition pré-rempli puis Annuler.
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

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })
).newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })

// --- 1. Depuis la fiche CONTACT --------------------------------------------
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Contacts' }).click()
await page.waitForTimeout(1000)
await page.locator('.home-row').first().click() // Gerard (échéance la plus proche)
await page.waitForTimeout(1500)
await page.screenshot({ path: resolve(OUT, 'rdv-edit-contact.png') })
const modif = page.locator('.drawer-content').getByRole('button', { name: 'Modifier' })
if (!(await modif.count())) {
  console.log('✗ contact : pas de bouton Modifier sur la ligne du RDV')
} else {
  await modif.first().click()
  await page.waitForTimeout(1200)
  const title = await page.locator('.drawer-title').last().textContent()
  const date = await page.locator('input[type="date"]').first().inputValue()
  console.log(`✔ contact → formulaire « ${title} », date pré-remplie ${date}`)
  await page.screenshot({ path: resolve(OUT, 'rdv-edit-form.png') })
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForTimeout(700)
}

// --- 2. Depuis la fiche POINT (carte) --------------------------------------
// Le tap au jugé rate les marqueurs (coordonnées ≠ adresse BAN dans ces
// données) : on passe par « Voir sur la carte » du CONTACT — le focus ouvre
// la fiche du point directement (App.tsx → MapView setSelectedId).
await page.getByRole('button', { name: 'Contacts' }).click()
await page.waitForTimeout(800)
await page.locator('.home-row', { hasText: 'Jean Massé' }).first().click() // RDV 30/07
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Voir sur la carte' }).click()
await page.waitForTimeout(4000) // bascule Carte + flyTo + fiche + RDV du point
const sheet = page.locator('.drawer-content')
if (await sheet.locator('.rdv-block').count()) {
  await page.screenshot({ path: resolve(OUT, 'rdv-edit-point.png') })
  const dupBtn = await sheet.getByRole('button', { name: 'RDV', exact: true }).count()
  console.log(dupBtn ? '✗ le bouton « RDV » (doublon) est encore visible' : '✔ bouton « RDV » masqué (RDV à venir)')
  const modif2 = sheet.locator('.rdv-block').getByRole('button', { name: 'Modifier' })
  if (await modif2.count()) {
    await modif2.first().click()
    await page.waitForTimeout(1200)
    const title = await page.locator('.drawer-title').last().textContent()
    const date = await page.locator('input[type="date"]').first().inputValue()
    console.log(`✔ point → formulaire « ${title} », date pré-remplie ${date}`)
    await page.screenshot({ path: resolve(OUT, 'rdv-edit-point-form.png') })
    await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  } else {
    console.log('✗ point : pas de bouton Modifier dans le bloc RDV')
  }
} else {
  console.log('! fiche du point sans bloc RDV (focus raté ?)')
}
await browser.close()
