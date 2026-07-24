import { useMemo, useState } from 'react'
import { PencilRuler } from 'lucide-react'
import type { RoofData } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'

// -----------------------------------------------------------------------------
// Plan coté du toit, vu du dessus (style « Length/Notes Diagram » des rapports
// EagleView) : pans colorés lettrés (A = le plus grand) avec m² et pente,
// longueur sur chaque arête significative, nord en haut. SVG pur, dérivé du
// jsonb déjà stocké — aucune dépendance, imprimable (futur rapport client).
// -----------------------------------------------------------------------------

interface Props {
  roof: RoofData
}

const toLocal = (
  lng: number,
  lat: number,
  lng0: number,
  lat0: number,
): [number, number] => [
  (lng - lng0) * 111320 * Math.cos((lat0 * Math.PI) / 180),
  (lat - lat0) * 110540,
]

interface DiagramPan {
  idx: number
  letter: string
  color: string
  /** Sommets en coordonnées SVG (x = est, y = -nord), fermés. */
  pts: [number, number][]
  alts: number[]
  m2: number
  pente: number
  centre: [number, number]
}

interface EdgeLabel {
  x: number
  y: number
  angle: number
  text: string
}

function buildDiagram(roof: RoofData) {
  const drawable = roof.pans
    .map((pan, idx) => ({ pan, idx }))
    .filter(({ pan }) => pan.contour && pan.contour.length >= 4)
  if (!drawable.length) return null
  let lng0 = 0
  let lat0 = 0
  let n = 0
  for (const { pan } of drawable) {
    for (const [lng, lat] of pan.contour!) {
      lng0 += lng
      lat0 += lat
      n++
    }
  }
  lng0 /= n
  lat0 /= n

  // Lettres : A = le plus grand pan (convention des rapports pros).
  const letterOf = new Map<number, string>()
  ;[...drawable]
    .sort((a, b) => b.pan.m2 - a.pan.m2)
    .forEach(({ idx }, i) => letterOf.set(idx, String.fromCharCode(65 + (i % 26))))

  const pans: DiagramPan[] = drawable.map(({ pan, idx }, i) => {
    const pts = pan.contour!.map(([lng, lat]) => {
      const [e, no] = toLocal(lng, lat, lng0, lat0)
      return [e, -no] as [number, number]
    })
    let cx = 0
    let cy = 0
    for (const [x, y] of pts.slice(0, -1)) {
      cx += x
      cy += y
    }
    return {
      idx,
      letter: letterOf.get(idx)!,
      color: PAN_COLORS[i % PAN_COLORS.length],
      pts,
      alts: pan.alts ?? [],
      m2: pan.m2,
      pente: pan.pente_deg,
      centre: [cx / (pts.length - 1), cy / (pts.length - 1)],
    }
  })

  // Cotes : une par arête ≥ 2,5 m, partagées étiquetées une seule fois
  // (les frontières communes ont exactement les mêmes sommets). Longueur
  // VRAIE (3D) quand les altitudes sont là.
  const seen = new Set<string>()
  const labels: EdgeLabel[] = []
  for (const p of pans) {
    for (let v = 0; v < p.pts.length - 1; v++) {
      const [ax, ay] = p.pts[v]
      const [bx, by] = p.pts[v + 1]
      const ka = `${ax.toFixed(2)}:${ay.toFixed(2)}`
      const kb = `${bx.toFixed(2)}:${by.toFixed(2)}`
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (seen.has(key)) continue
      seen.add(key)
      const len2 = Math.hypot(bx - ax, by - ay)
      if (len2 < 2.5) continue
      const dz = p.alts.length > v + 1 ? (p.alts[v + 1] ?? 0) - (p.alts[v] ?? 0) : 0
      const len = Math.round(Math.hypot(len2, dz) * 2) / 2
      let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
      if (angle > 90) angle -= 180
      if (angle < -90) angle += 180
      labels.push({
        x: (ax + bx) / 2,
        y: (ay + by) / 2,
        angle,
        text: `${String(len).replace('.', ',')} m`,
      })
    }
  }

  const all = pans.flatMap((p) => p.pts)
  const minx = Math.min(...all.map((p) => p[0])) - 2
  const maxx = Math.max(...all.map((p) => p[0])) + 2
  const miny = Math.min(...all.map((p) => p[1])) - 2
  const maxy = Math.max(...all.map((p) => p[1])) + 2
  return { pans, labels, minx, miny, w: maxx - minx, h: maxy - miny }
}

/** Plan coté du toit mesuré — bouton discret sous la maquette 3D. */
export function RoofDiagram({ roof }: Props) {
  const [open, setOpen] = useState(false)
  const d = useMemo(() => buildDiagram(roof), [roof])
  if (!d) return null

  if (!open) {
    return (
      <button type="button" className="roof3d-btn" onClick={() => setOpen(true)}>
        <PencilRuler size={15} strokeWidth={1.9} />
        Plan coté du toit
      </button>
    )
  }

  const span = Math.max(d.w, d.h)
  const fs = span * 0.045 // tailles en unités « mètres » du viewBox
  const fsSmall = span * 0.034
  return (
    <div className="roof-diagram">
      <svg
        viewBox={`${d.minx} ${d.miny} ${d.w} ${d.h}`}
        role="img"
        aria-label="Plan du toit vu du dessus, cotes en mètres"
      >
        {d.pans.map((p) => (
          <polygon
            key={p.idx}
            points={p.pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={p.color}
            fillOpacity={0.55}
            stroke={p.color}
            strokeWidth={span * 0.006}
            strokeLinejoin="round"
          />
        ))}
        {d.labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y}
            transform={`rotate(${l.angle} ${l.x} ${l.y})`}
            textAnchor="middle"
            dominantBaseline="middle"
            className="roof-diagram-cote"
            fontSize={fsSmall}
          >
            {l.text}
          </text>
        ))}
        {d.pans.map((p) => (
          <text
            key={`c${p.idx}`}
            x={p.centre[0]}
            y={p.centre[1]}
            textAnchor="middle"
            className="roof-diagram-pan"
            fontSize={fs}
          >
            <tspan fontWeight={700}>{p.letter}</tspan>
            <tspan x={p.centre[0]} dy={fs * 1.1} fontSize={fsSmall}>
              {p.m2} m² · {p.pente}°
            </tspan>
          </text>
        ))}
        {/* Nord en haut */}
        <g
          className="roof-diagram-north"
          transform={`translate(${d.minx + d.w - span * 0.06} ${d.miny + span * 0.09})`}
        >
          <path
            d={`M0 ${span * 0.03} L${span * 0.018} ${span * 0.055} L0 ${span * 0.045} L${-span * 0.018} ${span * 0.055} Z`}
            transform={`translate(0 ${-span * 0.075})`}
            fill="currentColor"
          />
          <text textAnchor="middle" y={span * 0.045} fontSize={fsSmall}>
            N
          </text>
        </g>
      </svg>
      <button type="button" className="roof3d-btn" onClick={() => setOpen(false)}>
        Masquer le plan
      </button>
    </div>
  )
}
