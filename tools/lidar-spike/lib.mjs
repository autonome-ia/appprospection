// Fonctions de mesure partagées entre spike.mjs (données réelles) et
// bench.mjs (banc synthétique) — le banc doit tester EXACTEMENT ce code.

export const RANSAC_VERT_TOL = 0.15 // tolérance verticale d'appartenance à un plan (m)
export const MAX_PANS = 10
export const MIN_PAN_M2 = 3 // aire projetée minimale d'un pan retenu
export const MAX_SLOPE_DEG = 65 // au-delà : mur / artefact, pas un pan de toit
export const CELL = 0.5 // grille d'occupation (m)

// --- Géométrie 2D -------------------------------------------------------------
export function pointInRing(px, py, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}
export function distToRing(px, py, ring) {
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)))
  }
  return best
}

// --- RANSAC de plans z = ax + by + c -------------------------------------------
export function fitPlane3(p1, p2, p3) {
  const [x1, y1, z1] = p1
  const [x2, y2, z2] = p2
  const [x3, y3, z3] = p3
  const det = (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  if (Math.abs(det) < 1e-6) return null
  const a = ((z1 - z3) * (y2 - y3) - (z2 - z3) * (y1 - y3)) / det
  const b = ((x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3)) / det
  const c = z3 - a * x3 - b * y3
  return [a, b, c]
}
export function refinePlane(pts, idx) {
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0
  const n = idx.length
  for (const i of idx) {
    const [x, y, z] = pts[i]
    sx += x; sy += y; sz += z
    sxx += x * x; syy += y * y; sxy += x * y
    sxz += x * z; syz += y * z
  }
  const mx = sx / n, my = sy / n, mz = sz / n
  const cxx = sxx / n - mx * mx
  const cyy = syy / n - my * my
  const cxy = sxy / n - mx * my
  const cxz = sxz / n - mx * mz
  const cyz = syz / n - my * mz
  const det = cxx * cyy - cxy * cxy
  if (Math.abs(det) < 1e-9) return null
  const a = (cxz * cyy - cyz * cxy) / det
  const b = (cyz * cxx - cxz * cxy) / det
  return [a, b, mz - a * mx - b * my]
}

export function segmentPans(pts) {
  let remaining = pts.map((_, i) => i)
  const pans = []
  while (remaining.length >= 40 && pans.length < MAX_PANS) {
    let best = null
    for (let iter = 0; iter < 400; iter++) {
      const s = [0, 0, 0].map(() => remaining[(Math.random() * remaining.length) | 0])
      const plane = fitPlane3(pts[s[0]], pts[s[1]], pts[s[2]])
      if (!plane) continue
      const [a, b, c] = plane
      if (Math.hypot(a, b) > Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)) continue
      const inliers = []
      for (const i of remaining) {
        const [x, y, z] = pts[i]
        if (Math.abs(z - (a * x + b * y + c)) < RANSAC_VERT_TOL) inliers.push(i)
      }
      if (!best || inliers.length > best.inliers.length) best = { plane, inliers }
    }
    if (!best || best.inliers.length < 40) break
    const refined = refinePlane(pts, best.inliers) ?? best.plane
    const [a, b, c] = refined
    if (Math.hypot(a, b) <= Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)) {
      const inliers = remaining.filter(
        (i) => Math.abs(pts[i][2] - (a * pts[i][0] + b * pts[i][1] + c)) < RANSAC_VERT_TOL,
      )
      if (inliers.length >= 40) best = { plane: refined, inliers }
    }
    pans.push(best)
    const taken = new Set(best.inliers)
    remaining = remaining.filter((i) => !taken.has(i))
  }
  return { pans, leftover: remaining.length }
}

export function panMetrics(pts, pan, ring) {
  const [a, b] = pan.plane
  const slope = Math.atan(Math.hypot(a, b))
  // Comptage de points par cellule. Les cellules HORS emprise murale (zone
  // de débord) doivent contenir ≥ 2 points : un vrai débord de toit est
  // aussi dense que le toit, alors que les points de FAÇADE tranchés par le
  // RANSAC ne laissent que des lignes clairsemées le long des murs — c'était
  // la source d'une sur-mesure proportionnelle au périmètre (vu à Mions).
  const counts = new Map()
  for (const i of pan.inliers) {
    const k = `${Math.floor(pts[i][0] / CELL)}:${Math.floor(pts[i][1] / CELL)}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const cells = new Set()
  for (const [k, n] of counts) {
    if (n >= 2) {
      cells.add(k)
      continue
    }
    if (!ring) continue
    const [cx, cy] = k.split(':').map(Number)
    if (pointInRing((cx + 0.5) * CELL, (cy + 0.5) * CELL, ring)) cells.add(k)
  }
  const projected = cells.size * CELL * CELL
  return {
    slopeDeg: (slope * 180) / Math.PI,
    azimutDeg: ((Math.atan2(-b, -a) * 180) / Math.PI + 360) % 360,
    projected,
    real: projected / Math.cos(slope),
    n: pan.inliers.length,
    cells,
  }
}

/**
 * Mesure complète : pans filtrés + total.
 * Le total DÉDUPLIQUE les cellules de grille entre pans : deux plans
 * superposés en XY (toit multi-niveaux, sur-segmentation) ne comptent
 * la même surface au sol qu'une fois — chaque cellule est attribuée au
 * premier pan (le plus gros) qui la contient.
 */
export function measureRoof(pts, ring) {
  const { pans, leftover } = segmentPans(pts)
  const kept = []
  let total = 0
  const used = new Set()
  for (const pan of pans) {
    const m = panMetrics(pts, pan, ring)
    if (m.projected < MIN_PAN_M2) continue
    let fresh = 0
    for (const c of m.cells) {
      if (!used.has(c)) {
        used.add(c)
        fresh++
      }
    }
    m.realDedup = (fresh * CELL * CELL) / Math.cos((m.slopeDeg * Math.PI) / 180)
    kept.push(m)
    total += m.realDedup
  }
  return { pans: kept, leftover, total }
}
