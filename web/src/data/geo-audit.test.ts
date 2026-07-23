// Banc d'AUDIT GÃ‰OMÃ‰TRIQUE des pans dessinÃ©s (diagnostic, non bloquant).
// Rejoue toutes les fixtures rÃ©elles tools/lidar-spike/fixtures/*.json
// (capturÃ©es par dump.mjs) dans le pipeline measureRoof â†’ reconstructRoof â†’
// mainBodyPans, et calcule des invariants de santÃ© : pans en repli (Â« voile Â»),
// sommets hors emprise, couverture, extrapolation d'altitude, zigzag,
// auto-intersections, part du corps principal. Rapport Ã©crit dans
// tools/lidar-spike/audit-report.json. Aucun assert bloquant.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { distToRing, measureRoof, pointInRing, ringArea, type Pt, type Ring } from './lidar-core'
import { mainBodyPans, offsetRing, reconstructRoof, type ReconPan } from './lidar-recon'

const FIXTURES_DIR = fileURLToPath(new URL('../../../tools/lidar-spike/fixtures', import.meta.url))
const REPORT_PATH = fileURLToPath(
  new URL('../../../tools/lidar-spike/audit-report.json', import.meta.url),
)

// --- GÃ©omÃ©trie locale (outillage du banc uniquement) -----------------------------

/** Aire d'un contour fermÃ© (premier = dernier), en valeur absolue. */
function contourArea(c: [number, number][]): number {
  return ringArea(c as Ring)
}

/** DiamÃ¨tre 2D d'un contour : plus grande distance entre deux sommets. */
function diameter2D(c: [number, number][]): number {
  let d = 0
  for (let i = 0; i < c.length - 1; i++) {
    for (let j = i + 1; j < c.length - 1; j++) {
      d = Math.max(d, Math.hypot(c[j][0] - c[i][0], c[j][1] - c[i][1]))
    }
  }
  return d
}

/** Croisement STRICT de deux segments (contacts aux extrÃ©mitÃ©s exclus). */
function segmentsCross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  const EPS = 1e-9
  return (
    ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
    ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))
  )
}

/** true si deux segments NON adjacents du contour fermÃ© se croisent. */
function selfIntersects(c: [number, number][]): boolean {
  const n = c.length - 1 // segments du contour fermÃ©
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // premier et dernier sont adjacents
      if (segmentsCross(c[i], c[i + 1], c[j], c[j + 1])) return true
    }
  }
  return false
}

// --- Invariants par fixture -------------------------------------------------------

interface Audit {
  fixture: string
  n_pts: number
  n_pans: number
  total_m2: number
  recon_null: boolean
  fallback_pans: number
  out_of_outline_m: number | null
  coverage_ratio: number | null
  sail_factor: number | null
  max_vertices: number | null
  self_intersect: boolean | null
  body_share: number
  pitched_share: number
}

function auditFixture(name: string, ring: Ring, pts: Pt[]): Audit {
  const m = measureRoof(pts, ring)
  const r = reconstructRoof(
    m.pans.map((p) => ({ plane: p.plane, counts: p.counts, zMin: p.zMin, zMax: p.zMax })),
    ring,
    0.5,
  )
  const body = mainBodyPans(
    m.pans.map((p) => p.realDedup),
    m.pans.map((p) => p.type === 'plat'),
    r?.welds ?? [],
    r?.absorbed ?? [],
  )

  const totalDedup = m.pans.reduce((s, p) => s + p.realDedup, 0)
  const bodyDedup = m.pans.reduce((s, p, i) => (body.has(i) ? s + p.realDedup : s), 0)
  const pitchedDedup = m.pans.reduce((s, p) => (p.type !== 'plat' ? s + p.realDedup : s), 0)
  const body_share = totalDedup > 0 ? bodyDedup / totalDedup : 0
  const pitched_share = totalDedup > 0 ? pitchedDedup / totalDedup : 0

  // Pans significatifs SANS contour reconstruit ni absorbeur : ils replieront
  // sur l'ancienne vectorisation (risque de Â« voile Â»).
  const absorbedIdx = new Set((r?.absorbed ?? []).map(([a]) => a))
  let fallback_pans = 0
  for (const [i, p] of m.pans.entries()) {
    if (p.realDedup < 10) continue
    if (r === null || (r.pans[i] === null && !absorbedIdx.has(i))) fallback_pans++
  }

  if (r === null) {
    return {
      fixture: name,
      n_pts: pts.length,
      n_pans: m.pans.length,
      total_m2: Math.round(m.total * 10) / 10,
      recon_null: true,
      fallback_pans,
      out_of_outline_m: null,
      coverage_ratio: null,
      sail_factor: null,
      max_vertices: null,
      self_intersect: null,
      body_share: Math.round(body_share * 1000) / 1000,
      pitched_share: Math.round(pitched_share * 1000) / 1000,
    }
  }

  // Polygone de rÃ©fÃ©rence : emprise dÃ©calÃ©e du dÃ©bord (repli : emprise nue).
  const off = offsetRing(ring, 0.5) ?? ring
  const offArea = ringArea(off)

  const drawn: { pan: ReconPan; i: number }[] = []
  for (const [i, pan] of r.pans.entries()) if (pan !== null) drawn.push({ pan, i })

  let out_of_outline_m = 0
  let drawnArea = 0
  let sail_factor = 0
  let max_vertices = 0
  let self_intersect = false
  for (const { pan, i } of drawn) {
    const c = pan.contour
    for (const [x, y] of c) {
      if (!pointInRing(x, y, off)) {
        out_of_outline_m = Math.max(out_of_outline_m, distToRing(x, y, off))
      }
    }
    drawnArea += contourArea(c)
    const slopeRad = (m.pans[i].slopeDeg * Math.PI) / 180
    const span = Math.max(...pan.alts) - Math.min(...pan.alts)
    const expected = Math.tan(slopeRad) * diameter2D(c) + 0.3
    sail_factor = Math.max(sail_factor, span / expected)
    max_vertices = Math.max(max_vertices, c.length - 1)
    if (selfIntersects(c)) self_intersect = true
  }

  return {
    fixture: name,
    n_pts: pts.length,
    n_pans: m.pans.length,
    total_m2: Math.round(m.total * 10) / 10,
    recon_null: false,
    fallback_pans,
    out_of_outline_m: Math.round(out_of_outline_m * 100) / 100,
    coverage_ratio: offArea > 0 ? Math.round((drawnArea / offArea) * 1000) / 1000 : null,
    sail_factor: Math.round(sail_factor * 100) / 100,
    max_vertices,
    self_intersect,
    body_share: Math.round(body_share * 1000) / 1000,
    pitched_share: Math.round(pitched_share * 1000) / 1000,
  }
}

// --- Banc -----------------------------------------------------------------------

describe('audit gÃ©omÃ©trique des pans dessinÃ©s (banc de diagnostic)', () => {
  it('rejoue toutes les fixtures et Ã©crit audit-report.json', () => {
    const files = readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()

    const report: Audit[] = []
    for (const f of files) {
      const { ring, pts } = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as {
        ring: Ring
        pts: Pt[]
      }
      report.push(auditFixture(f.replace(/\.json$/, ''), ring, pts))
    }

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8')

    // RÃ©sumÃ© lisible en console.
    console.log(`\n=== AUDIT GÃ‰OMÃ‰TRIQUE â€” ${report.length} fixture(s) ===`)
    for (const a of report) {
      const flags: string[] = []
      if (a.recon_null) flags.push('RECON NULL')
      if (a.fallback_pans > 0) flags.push(`${a.fallback_pans} pan(s) en repli`)
      if ((a.out_of_outline_m ?? 0) > 0.05) flags.push(`hors emprise ${a.out_of_outline_m} m`)
      if (a.coverage_ratio !== null && (a.coverage_ratio < 0.85 || a.coverage_ratio > 1.1)) {
        flags.push(`couverture ${a.coverage_ratio}`)
      }
      if ((a.sail_factor ?? 0) > 1.2) flags.push(`voile x${a.sail_factor}`)
      if ((a.max_vertices ?? 0) > 20) flags.push(`zigzag ${a.max_vertices} sommets`)
      if (a.self_intersect) flags.push('AUTO-INTERSECTION')
      if (a.body_share < 0.5 && a.pitched_share >= 0.6) flags.push(`corps ${a.body_share}`)
      console.log(
        `  ${a.fixture}: ${a.total_m2} mÂ², ${a.n_pans} pans â€” ` +
          (flags.length ? `SUSPECT [${flags.join(', ')}]` : 'OK') +
          ` | couverture=${a.coverage_ratio} voile=${a.sail_factor} sommets=${a.max_vertices}` +
          ` corps=${a.body_share}`,
      )
    }
    console.log(`Rapport : ${REPORT_PATH}\n`)

    expect(true).toBe(true) // banc de diagnostic : rien de bloquant
  })
}, 180_000)
