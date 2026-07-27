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
  'pose-1': { y: 420, h: 424 }, // quartier + points + FAB « + » halo + onglets
  'pose-2': { y: 330, h: 424 }, // réticule sur le toit → « Poser ici »
  'pose-3': { y: 285, h: 440 }, // fiche : Client rempli + note terrain
  'relance-1': { y: 235, h: 440 }, // fiche : Client + « Revoir le » halo
  'relance-2': { y: 150, h: 460 }, // Accueil : Aujourd'hui → À relancer
  'rdv-1': { y: 190, h: 460 }, // formulaire pré-rempli : titre → Adresse
  'rdv-2': { y: 130, h: 560 }, // chip « Mes RDV » halo + semaines à pilules
  'rdv-3': { y: 380, h: 424 }, // sheet du jour : rail + rangée d'issues
  'maison-1': { y: 135, h: 424 }, // pans sur l'ortho + en-tête fiche + badges
  'maison-2': { y: 150, h: 500 }, // module Toiture : segmented + 3D + légende
  'maison-3': { y: 200, h: 460 }, // totaux (Σ retenue) + plan coté + tête de
  // tableau — la ligne « Établi par … » (y≈181, sondée) reste HORS cadre tant
  // que le profil de capture affiche un email (le renommer au semis).
  // NB : sheet ouverte, la page capturée fait 664 pt de haut (pas 844).
}

const files = readdirSync(IN).filter((f) => /^(pose|relance|rdv|maison)-\d\.png$/.test(f))
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
