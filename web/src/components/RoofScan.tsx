import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  getLidarProgress,
  lidarKey,
  subscribeLidarProgress,
  type LidarProgress,
} from '../data/lidar-progress'
import { PAN_COLORS } from '../domain/colors'

// Encre et lumière LITTÉRALES (posées sur la photo : jamais de tokens de
// thème, cf. DA — même règle que les pastilles m² et le viewer 3D).
const INK = '17, 17, 19'
const SHOW_AFTER_MS = 400 // une réponse du cache ne déclenche jamais le balayage
const PASS_MS = 1100 // un passage du faisceau (= icône de la fiche)
const TRAIL_M = 2.4 // traînée lumineuse derrière le faisceau
const PAD_M = 1.5 // le faisceau entre et sort un peu hors de l'emprise
const FLASH_MS = 380 // éclat d'un point à l'instant où le faisceau le touche
const FADE_MS = 300
const PAN_STAGGER_MS = 70 // final : un pan après l'autre
const PAN_WIPE_MS = 320
// Même rendu que le calque de pans de la carte (MapView) : la passation est
// invisible.
const PAN_FILL_ALPHA = 0.24
const PAN_LINE_W = 2.5

interface Props {
  map: maplibregl.Map | null
  /** Maison dont la mesure est suivie (fiche maison ou fiche point). */
  target: { lng: number; lat: number } | null
  /** Final en cours : la carte masque ses propres pans (et leurs
      pastilles) pendant que le balayage les matérialise. */
  onFinale?: (active: boolean) => void
}

/** Repère local en mètres, calé sur l'axe du toit (arête la plus longue). */
interface Frame {
  lng0: number
  lat0: number
  kx: number
  ky: number
  /** Unitaire le long de l'arête la plus longue (le faîtage, en général). */
  ex: number
  ey: number
  /** Unitaire perpendiculaire : direction du balayage. */
  dx: number
  dy: number
  dMin: number
  dMax: number
  bMin: number
  bMax: number
}

function makeFrame(ring: [number, number][]): Frame {
  const [lng0, lat0] = ring[0]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110540
  const pts = ring.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky])
  let best = 0
  let ex = 1
  let ey = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const vx = pts[i + 1][0] - pts[i][0]
    const vy = pts[i + 1][1] - pts[i][1]
    const len = Math.hypot(vx, vy)
    if (len > best) {
      best = len
      ex = vx / len
      ey = vy / len
    }
  }
  const dx = -ey
  const dy = ex
  let dMin = Infinity
  let dMax = -Infinity
  let bMin = Infinity
  let bMax = -Infinity
  for (const [x, y] of pts) {
    const d = x * dx + y * dy
    const b = x * ex + y * ey
    dMin = Math.min(dMin, d)
    dMax = Math.max(dMax, d)
    bMin = Math.min(bMin, b)
    bMax = Math.max(bMax, b)
  }
  return { lng0, lat0, kx, ky, ex, ey, dx, dy, dMin, dMax, bMin, bMax }
}

/** Point du repère (b le long du toit, d en travers) -> lon/lat. */
function toLngLat(f: Frame, b: number, d: number): [number, number] {
  const x = b * f.ex + d * f.dx
  const y = b * f.ey + d * f.dy
  return [f.lng0 + x / f.kx, f.lat0 + y / f.ky]
}

const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/** Position du faisceau (0..1 sur la largeur balayée) à l'instant t (ms),
    aller-retour adouci ; `dir` = sens du mouvement. */
function beamAt(t: number): { s: number; dir: 1 | -1 } {
  const k = Math.floor(t / PASS_MS)
  const e = easeInOut((t % PASS_MS) / PASS_MS)
  return k % 2 === 0 ? { s: e, dir: 1 } : { s: 1 - e, dir: -1 }
}

/** Premier instant ≥ ta où le faisceau passe sur la position u (0..1). */
function revealTime(u: number, ta: number): number {
  const c = Math.min(1, Math.max(0, u))
  for (let k = Math.floor(ta / PASS_MS); k < Math.floor(ta / PASS_MS) + 3; k++) {
    const target = k % 2 === 0 ? c : 1 - c
    const f = Math.acos(1 - 2 * target) / Math.PI
    const tau = k * PASS_MS + f * PASS_MS
    if (tau >= ta) return tau
  }
  return ta
}

type Phase = 'idle' | 'wait' | 'scan' | 'finale' | 'fade'

/**
 * Balayage laser sur la photo pendant la mesure LiDAR (chantier design,
 * 24/09). Tout est RÉEL : l'emprise, les points (ceux que le serveur IGN
 * vient d'envoyer), leur hauteur, les pans.
 *  - l'emprise s'assombrit ; un faisceau la balaie dans l'axe du toit, en
 *    allers-retours adoucis, avec une traînée ;
 *  - chaque point reçu s'allume AU PASSAGE du faisceau (éclat bref), puis se
 *    stabilise à une luminosité qui dépend de sa HAUTEUR : gouttières
 *    sombres, faîtage lumineux — le relief du toit se dessine avant le
 *    résultat ;
 *  - final : les pans se remplissent de leur couleur un par un (balayage
 *    dans le même axe), les points s'éteignent, puis la carte reprend la
 *    main avec ses propres pans (rendu identique).
 * Mouvement réduit : ni faisceau ni éclat, points et pans en fondu.
 * Un seul canvas, animé seulement pendant une mesure ; les projections
 * écran sont recalculées seulement si la caméra bouge.
 */
export function RoofScan({ map, target, onFinale }: Props) {
  const onFinaleRef = useRef(onFinale)
  onFinaleRef.current = onFinale
  const key = target ? lidarKey(target.lng, target.lat) : null

  useEffect(() => {
    if (!map || !key) return
    const container = map.getContainer()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let canvas: HTMLCanvasElement | null = null
    let ctx: CanvasRenderingContext2D | null = null
    let raf = 0
    let phase: Phase = 'idle'
    let t0 = 0 // début de la mesure (horloge du faisceau)
    let phaseAt = 0
    let finaleOn = false
    let frame: Frame | null = null
    let frameFor: [number, number][] | null = null
    // Par lot : position de révélation + projection écran (mise en cache).
    const reveal = new WeakMap<Float64Array, Float32Array>()
    let zFor: LidarProgress['batches'] | null = null
    let zP5 = 0
    let zP95 = 1
    const screen = new WeakMap<Float64Array, { cam: string; xy: Float32Array }>()

    const setFinale = (on: boolean) => {
      if (finaleOn === on) return
      finaleOn = on
      onFinaleRef.current?.(on)
    }
    const ensureCanvas = () => {
      if (canvas) return
      canvas = document.createElement('canvas')
      canvas.className = 'roof-scan-canvas'
      container.appendChild(canvas)
      ctx = canvas.getContext('2d')
    }
    const handOff = (c: HTMLCanvasElement | null) => {
      if (!c) return
      let done = false
      const fade = () => {
        if (done) return
        done = true
        c.style.transition = 'opacity 120ms ease-out'
        c.style.opacity = '0'
        setTimeout(() => c.remove(), 160)
      }
      map.once('render', () => requestAnimationFrame(fade))
      map.triggerRepaint()
      setTimeout(fade, 600) // filet : jamais de canvas orphelin
    }
    const dropCanvas = () => {
      canvas?.remove()
      canvas = null
      ctx = null
    }
    const running = (p: LidarProgress | null) =>
      p !== null && (p.stage === 'batiment' || p.stage === 'nuage' || p.stage === 'pans')

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      raf = 0
      const p = getLidarProgress(key)
      // Machine à états.
      if (phase === 'idle') {
        if (!running(p)) return
        phase = 'wait'
        t0 = now
      }
      if (phase === 'wait') {
        if (!running(p)) {
          phase = 'idle' // réponse rapide (cache) : aucun spectacle
          return
        }
        if (now - t0 < SHOW_AFTER_MS) {
          kick()
          return
        }
        phase = 'scan'
        phaseAt = now
      }
      if (phase === 'scan' && !running(p)) {
        phase = p?.stage === 'fini' && p.pans?.length ? 'finale' : 'fade'
        phaseAt = now
        if (phase === 'finale') setFinale(true)
      }
      if (!p?.emprise) {
        if (phase === 'scan') kick()
        else {
          phase = 'idle'
          dropCanvas()
          setFinale(false)
        }
        return
      }
      if (frameFor !== p.emprise) {
        frame = makeFrame(p.emprise)
        frameFor = p.emprise
      }
      const f = frame!
      ensureCanvas()
      const c = canvas!
      const g = ctx!
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const w = container.clientWidth
      const h = container.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      const cc = map.getCenter()
      const cam = `${cc.lng},${cc.lat},${map.getZoom()},${map.getBearing()},${map.getPitch()},${w},${h}`
      const proj = (ll: [number, number]) => map.project(ll)

      // Opacités de phase.
      const since = now - phaseAt
      const appear = phase === 'scan' ? Math.min(1, since / 240) : 1
      const finaleDur =
        phase === 'finale' ? ((p.pans?.length ?? 1) - 1) * PAN_STAGGER_MS + PAN_WIPE_MS + 80 : 0
      const outK =
        phase === 'fade'
          ? 1 - Math.min(1, since / FADE_MS)
          : phase === 'finale'
            ? 1 - Math.min(1, since / FADE_MS)
            : 1
      const veil = appear * outK

      const ring = p.emprise.map((ll) => proj(ll))
      const path = () => {
        g.beginPath()
        ring.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)))
        g.closePath()
      }
      const span = f.dMax - f.dMin + 2 * PAD_M
      const tBeam = now - t0

      g.save()
      path()
      g.fillStyle = `rgba(${INK}, ${0.36 * veil})`
      g.fill()
      g.clip()

      // Points : relief par la hauteur, révélés au passage du faisceau.
      // Plage de hauteur sur les percentiles 5-95 % (une cheminée ou une
      // antenne écraseraient la rampe).
      if (zFor !== p.batches) {
        const zs: number[] = []
        for (const b of p.batches) for (let i = 2; i < b.coords.length; i += 3) zs.push(b.coords[i])
        zs.sort((a, b) => a - b)
        zP5 = zs.length ? zs[Math.floor(zs.length * 0.05)] : 0
        zP95 = zs.length ? zs[Math.floor(zs.length * 0.95)] : 1
        zFor = p.batches
      }
      const zLo = zP5
      const zRange = Math.max(0.5, zP95 - zP5)
      g.fillStyle = '#ffffff'
      for (const b of p.batches) {
        const co = b.coords
        const n = co.length / 3
        let rv = reveal.get(co)
        if (!rv) {
          rv = new Float32Array(n)
          const ta = b.t - t0
          for (let i = 0; i < n; i++) {
            const x = (co[i * 3] - f.lng0) * f.kx
            const y = (co[i * 3 + 1] - f.lat0) * f.ky
            const u = (x * f.dx + y * f.dy - (f.dMin - PAD_M)) / span
            rv[i] = reduce ? ta : revealTime(u, ta)
          }
          reveal.set(co, rv)
        }
        let sc = screen.get(co)
        if (!sc || sc.cam !== cam) {
          const xy = new Float32Array(n * 2)
          for (let i = 0; i < n; i++) {
            const q = proj([co[i * 3], co[i * 3 + 1]])
            xy[i * 2] = q.x
            xy[i * 2 + 1] = q.y
          }
          sc = { cam, xy }
          screen.set(co, sc)
        }
        for (let i = 0; i < n; i++) {
          const age = tBeam - rv[i]
          if (age < 0) continue
          const hT = Math.min(1, Math.max(0, (co[i * 3 + 2] - zLo) / zRange))
          // Rampe contrastée : gouttières à peine visibles, faîtage éclatant.
          const base = 0.1 + 0.9 * hT * hT
          const flash = reduce ? 0 : Math.max(0, 1 - age / FLASH_MS)
          const a = (reduce ? Math.min(1, age / FLASH_MS) * base : base + (1 - base) * flash) * veil
          if (a <= 0.01) continue
          const r = 1 + 0.5 * hT + 1.2 * flash
          g.globalAlpha = a
          g.fillRect(sc.xy[i * 2] - r / 2, sc.xy[i * 2 + 1] - r / 2, r, r)
        }
      }
      g.globalAlpha = 1

      // Faisceau : dans l'axe du toit, allers-retours, traînée derrière.
      if (!reduce && phase === 'scan' && p.stage !== 'pans') {
        const { s, dir } = beamAt(tBeam)
        const d = f.dMin - PAD_M + s * span
        const dTail = d - dir * TRAIL_M
        const b0 = f.bMin - 6
        const b1 = f.bMax + 6
        const A = proj(toLngLat(f, b0, d))
        const B = proj(toLngLat(f, b1, d))
        const C = proj(toLngLat(f, b1, dTail))
        const D = proj(toLngLat(f, b0, dTail))
        const mHead = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        const mTail = { x: (C.x + D.x) / 2, y: (C.y + D.y) / 2 }
        const grad = g.createLinearGradient(mTail.x, mTail.y, mHead.x, mHead.y)
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
        grad.addColorStop(1, `rgba(255, 255, 255, ${0.3 * veil})`)
        g.fillStyle = grad
        g.beginPath()
        g.moveTo(A.x, A.y)
        g.lineTo(B.x, B.y)
        g.lineTo(C.x, C.y)
        g.lineTo(D.x, D.y)
        g.closePath()
        g.fill()
        g.strokeStyle = `rgba(255, 255, 255, ${0.95 * veil})`
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(A.x, A.y)
        g.lineTo(B.x, B.y)
        g.stroke()
      }
      g.restore()

      // Contour de l'emprise (s'efface au final, les pans prennent le relais).
      path()
      g.lineWidth = 1.5
      g.strokeStyle = `rgba(255, 255, 255, ${0.9 * veil})`
      g.shadowColor = `rgba(${INK}, ${0.5 * veil})`
      g.shadowBlur = 4
      g.stroke()
      g.shadowBlur = 0

      // Final : matérialisation des pans, un par un, dans l'axe du balayage.
      if (phase === 'finale' && p.pans) {
        p.pans.forEach((pan, k) => {
          const local = since - k * PAN_STAGGER_MS
          if (local <= 0) return
          const tw = Math.min(1, local / PAN_WIPE_MS)
          const color = PAN_COLORS[pan.idx % PAN_COLORS.length]
          const pr = pan.contour.map((ll) => proj(ll))
          g.save()
          if (reduce) {
            g.globalAlpha = tw
          } else {
            // Demi-plan révélé : de dMin jusqu'au front du balayage.
            const front = f.dMin - PAD_M + easeOut(tw) * span
            const P = [
              proj(toLngLat(f, f.bMin - 6, f.dMin - PAD_M - 1)),
              proj(toLngLat(f, f.bMax + 6, f.dMin - PAD_M - 1)),
              proj(toLngLat(f, f.bMax + 6, front)),
              proj(toLngLat(f, f.bMin - 6, front)),
            ]
            g.beginPath()
            P.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)))
            g.closePath()
            g.clip()
          }
          g.beginPath()
          pr.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)))
          g.closePath()
          g.globalAlpha *= PAN_FILL_ALPHA
          g.fillStyle = color
          g.fill()
          g.globalAlpha = reduce ? tw : 1
          g.lineWidth = PAN_LINE_W
          g.strokeStyle = color
          g.lineJoin = 'round'
          g.stroke()
          g.restore()
        })
        if (since >= finaleDur) {
          // Passation en deux temps : le calque de la carte (rendu
          // identique) réapparaît d'abord ; le canvas ne s'efface qu'APRÈS
          // le prochain rendu effectif de la carte — sinon, fil principal
          // chargé (fiche, calque, cache), une image vide passait entre les
          // deux (vu image par image sur les planches).
          phase = 'idle'
          const handed = canvas
          canvas = null
          ctx = null
          setFinale(false)
          handOff(handed)
          return
        }
      }
      if (phase === 'fade' && since >= FADE_MS) {
        phase = 'idle'
        dropCanvas()
        return
      }
      kick()
    }

    const unsub = subscribeLidarProgress(key, kick)
    kick()
    return () => {
      unsub()
      cancelAnimationFrame(raf)
      raf = 0
      dropCanvas()
      setFinale(false)
    }
  }, [map, key])

  return null
}
