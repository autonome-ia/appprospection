import { STATUSES } from '../domain/status'

// Bulles de regroupement en "donut" : un arc par statut, proportionnel au
// nombre de points — on lit la composition d'une rue sans dézoomer.
// Rendu en marqueurs DOM (SVG) : les couches circle de MapLibre ne savent
// pas dessiner d'arcs, et il n'y a que quelques clusters visibles à la fois.

/** Compteurs par statut agrégés par la source (clusterProperties). */
export const clusterCountProperties = Object.fromEntries(
  STATUSES.map((s) => [s.value, ['+', ['case', ['==', ['get', 'status'], s.value], 1, 0]]]),
)

/** Propriétés d'un cluster (compteurs + totaux fournis par MapLibre). */
export type ClusterProps = Record<string, unknown> & {
  cluster_id: number
  point_count: number
  point_count_abbreviated: string | number
}

/** Signature de composition : si elle change, le donut doit être redessiné. */
export function clusterSignature(props: Record<string, unknown>): string {
  return STATUSES.map((s) => props[s.value] ?? 0).join('-')
}

// Même valeur que --ink (index.css) : le SVG est généré hors du DOM stylé.
const INK = '#16161a'

/** Un secteur d'anneau (donut) entre deux fractions [0..1] du total. */
function donutSegment(start: number, end: number, r: number, r0: number, color: string): string {
  if (end - start === 1) end -= 0.00001 // un cercle complet ne se dessine pas en un seul arc
  const a0 = 2 * Math.PI * (start - 0.25) // -0.25 : démarre en haut (midi)
  const a1 = 2 * Math.PI * (end - 0.25)
  const x0 = Math.cos(a0)
  const y0 = Math.sin(a0)
  const x1 = Math.cos(a1)
  const y1 = Math.sin(a1)
  const largeArc = end - start > 0.5 ? 1 : 0
  return (
    `<path d="M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${r + r * y0} ` +
    `A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} ` +
    `L ${r + r0 * x1} ${r + r0 * y1} A ${r0} ${r0} 0 ${largeArc} 0 ${r + r0 * x0} ${r + r0 * y0}" ` +
    `fill="${color}"/>`
  )
}

/** Construit l'élément DOM du donut (anneau par statut + total au centre). */
export function createClusterDonut(props: ClusterProps): HTMLElement {
  const parts = STATUSES.map((s) => ({ color: s.color, n: Number(props[s.value]) || 0 }))
  const total = Number(props.point_count) || 1
  const r = total >= 50 ? 26 : total >= 10 ? 22 : 18
  const r0 = r - 5
  const w = r * 2

  let html = `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" text-anchor="middle">`
  let offset = 0
  for (const part of parts) {
    if (!part.n) continue
    html += donutSegment(offset / total, (offset + part.n) / total, r, r0, part.color)
    offset += part.n
  }
  html +=
    `<circle cx="${r}" cy="${r}" r="${r0}" fill="#ffffff"/>` +
    `<text x="${r}" y="${r}" dominant-baseline="central" ` +
    `font-family="'Geist Mono Variable', ui-monospace, monospace" ` +
    `font-size="${total >= 1000 ? 11 : 12}" font-weight="600" fill="${INK}">` +
    `${props.point_count_abbreviated}</text></svg>`

  const el = document.createElement('div')
  el.className = 'cluster-donut'
  el.innerHTML = html
  return el
}
