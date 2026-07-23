// -----------------------------------------------------------------------------
// Maquette 3D du toit mesuré (fiche maison) — chunk séparé chargé au tap
// (three.js ~170 Ko gz, jamais dans le bundle principal, pattern data/lidar.ts).
//
// Entrée : RoofData (pans jointifs v7 : contour lng/lat + altitude par sommet,
// hauteur de gouttière BD TOPO). Rendu « maquette d'architecte » :
//   - pans colorés (palette partagée avec l'ortho) aux arêtes nettes ;
//   - murs plâtre jusqu'au sol sous les arêtes EXTÉRIEURES (les frontières
//     entre pans étant partagées à l'identique, on les détecte par comptage) ;
//   - ombre portée douce au sol, lumière chaude ;
//   - entrée en douceur + lente autorotation, stoppée au premier toucher ;
//   - pastilles « XX m² » projetées SUR les pans + boussole nord (DOM).
// -----------------------------------------------------------------------------
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
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

const WALL_COLOR = 0xeae7e0 // plâtre chaud (ancienne teinte des bâtiments 3D)
const DEFAULT_WALL_M = 2.4 // hauteur de gouttière si la BD TOPO ne la donne pas

// Mètres locaux depuis lng/lat autour d'une origine (échelle bâtiment : une
// équirectangulaire locale suffit largement).
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

const vKey = (v: [number, number]) => `${v[0].toFixed(6)},${v[1].toFixed(6)}`
const eKey = (a: [number, number], b: [number, number]) => {
  const ka = vKey(a)
  const kb = vKey(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
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

  // Arêtes partagées entre deux pans = arêtes INTÉRIEURES (faîtages, arêtiers,
  // noues) : pas de mur dessous. Les autres = gouttières et rives -> murs.
  const edgeCount = new Map<string, number>()
  for (const p of drawable) {
    const ring = p.contour!
    for (let i = 0; i < ring.length - 1; i++) {
      const k = eKey(ring[i], ring[i + 1])
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
    }
  }

  // three : x = est, y = altitude, z = -nord (y vers le haut). Sol à y = 0,
  // gouttière la plus basse à y = wallM (les alts stockées sont relatives).
  const solid = new Group()
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  const wallPositions: number[] = []

  for (const [i, pan] of drawable.entries()) {
    const ring = pan.contour!.slice(0, -1)
    const alts = pan.alts!.slice(0, -1)
    const pts2d = ring.map(([lng, lat]) => {
      const [e, n] = toLocalMeters(lng, lat, lng0, lat0)
      return new Vector2(e, n)
    })
    const tris = ShapeUtils.triangulateShape(pts2d, [])
    if (!tris.length) continue

    const positions = new Float32Array(ring.length * 3)
    const centroid = new Vector3()
    for (let v = 0; v < ring.length; v++) {
      const p3 = new Vector3(pts2d[v].x, wallM + alts[v], -pts2d[v].y)
      positions[v * 3] = p3.x
      positions[v * 3 + 1] = p3.y
      positions[v * 3 + 2] = p3.z
      centroid.add(p3)
      min.min(p3)
      max.max(p3)
    }
    centroid.multiplyScalar(1 / ring.length)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setIndex(tris.flat())
    geo.computeVertexNormals()

    const color = new Color(PAN_COLORS[i % PAN_COLORS.length])
    const mat = new MeshLambertMaterial({ color, side: DoubleSide })
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = true
    solid.add(mesh)

    // Arête du pan : même teinte assombrie, légèrement décollée (z-fighting).
    const edgeMat = new LineBasicMaterial({ color: color.clone().multiplyScalar(0.55) })
    const edgeGeo = new BufferGeometry()
    const edgePos = new Float32Array(positions)
    for (let v = 0; v < ring.length; v++) edgePos[v * 3 + 1] += 0.05
    edgeGeo.setAttribute('position', new BufferAttribute(edgePos, 3))
    solid.add(new LineLoop(edgeGeo, edgeMat))
    disposables.push(geo, mat, edgeGeo, edgeMat)

    // Murs sous les arêtes extérieures (gouttières, rives, pignons).
    const full = pan.contour!
    const fullAlts = pan.alts!
    for (let v = 0; v < full.length - 1; v++) {
      if ((edgeCount.get(eKey(full[v], full[v + 1])) ?? 0) !== 1) continue
      const [e1, n1] = toLocalMeters(full[v][0], full[v][1], lng0, lat0)
      const [e2, n2] = toLocalMeters(full[v + 1][0], full[v + 1][1], lng0, lat0)
      const y1 = wallM + fullAlts[v]
      const y2 = wallM + fullAlts[v + 1]
      // Deux triangles : (bas1, bas2, haut2) et (bas1, haut2, haut1).
      wallPositions.push(e1, 0, -n1, e2, 0, -n2, e2, y2, -n2)
      wallPositions.push(e1, 0, -n1, e2, y2, -n2, e1, y1, -n1)
    }

    // Pastille « XX m² » ancrée au centroïde du pan (projetée chaque frame).
    const el = document.createElement('div')
    el.className = 'pan-chip tnum roof3d-chip'
    el.textContent = `${pan.m2} m²`
    el.style.borderColor = PAN_COLORS[i % PAN_COLORS.length]
    container.appendChild(el)
    chips.push({ el, at: centroid.clone().add(new Vector3(0, 0.4, 0)) })
  }

  if (wallPositions.length) {
    const wallGeo = new BufferGeometry()
    wallGeo.setAttribute('position', new BufferAttribute(new Float32Array(wallPositions), 3))
    wallGeo.computeVertexNormals()
    const wallMat = new MeshLambertMaterial({ color: WALL_COLOR, side: DoubleSide })
    const walls = new Mesh(wallGeo, wallMat)
    walls.castShadow = true
    solid.add(walls)
    disposables.push(wallGeo, wallMat)
  }
  scene.add(solid)

  const centre = min.clone().add(max).multiplyScalar(0.5)
  const span = Math.max(max.x - min.x, max.z - min.z, 6)

  // Sol : plan qui ne fait QUE recevoir l'ombre (le fond papier reste visible).
  const groundGeo = new PlaneGeometry(span * 6, span * 6)
  const groundMat = new ShadowMaterial({ opacity: 0.16 })
  const ground = new Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(centre.x, 0, centre.z)
  ground.receiveShadow = true
  scene.add(ground)
  disposables.push(groundGeo, groundMat)

  // Lumière : ambiance douce + soleil chaud du sud-ouest (ombres portées).
  scene.add(new AmbientLight(0xffffff, 0.85))
  const sun = new DirectionalLight(0xfff4e0, 1.6)
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
  // Lente rotation de présentation, stoppée dès que le doigt prend la main.
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
  const AZ0 = Math.PI / 4 // départ : trois-quarts sud-est
  let t0: number | null = null
  const place = (k: number) => {
    // k : 0 -> 1 (fin d'animation)
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
      place(1 - (1 - k) ** 3) // ease-out cubic
    } else {
      controls.update()
    }
    // Pastilles m² : projection écran (masquées derrière la caméra).
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
    // Boussole : le nord du monde est -z ; l'azimut caméra donne sa rotation écran.
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
