import { STATUSES, type PointStatus } from '../domain/status'

// Génère les images de marqueurs (badge rond coloré + icône blanche + ombre),
// dessinées sur canvas en 2x pour un rendu net (retina). Nom d'image : marker-<statut>.

export const MARKER_PREFIX = 'marker-'
/** Suffixe des variantes "a une note" (pastille en haut à droite). */
export const NOTE_SUFFIX = '-note'
const SIZE = 64 // px canvas (pixelRatio 2 => ~32px à l'écran)

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  status: PointStatus,
  cx: number,
  cy: number,
  ink = '#ffffff',
) {
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  // Traits épais : le glyphe doit rester lisible en plein soleil (canvas 2x,
  // 5 ici = 2,5 px à l'écran).
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
  const cx = SIZE / 2
  const cy = SIZE / 2
  const r = 21

  // « Absent » inversé (audit UX A13) : deux disques gris quasi identiques se
  // confondaient à l'échelle quartier — blanc = porte à RETENTER, sombre =
  // éliminée, couleurs = opportunités.
  const inverted = status === 'absent'
  const disc = inverted ? '#ffffff' : color
  const ring = inverted ? color : '#ffffff'

  // Disque avec ombre douce.
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = disc
  ctx.fill()
  ctx.restore()

  // Anneau (épaissi : détache le marqueur des toits sombres de l'ortho).
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 4
  ctx.strokeStyle = ring
  ctx.stroke()

  drawGlyph(ctx, status, cx, cy, inverted ? color : '#ffffff')

  // Pastille "a une note" : petit disque blanc + point accent, en haut à
  // droite du badge — signale un contexte terrain sans ouvrir la fiche.
  if (withNote) {
    const bx = cx + r * 0.74
    const by = cy - r * 0.74
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
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
