// -----------------------------------------------------------------------------
// Maquette 3D du toit mesuré (fiche maison) — chunk séparé chargé au tap
// (three.js ~170 Ko gz, jamais dans le bundle principal, pattern data/lidar.ts).
//
// Entrée : RoofData v8 (pans jointifs rectilignes + emprise murale BD TOPO).
// Rendu « maquette d'architecte » :
//   - pans colorés (palette partagée avec l'ortho) aux arêtes tirées au
//     cordeau, bandeau de rive blanc sous les bords extérieurs ;
//   - murs plâtre extrudés de l'EMPRISE (droits par définition), hauteur
//     échantillonnée sur les plans des pans (pignons triangulaires
//     automatiques) — le toit déborde des murs et projette son ombre dessus ;
//   - faces verticales plâtre aux MARCHES entre niveaux (annexe basse) ;
//   - lumière hémisphérique ciel/sol (murs clairs même à l'ombre) + soleil
//     chaud avec ombre portée douce ;
//   - entrée en douceur + lente autorotation, stoppée au premier toucher ;
//   - pastilles « XX m² » projetées SUR les pans + boussole nord (DOM).
// -----------------------------------------------------------------------------
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LidarPan, RoofData } from '../domain/house'
import { PAN_COLORS } from '../domain/colors'

export interface RoofSceneHandle {
  dispose(): void
}

/** Pan dessinable : contour fermé + altitudes par sommet (mesure v6+). */
export function isPan3D(p: LidarPan): boolean {
  return (
    !!p.contour &&
    p.contour.length >= 4 &&
    !!p.alts &&
    p.alts.length === p.contour.length &&
    p.m2 >= 10
  )
}

const WALL_COLOR = 0xf1ede4 // plâtre chaud, clair (maquette d'architecte)
const FASCIA_COLOR = 0xffffff // bandeau de rive
const FASCIA_H = 0.16
const DEFAULT_WALL_M = 2.4 // hauteur de gouttière si la BD TOPO ne la donne pas
const WALL_SAMPLE_M = 0.7 // pas d'échantillonnage de la hauteur des murs

// Mètres locaux depuis lng/lat autour d'une origine (échelle bâtiment).
function toLocalMeters(
  lng: number,
  lat: number,
  lng0: number,
  lat0: number,
): [number, number] {
  const east = (lng - lng0) * 111320 * Math.cos((lat0 * Math.PI) / 180)
  const north = (lat - lat0) * 110540
  return [east, north]
}

const vKey = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`
const eKeyOf = (ax: number, ay: number, bx: number, by: number) => {
  const ka = vKey(ax, ay)
  const kb = vKey(bx, by)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function pointInPoly(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Plan z = ax + by + c ajusté aux sommets du pan (moindres carrés). */
function fitPlane(pts: [number, number, number][]): [number, number, number] {
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0
  const n = pts.length
  for (const [x, y, z] of pts) {
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
  if (Math.abs(det) < 1e-9) return [0, 0, mz]
  return [
    (cxz * cyy - cyz * cxy) / det,
    (cyz * cxx - cxz * cxy) / det,
    mz - ((cxz * cyy - cyz * cxy) / det) * mx - ((cyz * cxx - cxz * cxy) / det) * my,
  ]
}

export function mountRoofScene(container: HTMLElement, roof: RoofData): RoofSceneHandle {
  const drawable = roof.pans.filter(isPan3D)
  const wallM = roof.mur_m ?? DEFAULT_WALL_M

  const scene = new Scene()
  const disposables: { dispose(): void }[] = []
  const chips: { el: HTMLDivElement; at: Vector3 }[] = []

  // Origine locale : centroïde de tous les sommets.
  let lng0 = 0
  let lat0 = 0
  let count = 0
  for (const p of drawable) {
    for (const [lng, lat] of p.contour!) {
      lng0 += lng
      lat0 += lat
      count++
    }
  }
  lng0 /= count
  lat0 /= count

  // Pans en coordonnées locales (three : x = est, y = altitude, z = -nord).
  // Le sol est à y = 0, la gouttière la plus basse à y = wallM.
  interface LocalPan {
    pts2d: Vector2[] // (est, nord)
    ys: number[] // altitude de chaque sommet
    plane: [number, number, number] // y = a·est + b·nord + c
    color: Color
  }
  const locals: LocalPan[] = drawable.map((pan, i) => {
    const ring = pan.contour!.slice(0, -1)
    const alts = pan.alts!.slice(0, -1)
    const pts2d = ring.map(([lng, lat]) => {
      const [e, n] = toLocalMeters(lng, lat, lng0, lat0)
      return new Vector2(e, n)
    })
    const ys = alts.map((a) => wallM + a)
    return {
      pts2d,
      ys,
      plane: fitPlane(pts2d.map((p, v) => [p.x, p.y, ys[v]])),
      color: new Color(PAN_COLORS[i % PAN_COLORS.length]),
    }
  })

  // Arêtes : partagées à altitude égale = faîtage (rien à faire) ; partagées à
  // altitudes distinctes = MARCHE (face verticale) ; uniques = bord extérieur
  // (bandeau de rive).
  const edgeUse = new Map<string, { y1: number; y2: number }[]>()
  for (const lp of locals) {
    const n = lp.pts2d.length
    for (let v = 0; v < n; v++) {
      const a = lp.pts2d[v]
      const b = lp.pts2d[(v + 1) % n]
      const k = eKeyOf(a.x, a.y, b.x, b.y)
      const list = edgeUse.get(k) ?? []
      // ordonné par clé canonique pour comparer les deux côtés sommet à sommet
      const swap = vKey(a.x, a.y) > vKey(b.x, b.y)
      list.push({ y1: swap ? lp.ys[(v + 1) % n] : lp.ys[v], y2: swap ? lp.ys[v] : lp.ys[(v + 1) % n] })
      edgeUse.set(k, list)
    }
  }

  const solid = new Group()
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)

  for (const lp of locals) {
    const n = lp.pts2d.length
    const tris = ShapeUtils.triangulateShape(lp.pts2d, [])
    if (!tris.length) continue
    const positions = new Float32Array(n * 3)
    const centroid = new Vector3()
    for (let v = 0; v < n; v++) {
      const p3 = new Vector3(lp.pts2d[v].x, lp.ys[v], -lp.pts2d[v].y)
      positions[v * 3] = p3.x
      positions[v * 3 + 1] = p3.y
      positions[v * 3 + 2] = p3.z
      centroid.add(p3)
      min.min(p3)
      max.max(p3)
    }
    centroid.multiplyScalar(1 / n)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setIndex(tris.flat())
    geo.computeVertexNormals()
    const mat = new MeshLambertMaterial({ color: lp.color, side: DoubleSide })
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = true
    solid.add(mesh)

    const edgeMat = new LineBasicMaterial({ color: lp.color.clone().multiplyScalar(0.55) })
    const edgeGeo = new BufferGeometry()
    const edgePos = new Float32Array(positions)
    for (let v = 0; v < n; v++) edgePos[v * 3 + 1] += 0.05
    edgeGeo.setAttribute('position', new BufferAttribute(edgePos, 3))
    solid.add(new LineLoop(edgeGeo, edgeMat))
    disposables.push(geo, mat, edgeGeo, edgeMat)

    // Pastille « XX m² » ancrée au centroïde du pan (projetée chaque frame).
    const el = document.createElement('div')
    el.className = 'pan-chip tnum roof3d-chip'
    el.textContent = `${drawable[locals.indexOf(lp)].m2} m²`
    el.style.borderColor = `#${lp.color.getHexString()}`
    container.appendChild(el)
    chips.push({ el, at: centroid.clone().add(new Vector3(0, 0.4, 0)) })
  }

  // Bandeau de rive (bords extérieurs) + faces de marche (bords partagés à
  // altitudes distinctes).
  const fasciaPos: number[] = []
  const stepPos: number[] = []
  for (const lp of locals) {
    const n = lp.pts2d.length
    for (let v = 0; v < n; v++) {
      const a = lp.pts2d[v]
      const b = lp.pts2d[(v + 1) % n]
      const ya = lp.ys[v]
      const yb = lp.ys[(v + 1) % n]
      const uses = edgeUse.get(eKeyOf(a.x, a.y, b.x, b.y)) ?? []
      if (uses.length === 1) {
        // bord extérieur : bandeau vertical sous le débord
        fasciaPos.push(a.x, ya - FASCIA_H, -a.y, b.x, yb - FASCIA_H, -b.y, b.x, yb, -b.y)
        fasciaPos.push(a.x, ya - FASCIA_H, -a.y, b.x, yb, -b.y, a.x, ya, -a.y)
      } else if (uses.length === 2) {
        // marche : ne dessiner qu'une fois, du côté le plus HAUT
        const other = uses.find((u) => Math.abs(u.y1 - (vKey(a.x, a.y) > vKey(b.x, b.y) ? yb : ya)) > 1e-6 || Math.abs(u.y2 - (vKey(a.x, a.y) > vKey(b.x, b.y) ? ya : yb)) > 1e-6)
        if (!other) continue
        const swap = vKey(a.x, a.y) > vKey(b.x, b.y)
        const oa = swap ? other.y2 : other.y1
        const ob = swap ? other.y1 : other.y2
        const gapA = ya - oa
        const gapB = yb - ob
        if (Math.max(Math.abs(gapA), Math.abs(gapB)) < 0.12) continue // soudé
        if (gapA + gapB <= 0) continue // l'autre pan est plus haut : il s'en charge
        stepPos.push(a.x, oa, -a.y, b.x, ob, -b.y, b.x, yb, -b.y)
        stepPos.push(a.x, oa, -a.y, b.x, yb, -b.y, a.x, ya, -a.y)
      }
    }
  }
  if (fasciaPos.length) {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(fasciaPos), 3))
    g.computeVertexNormals()
    const m = new MeshLambertMaterial({ color: FASCIA_COLOR, side: DoubleSide })
    solid.add(new Mesh(g, m))
    disposables.push(g, m)
  }
  if (stepPos.length) {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(stepPos), 3))
    g.computeVertexNormals()
    const m = new MeshLambertMaterial({ color: WALL_COLOR, side: DoubleSide })
    const mesh = new Mesh(g, m)
    mesh.castShadow = true
    solid.add(mesh)
    disposables.push(g, m)
  }

  // Murs : extrusion de l'EMPRISE BD TOPO (droite par définition), hauteur
  // échantillonnée sur le plan du pan qui couvre chaque point — les pignons
  // montent tout seuls, le toit déborde et projette son ombre sur le mur.
  if (roof.emprise && roof.emprise.length >= 4) {
    const ring = roof.emprise.map(([lng, lat]) => toLocalMeters(lng, lat, lng0, lat0))
    let cx = 0
    let cy = 0
    for (const [x, y] of ring.slice(0, -1)) {
      cx += x
      cy += y
    }
    cx /= ring.length - 1
    cy /= ring.length - 1
    const roofYAt = (x: number, y: number): number => {
      // léger recul vers l'intérieur : les points d'angle tombent DANS un pan
      const ix = x + (cx - x) * 0.02
      const iy = y + (cy - y) * 0.02
      for (const lp of locals) {
        if (pointInPoly(ix, iy, lp.pts2d.map((p) => [p.x, p.y] as [number, number]))) {
          return lp.plane[0] * ix + lp.plane[1] * iy + lp.plane[2]
        }
      }
      return wallM
    }
    const wallPos: number[] = []
    for (let s = 0; s < ring.length - 1; s++) {
      const [x1, y1] = ring[s]
      const [x2, y2] = ring[s + 1]
      const len = Math.hypot(x2 - x1, y2 - y1)
      const steps = Math.max(1, Math.ceil(len / WALL_SAMPLE_M))
      for (let k = 0; k < steps; k++) {
        const u0 = k / steps
        const u1 = (k + 1) / steps
        const ax = x1 + (x2 - x1) * u0
        const ay = y1 + (y2 - y1) * u0
        const bx = x1 + (x2 - x1) * u1
        const by = y1 + (y2 - y1) * u1
        const ta = Math.max(0.3, roofYAt(ax, ay) - 0.03)
        const tb = Math.max(0.3, roofYAt(bx, by) - 0.03)
        wallPos.push(ax, 0, -ay, bx, 0, -by, bx, tb, -by)
        wallPos.push(ax, 0, -ay, bx, tb, -by, ax, ta, -ay)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(wallPos), 3))
    g.computeVertexNormals()
    const m = new MeshLambertMaterial({ color: WALL_COLOR, side: DoubleSide })
    const walls = new Mesh(g, m)
    walls.castShadow = true
    walls.receiveShadow = true
    solid.add(walls)
    disposables.push(g, m)
  }
  scene.add(solid)

  const centre = min.clone().add(max).multiplyScalar(0.5)
  const span = Math.max(max.x - min.x, max.z - min.z, 6)

  // Sol : plan qui ne fait QUE recevoir l'ombre (le fond papier reste visible).
  const groundGeo = new PlaneGeometry(span * 6, span * 6)
  const groundMat = new ShadowMaterial({ opacity: 0.15 })
  const ground = new Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(centre.x, 0, centre.z)
  ground.receiveShadow = true
  scene.add(ground)
  disposables.push(groundGeo, groundMat)

  // Lumière : hémisphère ciel/sol (les faces à l'ombre restent claires et
  // chaudes — maquette, pas bunker) + soleil chaud du sud-ouest.
  scene.add(new HemisphereLight(0xffffff, 0xd8cfc2, 1.05))
  const sun = new DirectionalLight(0xfff2dc, 1.35)
  sun.position.set(centre.x - span * 0.8, span * 2.2, centre.z + span * 1.2)
  sun.target.position.copy(centre)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const cam = sun.shadow.camera
  cam.left = -span * 1.6
  cam.right = span * 1.6
  cam.top = span * 1.6
  cam.bottom = -span * 1.6
  cam.far = span * 8
  scene.add(sun)
  scene.add(sun.target)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  const camera = new PerspectiveCamera(
    38,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    span * 60,
  )
  const target = new Vector3(centre.x, Math.max((wallM + centre.y) * 0.45, 1.2), centre.z)
  const dist = span * 1.5

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(target)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = span * 0.6
  controls.maxDistance = span * 4
  controls.minPolarAngle = 0.15
  controls.maxPolarAngle = 1.5 // on ne passe pas sous le sol
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.8
  controls.addEventListener('start', () => {
    controls.autoRotate = false
  })

  // Boussole nord (coin du canvas), orientée avec la caméra.
  const compass = document.createElement('div')
  compass.className = 'roof3d-compass'
  compass.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5 L11 11 L8 8.8 L5 11 Z" fill="currentColor"/></svg><span>N</span>'
  container.appendChild(compass)
  const needle = compass.querySelector('svg') as SVGElement

  // Entrée en douceur : la caméra descend d'un survol lointain vers l'angle
  // trois-quarts (ease-out ~0,9 s), puis l'autorotation prend le relais.
  const AZ0 = Math.PI / 4
  let t0: number | null = null
  const place = (k: number) => {
    const d = dist * (1.7 - 0.7 * k)
    const polar = 1.05 - 0.15 * (1 - k)
    camera.position.set(
      target.x + d * Math.sin(polar) * Math.sin(AZ0),
      target.y + d * Math.cos(polar),
      target.z + d * Math.sin(polar) * Math.cos(AZ0),
    )
    camera.lookAt(target)
  }
  place(0)

  let raf = 0
  const loop = (now: number) => {
    if (t0 === null) t0 = now
    const k = Math.min(1, (now - t0) / 900)
    if (k < 1) {
      place(1 - (1 - k) ** 3)
    } else {
      controls.update()
    }
    const w = container.clientWidth
    const h = container.clientHeight
    for (const { el, at } of chips) {
      const p = at.clone().project(camera)
      if (p.z > 1) {
        el.style.display = 'none'
        continue
      }
      el.style.display = ''
      el.style.left = `${((p.x + 1) / 2) * w}px`
      el.style.top = `${((1 - p.y) / 2) * h}px`
    }
    needle.style.transform = `rotate(${(controls.getAzimuthalAngle() * 180) / Math.PI}deg)`
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  const resize = new ResizeObserver(() => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resize.observe(container)

  return {
    dispose() {
      cancelAnimationFrame(raf)
      resize.disconnect()
      controls.dispose()
      for (const { el } of chips) el.remove()
      compass.remove()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
