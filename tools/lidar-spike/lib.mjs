// Fonctions de mesure partagées entre spike.mjs (données réelles) et
// bench.mjs (banc synthétique) — le banc doit tester EXACTEMENT ce code.
//
// Phase 1 : RANSAC déterministe (seed), seuils adaptatifs à la densité locale
// (10-56 pts/m² observés selon le recouvrement des lignes de vol), fusion des
// pans sur-segmentés, fermeture morphologique (corrige le biais des cellules
// vides), ventilation par pan (principal / secondaire / plat / annexe).

export const RANSAC_VERT_TOL = 0.15 // tolérance verticale d'appartenance à un plan (m)
export const MAX_PANS = 12
export const MIN_PAN_M2 = 3 // aire projetée minimale d'un pan retenu
export const MAX_SLOPE_DEG = 65 // au-delà : mur / artefact, pas un pan de toit
export const CELL = 0.5 // grille d'occupation (m)
export const FLAT_SLOPE_DEG = 7 // en deçà : toit plat/terrasse

// --- RNG déterministe (LCG) : mêmes points -> même mesure, toujours. --------
function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

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

// --- Ajustement de plans z = ax + by + c ----------------------------------------
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

const maxTan = () => Math.tan((MAX_SLOPE_DEG * Math.PI) / 180)

/** Densité locale (pts/m²) estimée par l'occupation de la grille. */
export function localDensity(pts) {
  const cells = new Set()
  for (const [x, y] of pts) cells.add(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`)
  return cells.size ? pts.length / (cells.size * CELL * CELL) : 0
}

export function segmentPans(pts) {
  const rng = makeRng(42) // déterministe : mêmes points -> mêmes pans
  const density = localDensity(pts)
  // seuil d'inliers ≈ 2,5 m² de toit à la densité locale (plancher 20 pts)
  const minInliers = Math.max(20, Math.round(2.5 * density))
  let remaining = pts.map((_, i) => i)
  const pans = []
  while (remaining.length >= minInliers && pans.length < MAX_PANS) {
    let best = null
    for (let iter = 0; iter < 400; iter++) {
      const s = [0, 0, 0].map(() => remaining[(rng() * remaining.length) | 0])
      const plane = fitPlane3(pts[s[0]], pts[s[1]], pts[s[2]])
      if (!plane) continue
      if (Math.hypot(plane[0], plane[1]) > maxTan()) continue
      const [a, b, c] = plane
      const inliers = []
      for (const i of remaining) {
        const [x, y, z] = pts[i]
        if (Math.abs(z - (a * x + b * y + c)) < RANSAC_VERT_TOL) inliers.push(i)
      }
      if (!best || inliers.length > best.inliers.length) best = { plane, inliers }
    }
    if (!best || best.inliers.length < minInliers) break
    const refined = refinePlane(pts, best.inliers) ?? best.plane
    if (Math.hypot(refined[0], refined[1]) <= maxTan()) {
      const [a, b, c] = refined
      const inliers = remaining.filter(
        (i) => Math.abs(pts[i][2] - (a * pts[i][0] + b * pts[i][1] + c)) < RANSAC_VERT_TOL,
      )
      if (inliers.length >= minInliers) best = { plane: refined, inliers }
    }
    pans.push(best)
    const taken = new Set(best.inliers)
    remaining = remaining.filter((i) => !taken.has(i))
  }
  mergePans(pts, pans)
  return { pans, leftover: remaining.length, density }
}

/**
 * Fusion des pans sur-segmentés : deux « pans » dont les plans sont quasi
 * parallèles (< 5°) ET quasi confondus (écart vertical < 0,35 m au centroïde)
 * sont le même pan physique coupé en deux par la tolérance RANSAC.
 */
function mergePans(pts, pans) {
  const normal = ([a, b]) => {
    const n = Math.hypot(a, b, 1)
    return [-a / n, -b / n, 1 / n]
  }
  const centroid = (pan) => {
    let sx = 0, sy = 0, sz = 0
    for (const i of pan.inliers) {
      sx += pts[i][0]; sy += pts[i][1]; sz += pts[i][2]
    }
    const n = pan.inliers.length
    return [sx / n, sy / n, sz / n]
  }
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < pans.length; i++) {
      for (let j = i + 1; j < pans.length; j++) {
        const ni = normal(pans[i].plane)
        const nj = normal(pans[j].plane)
        const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2]
        if (dot < Math.cos((5 * Math.PI) / 180)) continue
        const [cx, cy, cz] = centroid(pans[j])
        const [a, b, c] = pans[i].plane
        if (Math.abs(cz - (a * cx + b * cy + c)) > 0.35) continue
        pans[i].inliers = pans[i].inliers.concat(pans[j].inliers)
        pans[i].plane = refinePlane(pts, pans[i].inliers) ?? pans[i].plane
        pans.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
}

export function panMetrics(pts, pan, ring, density) {
  const [a, b] = pan.plane
  const slope = Math.atan(Math.hypot(a, b))
  // Cellules du pan. Hors emprise murale (zone de débord), on exige une
  // densité minimale : un vrai débord est aussi dense que le toit, les
  // tranches de FAÇADE découpées par le RANSAC ne laissent que des lignes
  // clairsemées (source d'une sur-mesure au périmètre, vue à Mions).
  const outsideMin = Math.min(6, Math.max(2, Math.round(0.4 * density * CELL * CELL)))
  const counts = new Map()
  for (const i of pan.inliers) {
    const k = `${Math.floor(pts[i][0] / CELL)}:${Math.floor(pts[i][1] / CELL)}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const cells = new Set()
  for (const [k, n] of counts) {
    if (n >= outsideMin) {
      cells.add(k)
      continue
    }
    if (!ring) continue
    const [cx, cy] = k.split(':').map(Number)
    if (pointInRing((cx + 0.5) * CELL, (cy + 0.5) * CELL, ring)) cells.add(k)
  }
  // Fermeture morphologique : une cellule vide entourée d'occupées est un
  // trou d'échantillonnage (~5 % des cellules à 12 pts/m²), pas un vrai trou.
  const added = []
  for (const k of cells) {
    const [cx, cy] = k.split(':').map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue
        const nk = `${cx + dx}:${cy + dy}`
        if (cells.has(nk)) continue
        let occ = 0
        for (let ex = -1; ex <= 1; ex++) {
          for (let ey = -1; ey <= 1; ey++) {
            if (!ex && !ey) continue
            if (cells.has(`${cx + dx + ex}:${cy + dy + ey}`)) occ++
          }
        }
        if (occ >= 5) added.push(nk)
      }
    }
  }
  for (const k of added) cells.add(k)
  const projected = cells.size * CELL * CELL
  const slopeDeg = (slope * 180) / Math.PI
  return {
    slopeDeg,
    // Azimut boussole (0 = nord, 90 = est) — aligné sur l'app (lidar-core.ts).
    azimutDeg: ((Math.atan2(-a, -b) * 180) / Math.PI + 360) % 360,
    projected,
    real: projected / Math.cos(slope),
    n: pan.inliers.length,
    cells,
  }
}

/**
 * Mesure complète. Le total DÉDUPLIQUE les cellules entre pans (toits
 * multi-niveaux). Chaque pan est typé : `plat` (< 7°), `principal` (le plus
 * grand pan incliné et ceux de pente comparable — le toit à couvrir) ou
 * `secondaire` (annexes, appentis). `totalPrincipal` = surface du toit
 * principal seul, la donnée la plus utile au couvreur.
 */
function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(a) / 2
}

export function measureRoof(pts, ring) {
  const { pans, leftover, density } = segmentPans(pts)
  const kept = []
  let total = 0
  const used = new Set()
  for (const pan of pans) {
    const m = panMetrics(pts, pan, ring, density)
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
  // Typage : pans plats vs inclinés ; parmi les inclinés, le plus grand et
  // ceux de pente voisine (±8°) forment le toit principal.
  const pitched = kept.filter((m) => m.slopeDeg >= FLAT_SLOPE_DEG)
  const mainSlope = pitched.length
    ? pitched.reduce((a, b) => (a.realDedup > b.realDedup ? a : b)).slopeDeg
    : null
  let totalPrincipal = 0
  for (const m of kept) {
    if (m.slopeDeg < FLAT_SLOPE_DEG) m.type = 'plat'
    else if (mainSlope != null && Math.abs(m.slopeDeg - mainSlope) <= 8) m.type = 'principal'
    else m.type = 'secondaire'
    if (m.type === 'principal') totalPrincipal += m.realDedup
  }
  // Couverture : part de l'emprise murale réellement vue par les pans.
  // Sous les arbres denses, la classification ne laisse presque pas de
  // points « bâtiment » → mesurer serait mentir (35 m² sur une maison de
  // 178 m² vue à Oullins). En deçà de 55 %, la mesure est non fiable.
  const coverage = ring ? (used.size * CELL * CELL) / ringArea(ring) : null
  const verdict =
    coverage != null && coverage < 0.55 ? 'faible_confiance' : 'ok'
  return { pans: kept, leftover, total, totalPrincipal, density, coverage, verdict }
}
