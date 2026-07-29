// Sonde tâches d'agenda (lecture seule — Annuler, jamais Enregistrer) :
// la sheet du jour montre « Tâche » + « RDV ce jour », le formulaire
// « Nouvelle tâche » ouvre sur « Quoi faire ». THEME=dark pour le sombre.
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
const DARK = process.env.THEME === 'dark'
const SUF = DARK ? '-sombre' : ''
const browser = await chromium.launch()
const page = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage()
if (DARK) await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Email').fill(env.GUIDE_EMAIL)
await page.getByPlaceholder('Mot de passe').fill(env.GUIDE_PASSWORD)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.waitForSelector('canvas', { timeout: 20000 })
await page.getByRole('button', { name: 'Agenda' }).click()
await page.waitForTimeout(1800)
// « + Tâche » en 1 tap depuis le mois (retour briac 29/07) : formulaire
// direct, pré-réglé sur la prochaine heure ronde — puis Annuler.
await page.locator('.agenda-add-task').click()
await page.waitForTimeout(1000)
await page.screenshot({ path: resolve(OUT, `tache-mois${SUF}.png`) })
console.log(`✔ tache-mois${SUF}.png`)
await page.getByRole('button', { name: 'Annuler' }).click()
await page.waitForTimeout(800)
await page.locator('.cal-cell.is-today').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: resolve(OUT, `tache-jour${SUF}.png`) })
console.log(`✔ tache-jour${SUF}.png`)
await page.locator('.drawer-content').getByRole('button', { name: 'Tâche' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: resolve(OUT, `tache-form${SUF}.png`) })
console.log(`✔ tache-form${SUF}.png`)
await page.getByRole('button', { name: 'Annuler' }).click()
await browser.close()
console.log('✔ probe-tache (aucune écriture)')
