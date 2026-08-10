// Convertit les captures PNG (screenshoots/guide/) en WebP vers
// web/public/guide/ — avec RECADRAGE par capture (plan-guides-v2.md :
// les captures plein écran v1 étaient illisibles dans le cadre ~carré de la
// sheet ; chaque étape cadre désormais sa bande utile, proche du ratio du
// .guide-frame). `node convert.mjs` après une moisson de shoot.mjs.
import sharp from 'sharp'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const IN = resolve(root, 'screenshoots', 'guide')
const OUT = resolve(root, 'web', 'public', 'guide')
mkdirSync(OUT, { recursive: true })

// Bande utile par capture, en pixels LOGIQUES iPhone 13 (390×844) — le PNG
// est en ×3 (1170×2532). { y, h } : x pleine largeur sauf mention contraire.
// Viser h ≈ 420-460 (ratio proche du cadre 358×388 de la sheet, léger
// letterbox vertical accepté). null = pas de recadrage (plein écran).
const CROP = {
  // NB : sheet ouverte, la page capturée fait 664 pt de haut (pas 844).
  'carte-1': { y: 420, h: 424 }, // quartier + points + FAB « + » halo + onglets
  'carte-2': { y: 300, h: 454 }, // réticule + grille 3×2 des statuts
  'carte-3': { y: 250, h: 440 }, // fiche : bloc RDV + Client rempli + note
  'carte-4': { y: 200, h: 440 }, // fiche maison : en-tête + badges
  'carte-5': { y: 400, h: 444 }, // barre de filtres dépliée + bouton halo
  'carte-6': { y: 150, h: 460 }, // drag : le fantôme suit le doigt (~y 240-290)
  'toit-1': { y: 135, h: 424 }, // pans sur l'ortho + en-tête fiche + badges
  'toit-2': { y: 150, h: 500 }, // module Toiture : segmented + 3D + légende
  'toit-3': { y: 200, h: 460 }, // totaux (Σ retenue) + plan coté
  'agenda-1': { y: 130, h: 560 }, // grille du mois : pilules + pastilles
  'agenda-2': { y: 100, h: 460 }, // légende-filtre « ● Prénom » halo
  'agenda-3': { y: 280, h: 440 }, // sheet du jour : rail horaire
  'agenda-4': { y: 380, h: 424 }, // rangée d'issues halo
  'agenda-5': { y: 250, h: 440 }, // RDV annulé (centré) + « Replanifier » halo
  'agenda-6': { y: 175, h: 440 }, // tâche (en tête du jour) + « Fait ✓ » halo
  'contacts-1': { y: 60, h: 500 }, // liste triée par échéance
  'contacts-2': { y: 190, h: 460 }, // formulaire « Nouveau contact »
  'accueil-1': { y: 150, h: 460 }, // carte Aujourd'hui + objectif
  'accueil-2': { y: 250, h: 460 }, // section « À relancer » + appel halo
  'accueil-3': { y: 280, h: 500 }, // popup du matin « Que s'est-il passé ? »
  'stats-1': { y: 250, h: 500 }, // héros + tunnel de conversion
  'stats-2': { y: 90, h: 420 }, // période + chevrons (halo)
}

const files = readdirSync(IN).filter((f) => /^(carte|agenda|contacts|accueil|stats|toit)-\d\.png$/.test(f))
if (!files.length) console.log('Rien à convertir dans', IN)
for (const f of files) {
  const name = f.replace(/\.png$/, '')
  const out = resolve(OUT, `${name}.webp`)
  let img = sharp(resolve(IN, f))
  const c = CROP[name]
  if (c) {
    const meta = await img.metadata()
    const s = Math.round(meta.width / 390) // ×3 sur iPhone 13, robuste si DPR change
    const top = Math.min(c.y * s, meta.height - 10)
    img = img.extract({
      left: (c.x ?? 0) * s,
      top,
      width: Math.min((c.w ?? 390) * s, meta.width),
      height: Math.min(c.h * s, meta.height - top),
    })
  }
  const { size } = await img.resize({ width: 780 }).webp({ quality: 82 }).toFile(out)
  console.log(`✔ ${name}.webp ${c ? `(bande y=${c.y} h=${c.h})` : '(plein écran)'} → ${Math.round(size / 1024)} Ko`)
}

// Une capture SAUTÉE par shoot.mjs (précondition non semée) ne doit pas
// laisser traîner une ancienne image désormais fausse : on signale les
// orphelines à supprimer à la main (jamais de rm automatique).
const expected = Object.keys(CROP)
for (const name of expected) {
  if (!existsSync(resolve(IN, `${name}.png`)) && existsSync(resolve(OUT, `${name}.webp`)))
    console.log(`! ${name}.webp existe côté web/ sans PNG frais — la supprimer si le texte a changé`)
}
