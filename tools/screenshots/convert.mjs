// Convertit les captures PNG (screenshoots/guide/) en WebP compressé vers
// web/public/guide/ — largeur 780 px (2× la largeur d'affichage dans la
// sheet), qualité 82. `node convert.mjs` après une moisson de shoot.mjs.
import sharp from 'sharp'
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const IN = resolve(root, 'screenshoots', 'guide')
const OUT = resolve(root, 'web', 'public', 'guide')
mkdirSync(OUT, { recursive: true })

// Seuls les fichiers du Guide (pas les sondes/contrôles/débogages qui
// traînent dans le dossier de travail).
const files = readdirSync(IN).filter((f) => /^(pose|rdv|maison)-\d\.png$/.test(f))
for (const f of files) {
  const out = resolve(OUT, f.replace(/\.png$/, '.webp'))
  const { size } = await sharp(resolve(IN, f))
    .resize({ width: 780 })
    .webp({ quality: 82 })
    .toFile(out)
  console.log(`✔ ${f} → ${Math.round(size / 1024)} Ko`)
}
