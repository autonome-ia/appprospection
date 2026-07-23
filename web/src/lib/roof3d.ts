// -----------------------------------------------------------------------------
// Maquette 3D du toit mesuré (fiche maison) — chunk séparé chargé au tap
// (three.js ~170 Ko gz, jamais dans le bundle principal, pattern data/lidar.ts).
// Entrée : les pans stockés en base (contour lng/lat + altitude par sommet,
// mesures v6+). Rendu : pans colorés (même palette que l'ortho) posés sur une
// grille discrète, rotation au doigt. Pas de murs ni d'ombres : une maquette
// du TOIT, lisible — pas une reconstitution de la maison.
// -----------------------------------------------------------------------------
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineLoop,
  MeshLambertMaterial,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShapeUtils,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LidarPan } from '../domain/house'
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

export function mountRoofScene(container: HTMLElement, pans: LidarPan[]): RoofSceneHandle {
  const drawable = pans.filter(isPan3D)

  const scene = new Scene()
  const disposables: { dispose(): void }[] = []

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

  // three : x = est, y = altitude, z = -nord (y vers le haut).
  const roof = new Group()
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)

  for (const [i, pan] of drawable.entries()) {
    // Contour fermé (premier = dernier) : on retire le doublon pour trianguler.
    const ring = pan.contour!.slice(0, -1)
    const alts = pan.alts!.slice(0, -1)
    const pts2d = ring.map(([lng, lat]) => {
      const [e, n] = toLocalMeters(lng, lat, lng0, lat0)
      return new Vector2(e, n)
    })
    const tris = ShapeUtils.triangulateShape(pts2d, [])
    if (!tris.length) continue

    const positions = new Float32Array(ring.length * 3)
    for (let v = 0; v < ring.length; v++) {
      positions[v * 3] = pts2d[v].x
      positions[v * 3 + 1] = alts[v]
      positions[v * 3 + 2] = -pts2d[v].y
      min.min(new Vector3(pts2d[v].x, alts[v], -pts2d[v].y))
      max.max(new Vector3(pts2d[v].x, alts[v], -pts2d[v].y))
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setIndex(tris.flat())
    geo.computeVertexNormals()

    const color = new Color(PAN_COLORS[i % PAN_COLORS.length])
    const mat = new MeshLambertMaterial({ color, side: DoubleSide })
    roof.add(new Mesh(geo, mat))

    // Arête du pan : même teinte, assombrie — lisible sans écraser l'aplat.
    const edgeMat = new LineBasicMaterial({ color: color.clone().multiplyScalar(0.55) })
    const edgeGeo = new BufferGeometry()
    // Léger décalage vertical pour passer devant la face (z-fighting).
    const edgePos = new Float32Array(positions)
    for (let v = 0; v < ring.length; v++) edgePos[v * 3 + 1] += 0.06
    edgeGeo.setAttribute('position', new BufferAttribute(edgePos, 3))
    roof.add(new LineLoop(edgeGeo, edgeMat))
    disposables.push(geo, mat, edgeGeo, edgeMat)
  }
  scene.add(roof)

  const centre = min.clone().add(max).multiplyScalar(0.5)
  const span = Math.max(max.x - min.x, max.z - min.z, 6)

  // Sol : grille discrète (tokens papier) sous la gouttière la plus basse.
  const grid = new GridHelper(span * 2.2, 14, 0xdcdcda, 0xececea)
  grid.position.set(centre.x, 0, centre.z)
  scene.add(grid)
  disposables.push(grid.geometry, grid.material as LineBasicMaterial)

  // Lumière douce + directionnelle : le relief des pans vient de là.
  scene.add(new AmbientLight(0xffffff, 0.75))
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.position.set(centre.x + span, span * 1.6, centre.z + span * 0.6)
  scene.add(sun)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const camera = new PerspectiveCamera(
    40,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    span * 40,
  )
  // Départ : trois-quarts sud-est, légèrement plongeant — l'angle « maquette ».
  const target = new Vector3(centre.x, Math.max(centre.y * 0.7, 0.8), centre.z)
  const dist = span * 1.55
  camera.position.set(centre.x + dist * 0.75, dist * 0.72, centre.z + dist * 0.75)
  camera.lookAt(target)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(target)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = span * 0.7
  controls.maxDistance = span * 4
  // On ne passe pas sous le sol, on ne monte pas au zénith parfait.
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.45

  let raf = 0
  const loop = () => {
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

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
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
