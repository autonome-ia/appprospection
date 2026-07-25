import { STATUSES, type PointStatus } from '../domain/status'

// -----------------------------------------------------------------------------
// Marqueurs de statut — rendu « premium » (refonte briac 25/07).
// Le disque plat + anneau épais + ombre floue faisait clipart ; ici, les
// techniques des pins pro (Apple Maps / Linear) :
//   · rendu 3× (net sur iPhone, DPR 3) ;
//   · ombre en DEUX passes (ambiante large très diffuse + contact serrée)
//     au lieu d'un halo gris ;
//   · disque en léger dégradé vertical + reflet haut discret (de la
//     dimension, jamais de glossy) ;
//   · anneau blanc affiné + filet hairline sombre à l'extérieur — le pin se
//     détache du plan clair COMME des toits sombres de l'ortho.
// Sémantique conservée (audit UX A13) : blanc = porte à RETENTER (absent),
// sombre = éliminée, couleurs = opportunités.
// -----------------------------------------------------------------------------

export const MARKER_PREFIX = 'marker-'
/** Suffixe des variantes "a une note" (pastille en haut à droite). */
export const NOTE_SUFFIX = '-note'

/** Espace logique du dessin (les coordonnées ci-dessous vivent en 64). */
const BASE = 64
/** Rendu 3× : l'image fait 96 px, MapLibre l'affiche via pixelRatio 3. */
export const MARKER_PIXEL_RATIO = 3
const SIZE = (BASE * MARKER_PIXEL_RATIO) / 2 // 96 (le 64 logique valait déjà 2×)
const K = SIZE / BASE // facteur logique → device

const INK_SHADOW = '16, 16, 26' // --ink en rgb (ombres teintées encre, pas noires)

/** Mélange hex → hex (t ∈ [0,1]) — dégradés du disque sans lib couleur. */
function mix(hex: string, target: string, t: number): string {
  const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
  const [r1, g1, b1] = h(hex)
  const [r2, g2, b2] = h(target)
  const c = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  status: PointStatus,
  cx: number,
  cy: number,
  ink = '#ffffff',
) {
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  // Traits épais : le glyphe doit rester lisible en plein soleil.
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  switch (status) {
    case 'vendu': // check ✓
      ctx.moveTo(cx - 9, cy + 1)
      ctx.lineTo(cx - 3, cy + 8)
      ctx.lineTo(cx + 10, cy - 8)
      ctx.stroke()
      break
    case 'impossible': // croix ✕
      ctx.moveTo(cx - 8, cy - 8)
      ctx.lineTo(cx + 8, cy + 8)
      ctx.moveTo(cx - 8, cy + 8)
      ctx.lineTo(cx + 8, cy - 8)
      ctx.stroke()
      break
    case 'absent': // tiret —
      ctx.moveTo(cx - 9, cy)
      ctx.lineTo(cx + 9, cy)
      ctx.stroke()
      break
    case 'hors_cible': { // cercle barré ⊘ (pas notre cible)
      ctx.lineWidth = 3.5
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - 6.5, cy + 6.5)
      ctx.lineTo(cx + 6.5, cy - 6.5)
      ctx.stroke()
      break
    }
    case 'a_revoir': { // horloge (repasser plus tard)
      ctx.lineWidth = 3.5
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx, cy - 6)
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + 5, cy + 1)
      ctx.stroke()
      break
    }
    case 'rdv_pris': { // calendrier
      ctx.lineWidth = 3.5
      ctx.strokeRect(cx - 9, cy - 5, 18, 14)
      ctx.beginPath()
      ctx.moveTo(cx - 9, cy - 0.5)
      ctx.lineTo(cx + 9, cy - 0.5)
      ctx.moveTo(cx - 4, cy - 9)
      ctx.lineTo(cx - 4, cy - 5)
      ctx.moveTo(cx + 4, cy - 9)
      ctx.lineTo(cx + 4, cy - 5)
      ctx.stroke()
      break
    }
  }
}

function drawMarker(color: string, status: PointStatus, withNote = false): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  // Tout le dessin vit en coordonnées logiques 64 (glyphes inchangés).
  ctx.scale(K, K)
  const cx = BASE / 2
  const cy = BASE / 2
  const r = 20.5

  // « Absent » inversé (audit UX A13) : deux disques gris quasi identiques se
  // confondaient à l'échelle quartier — blanc = porte à RETENTER, sombre =
  // éliminée, couleurs = opportunités.
  const inverted = status === 'absent'

  const discPath = () => {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }

  // 1) Ombres, en deux passes (paramètres shadow* en pixels DEVICE — ils ne
  //    suivent pas ctx.scale) : ambiante large très diffuse + contact serrée.
  ctx.save()
  ctx.shadowColor = `rgba(${INK_SHADOW}, 0.20)`
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 5
  discPath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.shadowColor = `rgba(${INK_SHADOW}, 0.28)`
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 2
  ctx.fill()
  ctx.restore()

  // 2) Disque : léger dégradé vertical (clair en haut, assis en bas) — de la
  //    dimension sans effet bonbon.
  const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r)
  if (inverted) {
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(1, '#f1f1ef')
  } else {
    grad.addColorStop(0, mix(color, '#ffffff', 0.16))
    grad.addColorStop(0.42, color)
    grad.addColorStop(1, mix(color, '#0e0e14', 0.14))
  }
  discPath()
  ctx.fillStyle = grad
  ctx.fill()

  // 3) Reflet haut discret (bevel doux, pas de glossy) — inutile sur blanc.
  if (!inverted) {
    const sheen = ctx.createLinearGradient(0, cy - r, 0, cy)
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)')
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.save()
    discPath()
    ctx.clip()
    ctx.fillStyle = sheen
    ctx.fillRect(cx - r, cy - r, r * 2, r)
    ctx.restore()
  }

  // 4) Anneau (affiné) : blanc sur couleur, couleur sur le disque blanc.
  discPath()
  ctx.lineWidth = 3
  ctx.strokeStyle = inverted ? color : '#ffffff'
  ctx.stroke()

  // 5) Filet hairline sombre à l'extérieur de l'anneau : détache le pin du
  //    plan clair comme des toits sombres (technique du double contour).
  ctx.beginPath()
  ctx.arc(cx, cy, r + 1.6, 0, Math.PI * 2)
  ctx.lineWidth = 0.8
  ctx.strokeStyle = `rgba(${INK_SHADOW}, 0.30)`
  ctx.stroke()

  drawGlyph(ctx, status, cx, cy, inverted ? color : '#ffffff')

  // Pastille "a une note" : disque blanc cerclé hairline + point accent, en
  // haut à droite — signale un contexte terrain sans ouvrir la fiche.
  if (withNote) {
    const bx = cx + r * 0.74
    const by = cy - r * 0.74
    ctx.save()
    ctx.shadowColor = `rgba(${INK_SHADOW}, 0.25)`
    ctx.shadowBlur = 3
    ctx.shadowOffsetY = 1.5
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.lineWidth = 0.8
    ctx.strokeStyle = `rgba(${INK_SHADOW}, 0.25)`
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(bx, by, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#2f6bff' // = --accent (index.css)
    ctx.fill()
  }

  return ctx.getImageData(0, 0, SIZE, SIZE)
}

/** Images de marqueurs : une par statut + une variante "-note" par statut. */
export function generateMarkerImages(): Record<string, ImageData> {
  const out: Record<string, ImageData> = {}
  for (const s of STATUSES) {
    out[s.value] = drawMarker(s.color, s.value)
    out[`${s.value}${NOTE_SUFFIX}`] = drawMarker(s.color, s.value, true)
  }
  return out
}
