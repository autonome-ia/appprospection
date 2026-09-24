import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { useLidarProgress } from './RoofProgress'
import type { LidarProgress } from '../data/lidar-progress'

// Encre et lumière LITTÉRALES (posées sur la photo : jamais de tokens de
// thème, cf. DA — même règle que les pastilles m² et le viewer 3D).
const INK = '17, 17, 19'
const LIGHT = '255, 255, 255'
const SWEEP_MS = 1500 // un aller du faisceau sur la maison
const FADE_IN_MS = 380 // apparition d'un lot de points
const FADE_OUT_MS = 420 // fin : le calque s'efface et révèle les pans colorés
const SHOW_AFTER_MS = 400 // une réponse du cache ne déclenche jamais le balayage

interface Props {
  map: maplibregl.Map | null
  /** Maison dont la mesure est suivie (fiche maison ou fiche point). */
  target: { lng: number; lat: number } | null
}

/**
 * Balayage laser sur la photo pendant la mesure LiDAR (chantier design,
 * 24/09) : l'emprise de la maison s'assombrit légèrement, un faisceau la
 * parcourt et les VRAIS points laser s'y posent à mesure qu'ils arrivent du
 * serveur IGN. À la fin, le calque s'efface sur les pans colorés que la carte
 * dessine déjà. Mouvement réduit : pas de faisceau, les points apparaissent
 * en fondu. Un seul canvas, redessiné à chaque image tant que la mesure
 * court (suit la carte si elle bouge) ; rien du tout le reste du temps.
 */
export function RoofScan({ map, target }: Props) {
  const progress = useLidarProgress(target?.lng ?? null, target?.lat ?? null)
  const progressRef = useRef<LidarProgress | null>(progress)
  progressRef.current = progress

  const running =
    progress !== null &&
    (progress.stage === 'batiment' || progress.stage === 'nuage' || progress.stage === 'pans')

  useEffect(() => {
    if (!map || !running) return
    const container = map.getContainer()
    const canvas = document.createElement('canvas')
    canvas.className = 'roof-scan-canvas'
    container.appendChild(canvas)
    const ctx = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    let endAt: number | null = null
    let raf = 0

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const w = container.clientWidth
      const h = container.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return { w, h, dpr }
    }

    const frame = (now: number) => {
      const p = progressRef.current
      const { w, h, dpr } = size()
      ctx.clearRect(0, 0, w, h)
      const stillRunning =
        p !== null && (p.stage === 'batiment' || p.stage === 'nuage' || p.stage === 'pans')
      if (!stillRunning && endAt === null) endAt = now
      // Délai d'apparition : un cache-miss rapide ne montre rien.
      const since = now - t0
      if (since < SHOW_AFTER_MS && stillRunning) {
        raf = requestAnimationFrame(frame)
        return
      }
      const appear = Math.min(1, (since - SHOW_AFTER_MS) / 240)
      const vanish = endAt === null ? 1 : 1 - Math.min(1, (now - endAt) / FADE_OUT_MS)
      if (vanish <= 0 || p?.stage === 'cache' || !p?.emprise) {
        if (vanish <= 0 || endAt !== null) {
          canvas.remove()
          return
        }
        raf = requestAnimationFrame(frame)
        return
      }
      const alpha = appear * vanish
      const ring = p.emprise.map(([lng, lat]) => map.project([lng, lat]))
      let minY = Infinity
      let maxY = -Infinity
      for (const q of ring) {
        minY = Math.min(minY, q.y)
        maxY = Math.max(maxY, q.y)
      }

      ctx.save()
      ctx.beginPath()
      ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      ctx.closePath()
      // Voile d'encre sur le toit : les points clairs s'y détachent.
      ctx.fillStyle = `rgba(${INK}, ${0.32 * alpha})`
      ctx.fill()
      ctx.clip()

      // Points laser reçus (1 px physique arrondi ≈ 1,5 px CSS : du grain,
      // pas des pastilles).
      const r = 1.6
      for (const b of p.batches) {
        const a = Math.min(1, (now - b.t) / FADE_IN_MS) * alpha
        if (a <= 0) continue
        ctx.fillStyle = `rgba(${LIGHT}, ${0.85 * a})`
        const c = b.coords
        for (let i = 0; i < c.length; i += 2) {
          const q = map.project([c[i], c[i + 1]])
          ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r)
        }
      }

      // Faisceau : bande lumineuse qui balaie la maison de haut en bas.
      if (!reduce && p.stage !== 'pans' && endAt === null) {
        const phase = ((now - t0) % SWEEP_MS) / SWEEP_MS
        const eased = 0.5 - Math.cos(phase * Math.PI) / 2 // ease-in-out
        const pad = 14
        const y = minY - pad + (maxY - minY + 2 * pad) * eased
        const g = ctx.createLinearGradient(0, y - 22, 0, y + 2)
        g.addColorStop(0, `rgba(${LIGHT}, 0)`)
        g.addColorStop(0.85, `rgba(${LIGHT}, ${0.28 * alpha})`)
        g.addColorStop(1, `rgba(${LIGHT}, ${0.9 * alpha})`)
        ctx.fillStyle = g
        ctx.fillRect(0, y - 22, w, 24)
      }
      ctx.restore()

      // Contour net de l'emprise.
      ctx.beginPath()
      ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      ctx.closePath()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = `rgba(${LIGHT}, ${0.9 * alpha})`
      ctx.shadowColor = `rgba(${INK}, ${0.5 * alpha})`
      ctx.shadowBlur = 4 / dpr
      ctx.stroke()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      // Fin de mesure : on laisse le fondu de sortie se jouer seul.
      const fadeFrom = performance.now()
      const fade = (now: number) => {
        const k = 1 - (now - fadeFrom) / FADE_OUT_MS
        if (k <= 0 || !canvas.isConnected) {
          canvas.remove()
          return
        }
        canvas.style.opacity = String(k)
        requestAnimationFrame(fade)
      }
      requestAnimationFrame(fade)
    }
    // `running` ne dépend que de l'étape : la boucle lit la progression via
    // la ref, elle n'est pas relancée à chaque lot de points.
  }, [map, running])

  return null
}
