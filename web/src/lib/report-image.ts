// -----------------------------------------------------------------------------
// Rendu du rapport client en IMAGE (audit UX C2) : en PWA iOS installée,
// window.print() est un no-op et « Partager » n'envoyait que 5 lignes de
// texte — le « document remis au prospect » n'existait pas, face à des
// concurrents qui laissent un PDF EagleView. On dessine le rapport à la main
// (Canvas 2D, AUCUNE dépendance — la géométrie du plan vient de buildDiagram,
// la même que le SVG affiché), puis navigator.share reçoit un vrai fichier.
// Chargé à la demande (import dynamique) depuis RoofReport.
// -----------------------------------------------------------------------------
import { buildDiagram } from '../components/RoofDiagram'
import type { RoofData } from '../domain/house'

// Largeur logique du document ; exporté à 2× (netteté Retina/zoom).
const W = 640
const SCALE = 2
const M = 36 // marge

// Polices de la DA : Geist est chargée par l'app, le canvas y a accès.
const SANS = "'Geist Variable', -apple-system, 'Segoe UI', sans-serif"
const MONO = "'Geist Mono Variable', ui-monospace, 'SF Mono', monospace"
// Tokens couleur (index.css) — le canvas ne lit pas les variables CSS.
const INK = '#16161a'
const INK2 = '#6b6b73'
const INK3 = '#9a9aa2'
const LINE = '#ececea'
const ACCENT = '#2f6bff'

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
const exposition = (az: number) => CARDINALS[Math.round(az / 45) % 8]

export interface ReportImageInput {
  roof: RoofData
  excluded?: ReadonlySet<number>
  /** Entrées (index de pan, lettre), triées par lettre. */
  letters: [number, string][]
  address: string | null
  maisonM2: number | null
  totalM2: number | null
  selectionM2: number | null
  showSelection: boolean
  /** Base de la surface de commande (sélection Σ, sinon badge maison). */
  base: number
  wastePct: number
  wasteRows: number[]
  edgeRows: [string, string][]
  survol: string | null
  identLine: string
}

export async function renderReportImage(input: ReportImageInput): Promise<Blob> {
  // Geist doit être prête AVANT de dessiner, sinon fallback système figé.
  await (document.fonts?.ready ?? Promise.resolve())
  // Passe 1 (mesure) : hauteur totale ; passe 2 : dessin réel.
  const probe = document.createElement('canvas').getContext('2d')!
  const height = layout(probe, input, false)
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = Math.ceil(height) * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, height)
  layout(ctx, input, true)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob a échoué'))), 'image/png'),
  )
}

/** Dessine (ou mesure seulement) le document ; retourne la hauteur finale. */
function layout(ctx: CanvasRenderingContext2D, inp: ReportImageInput, draw: boolean): number {
  let y = M

  const text = (
    s: string,
    x: number,
    yy: number,
    font: string,
    color: string,
    align: CanvasTextAlign = 'left',
  ) => {
    if (!draw) return
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, yy)
  }
  const widthOf = (s: string, font: string) => {
    ctx.font = font
    return ctx.measureText(s).width
  }
  const rule = (yy: number) => {
    if (!draw) return
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(M, yy)
    ctx.lineTo(W - M, yy)
    ctx.stroke()
  }

  // --- En-tête ---
  text('Rapport de toiture', M, y + 22, `650 25px ${SANS}`, INK)
  y += 32
  if (inp.address) {
    text(inp.address, M, y + 15, `500 15px ${SANS}`, INK2)
    y += 22
  }
  text(
    `Mesure au laser aéroporté — nuage de points IGN LiDAR HD${inp.survol ? ` · survol ${inp.survol}` : ''} · précision ±5 %`,
    M,
    y + 13,
    `400 11.5px ${SANS}`,
    INK3,
  )
  y += 17
  text(inp.identLine, M, y + 13, `400 11.5px ${SANS}`, INK3)
  y += 30

  // --- Chiffres clés ---
  {
    let x = M
    const fig = (val: string, cap: string, color = INK) => {
      text(val, x, y + 24, `650 25px ${MONO}`, color)
      text(cap, x, y + 41, `400 11px ${SANS}`, INK3)
      x += Math.max(widthOf(val, `650 25px ${MONO}`), widthOf(cap, `400 11px ${SANS}`)) + 30
    }
    if (inp.maisonM2 != null) fig(`${inp.maisonM2} m²`, 'toit de la maison')
    if (inp.totalM2 != null && inp.totalM2 !== inp.maisonM2)
      fig(`${inp.totalM2} m²`, 'avec annexes et extensions')
    if (inp.showSelection && inp.selectionM2 != null)
      fig(`Σ ${inp.selectionM2} m²`, 'surface retenue avec vous', ACCENT)
    y += 56
  }

  // --- Plan coté (même géométrie que le SVG affiché) ---
  const d = buildDiagram(inp.roof)
  if (d) {
    const availW = W - 2 * M
    const s = Math.min(availW / d.w, 300 / d.h)
    const pw = d.w * s
    const ph = d.h * s
    const ox = M + (availW - pw) / 2 - d.minx * s
    const oy = y + 8 - d.miny * s
    if (draw) {
      for (const p of d.pans) {
        const off = inp.excluded?.has(p.idx) ?? false
        ctx.beginPath()
        p.pts.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(ox + px * s, oy + py * s)
          else ctx.lineTo(ox + px * s, oy + py * s)
        })
        ctx.closePath()
        ctx.globalAlpha = off ? 0.14 : 0.55
        ctx.fillStyle = off ? INK3 : p.color
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = off ? INK3 : p.color
        ctx.lineWidth = 1.5
        if (off) ctx.setLineDash([5, 4])
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.textAlign = 'center'
      for (const l of d.labels) {
        ctx.save()
        ctx.translate(ox + l.x * s, oy + l.y * s)
        ctx.rotate((l.angle * Math.PI) / 180)
        ctx.font = `500 10px ${MONO}`
        ctx.fillStyle = INK2
        ctx.fillText(l.text, 0, 3)
        ctx.restore()
      }
      for (const p of d.pans) {
        const off = inp.excluded?.has(p.idx) ?? false
        ctx.globalAlpha = off ? 0.45 : 1
        text(p.letter, ox + p.centre[0] * s, oy + p.centre[1] * s, `700 14px ${SANS}`, INK, 'center')
        text(
          `${p.m2} m² · ${p.pente}°`,
          ox + p.centre[0] * s,
          oy + p.centre[1] * s + 14,
          `500 10px ${MONO}`,
          INK2,
          'center',
        )
        ctx.globalAlpha = 1
      }
      // Nord en haut (flèche + N), coin haut-droit du plan.
      const nx = M + availW - 12
      const ny = y + 18
      ctx.beginPath()
      ctx.moveTo(nx, ny - 10)
      ctx.lineTo(nx + 5, ny + 4)
      ctx.lineTo(nx, ny)
      ctx.lineTo(nx - 5, ny + 4)
      ctx.closePath()
      ctx.fillStyle = INK3
      ctx.fill()
      text('N', nx, ny + 16, `600 10px ${SANS}`, INK3, 'center')
      ctx.textAlign = 'left'
    }
    y += ph + 30
  }

  // --- Tableaux ---
  const HEAD = `600 10.5px ${SANS}`
  const CELL = `500 12px ${MONO}`
  const drawTable = (
    headers: string[],
    rows: { cells: string[]; muted?: boolean }[],
    colX: number[],
    accentCol = -1,
  ) => {
    headers.forEach((h, i) =>
      text(h.toUpperCase(), colX[i], y + 12, HEAD, i === accentCol ? ACCENT : INK3),
    )
    y += 18
    rule(y)
    for (const r of rows) {
      r.cells.forEach((c, i) =>
        text(
          c,
          colX[i],
          y + 17,
          i === accentCol && !r.muted ? `650 12px ${MONO}` : CELL,
          r.muted ? INK3 : i === accentCol ? ACCENT : INK,
        ),
      )
      y += 24
      rule(y)
    }
    y += 22
  }

  // Pans (lettre, surface, pente, exposition) — exclus grisés (B3).
  drawTable(
    ['Pan', 'Surface', 'Pente', 'Exposition'],
    inp.letters.map(([idx, letter]) => {
      const pan = inp.roof.pans[idx]
      const off = inp.excluded?.has(idx) ?? false
      return {
        cells: [
          off ? `${letter} · exclu` : letter,
          `${pan.m2} m²`,
          `${pan.pente_deg}°`,
          pan.type === 'plat' ? '—' : exposition(pan.azimut_deg),
        ],
        muted: off,
      }
    }),
    [M, M + 150, M + 280, M + 400],
  )

  // Longueurs par type d'arête.
  if (inp.edgeRows.length > 0) {
    drawTable(
      ['Longueurs', 'mesure laser'],
      inp.edgeRows.map(([label, value]) => ({ cells: [label, value] })),
      [M, M + 280],
    )
  }

  // Chutes de coupe (colonne suggérée en accent).
  if (inp.base > 0) {
    const cols = [M, ...inp.wasteRows.map((_, i) => M + 230 + i * 85)]
    drawTable(
      [inp.showSelection ? 'Chutes (sur Σ retenue)' : 'Chutes de coupe', ...inp.wasteRows.map((w) => `${w} %`)],
      [
        {
          cells: [
            'Surface de commande',
            ...inp.wasteRows.map((w) => `${Math.round(inp.base * (1 + w / 100))} m²`),
          ],
        },
      ],
      cols,
      1 + inp.wasteRows.indexOf(inp.wastePct),
    )
  }

  text(
    'Données IGN (BD TOPO, LiDAR HD) · surface « maison » hors annexes · chutes indicatives',
    M,
    y + 8,
    `400 10.5px ${SANS}`,
    INK3,
  )
  y += 16

  return y + M
}
