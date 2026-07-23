// Sanity check du traçage de contour (copie de web/src/data/lidar.ts —
// fonctions pures) : un L de cellules doit donner un anneau à 6 coins.
const CELL = 0.5

function traceOutline(cells) {
  const edges = new Map()
  const has = (x, y) => cells.has(`${x}:${y}`)
  for (const k of cells) {
    const [x, y] = k.split(':').map(Number)
    if (!has(x, y - 1)) edges.set(`${x}:${y}`, [x + 1, y])
    if (!has(x + 1, y)) edges.set(`${x + 1}:${y}`, [x + 1, y + 1])
    if (!has(x, y + 1)) edges.set(`${x + 1}:${y + 1}`, [x, y + 1])
    if (!has(x - 1, y)) edges.set(`${x}:${y + 1}`, [x, y])
  }
  let best = null
  let bestArea = 0
  const visited = new Set()
  for (const start of edges.keys()) {
    if (visited.has(start)) continue
    const ring = []
    let key = start
    while (!visited.has(key)) {
      visited.add(key)
      const [x, y] = key.split(':').map(Number)
      ring.push([x, y])
      const next = edges.get(key)
      if (!next) break
      key = `${next[0]}:${next[1]}`
    }
    if (ring.length < 4) continue
    let area = 0
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[(i + 1) % ring.length]
      area += x1 * y2 - x2 * y1
    }
    area = Math.abs(area) / 2
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return { ring: best, area: bestArea }
}

// Douglas-Peucker sur une polyligne OUVERTE.
function dpOpen(line, eps) {
  if (line.length <= 2) return line
  const keep = new Array(line.length).fill(false)
  keep[0] = true
  keep[line.length - 1] = true
  const stack = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b - a < 2) continue
    const [ax, ay] = line[a]
    const [bx, by] = line[b]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let worst = -1
    let worstD = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - line[i][1]) - (ax - line[i][0]) * (by - ay)) / len
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      stack.push([a, worst], [worst, b])
    }
  }
  return line.filter((_, i) => keep[i])
}

// Simplification d'un ANNEAU fermé : DP direct s'effondre (corde dégénérée
// premier = dernier point) — on coupe l'anneau au point le plus éloigné du
// départ et on simplifie les deux moitiés ouvertes.
function simplify(ring, eps) {
  if (ring.length <= 5) return ring
  const open = ring.slice(0, -1)
  let far = 1
  let farD = -1
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = dpOpen(open.slice(0, far + 1), eps)
  const b = dpOpen(open.slice(far).concat([open[0]]), eps)
  return a.concat(b.slice(1))
}

// L : rectangle 10×6 auquel on retire un coin 4×3 (en cellules)
const cells = new Set()
for (let x = 0; x < 10; x++) {
  for (let y = 0; y < 6; y++) {
    if (x >= 6 && y >= 3) continue
    cells.add(`${x}:${y}`)
  }
}
const { ring, area } = traceOutline(cells)
console.log(`aire tracée : ${area * CELL * CELL} m² (attendu ${(60 - 12) * 0.25})`)
const meters = ring.map(([x, y]) => [x * CELL, y * CELL])
meters.push(meters[0])
const smooth = simplify(meters, 0.55)
console.log(`sommets bruts : ${ring.length} -> lissés : ${smooth.length} (attendu ~7 : 6 coins + fermeture)`)
console.log(JSON.stringify(smooth))

// Escalier diagonal : cellules en marches -> doit devenir ~une diagonale
const diag = new Set()
for (let i = 0; i < 12; i++) {
  for (let dx = 0; dx <= i; dx++) diag.add(`${dx}:${i}`)
}
const t2 = traceOutline(diag)
const m2 = t2.ring.map(([x, y]) => [x * CELL, y * CELL])
m2.push(m2[0])
const s2 = simplify(m2, 0.55)
console.log(`triangle escalier : ${t2.ring.length} sommets -> ${s2.length} lissés (attendu ~4-6)`)
