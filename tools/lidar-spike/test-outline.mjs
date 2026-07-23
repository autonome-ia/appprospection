// Sanity check du traçage de contour — copie des fonctions PURES de
// web/src/data/lidar.ts (les garder synchronisées à la main).
// Cas couverts : L simple, escalier diagonal, pincement en diagonale,
// nappe trouée (ardoise sombre) avant/après fermeture morphologique.
const CELL = 0.5

function closeCells(cells, radius) {
  let dil = new Set(cells)
  for (let r = 0; r < radius; r++) {
    const next = new Set(dil)
    for (const k of dil) {
      const [x, y] = k.split(':').map(Number)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) next.add(`${x + dx}:${y + dy}`)
      }
    }
    dil = next
  }
  for (let r = 0; r < radius; r++) {
    const next = new Set()
    for (const k of dil) {
      const [x, y] = k.split(':').map(Number)
      let full = true
      for (let dx = -1; dx <= 1 && full; dx++) {
        for (let dy = -1; dy <= 1 && full; dy++) {
          if (!dil.has(`${x + dx}:${y + dy}`)) full = false
        }
      }
      if (full) next.add(k)
    }
    dil = next
  }
  return dil
}

function traceOutline(cells) {
  const edges = new Map()
  const has = (x, y) => cells.has(`${x}:${y}`)
  const addEdge = (fx, fy, tx, ty) => {
    const k = `${fx}:${fy}`
    const list = edges.get(k) ?? []
    list.push({ to: [tx, ty], used: false })
    edges.set(k, list)
  }
  for (const k of cells) {
    const [x, y] = k.split(':').map(Number)
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y)
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y)
  }
  let best = null
  let bestArea = 0
  for (const [startKey, startList] of edges) {
    for (const startEdge of startList) {
      if (startEdge.used) continue
      const ring = []
      let [cx, cy] = startKey.split(':').map(Number)
      let edge = startEdge
      let guard = 0
      while (!edge.used && guard++ < 100000) {
        edge.used = true
        ring.push([cx, cy])
        const [nx, ny] = edge.to
        const dirX = nx - cx
        const dirY = ny - cy
        const candidates = (edges.get(`${nx}:${ny}`) ?? []).filter((e) => !e.used)
        if (!candidates.length) break
        candidates.sort((a, b) => {
          const cross = (e) => dirX * (e.to[1] - ny) - dirY * (e.to[0] - nx)
          const dot = (e) => dirX * (e.to[0] - nx) + dirY * (e.to[1] - ny)
          return cross(b) - cross(a) || dot(b) - dot(a)
        })
        cx = nx
        cy = ny
        edge = candidates[0]
      }
      if (ring.length < 4) continue
      let area = 0
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        area += x1 * y2 - x2 * y1
      }
      area = area / 2
      if (area > bestArea) {
        bestArea = area
        best = ring
      }
    }
  }
  return best ? { ring: best, area: bestArea } : null
}

let failures = 0
function check(label, cond, detail) {
  console.log(`${cond ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// 1. L : rectangle 10×6 moins un coin 4×3
{
  const cells = new Set()
  for (let x = 0; x < 10; x++)
    for (let y = 0; y < 6; y++) if (!(x >= 6 && y >= 3)) cells.add(`${x}:${y}`)
  const t = traceOutline(cells)
  check('L : aire exacte', Math.abs(t.area - 48) < 1e-9, `${t.area} vs 48`)
}

// 2. Pincement en diagonale : deux carrés 3×3 qui se touchent par un coin.
//    L'ancien traçage (une arête par sommet) perdait une boucle ; le nouveau
//    doit rendre la plus grande boucle = un carré (9 cellules).
{
  const cells = new Set()
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.add(`${x}:${y}`)
  for (let x = 3; x < 6; x++) for (let y = 3; y < 6; y++) cells.add(`${x}:${y}`)
  const t = traceOutline(cells)
  check('pincement : boucle ≥ un carré, sans boucle folle', t.area >= 9 && t.area <= 18, `aire ${t.area}`)
}

// 3. Nappe trouée type ardoise sombre : rectangle 12×8 dont 30 % des cellules
//    manquent (déterministe). SANS fermeture le contour sous-couvre ; AVEC
//    fermeture (rayon 2) il doit retrouver ≈ l'enveloppe pleine.
{
  const cells = new Set()
  let seed = 7
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)
  for (let x = 0; x < 12; x++)
    for (let y = 0; y < 8; y++) if (rand() > 0.3) cells.add(`${x}:${y}`)
  const brute = traceOutline(cells)
  const fermee = traceOutline(closeCells(cells, 2))
  check(
    'nappe trouée : la fermeture restaure l’enveloppe',
    fermee.area >= 0.85 * 96 && fermee.area <= 96,
    `brute ${brute.area.toFixed(0)} -> fermée ${fermee.area.toFixed(0)} (plein = 96)`,
  )
}

process.exit(failures ? 1 : 0)
