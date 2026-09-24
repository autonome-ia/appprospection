// -----------------------------------------------------------------------------
// Avancement RÉEL d'une mesure LiDAR (chantier design, 24/09/2026) : la fiche
// (carte de progression) et la carte (balayage laser sur la photo) montrent
// ce que la mesure fait vraiment — emprise trouvée, points laser qui
// arrivent, pans détectés — au lieu d'une pastille « mesure du toit… ».
// Module LÉGER (aucune dépendance) : les fiches s'y abonnent sans charger le
// chunk LiDAR ; data/lidar.ts y publie.
// -----------------------------------------------------------------------------

export type LidarStage =
  /** Bâtiment identifié (emprise connue), recherche en cache / dalles. */
  | 'batiment'
  /** Lecture du nuage laser (points qui arrivent par nœuds). */
  | 'nuage'
  /** Points collectés : détection des pans et calcul de la surface. */
  | 'pans'
  /** Terminé (quel que soit le verdict). */
  | 'fini'
  /** Réponse immédiate depuis le cache : rien à montrer. */
  | 'cache'
  /** Échec réseau. */
  | 'erreur'

export interface LidarProgress {
  stage: LidarStage
  /** Emprise du bâtiment (lon/lat), dès l'étape « batiment ». */
  emprise: [number, number][] | null
  /** Points « bâtiment » reçus jusqu'ici. */
  points: number
  /** Nœuds du nuage lus / à lire : la barre de progression est RÉELLE. */
  nodesDone: number
  nodesTotal: number
  /** Échantillon des points reçus, pour la carte : lon, lat, altitude à plat
      (pas de 3), par lot (`t` = arrivée). Plafonné. */
  batches: { t: number; coords: Float64Array }[]
  /** Altitudes extrêmes reçues (m) : la carte éclaire les points selon leur
      hauteur (gouttière sombre, faîtage lumineux) — le relief du toit
      apparaît avant le résultat. */
  zLo: number
  zHi: number
  /** Date de fin du survol laser de la dalle (ISO), dès qu'elle est connue. */
  millesime: string | null
  /** Pans détectés (avant la reconstruction finale). */
  pansCount: number | null
  /** Pans dessinables du résultat (même filtre que la carte : contour et
      ≥ 10 m²), index d'origine = couleur : le final les « matérialise ». */
  pans: { contour: [number, number][]; idx: number }[] | null
  startedAt: number
}

export const MAX_SAMPLE_POINTS = 6000

type Listener = (p: LidarProgress | null) => void

const state = new Map<string, LidarProgress>()
const listeners = new Map<string, Set<Listener>>()

/** Même clé que le cache par coordonnées de data/lidar.ts (~1 m). */
export const lidarKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`

export function getLidarProgress(key: string): LidarProgress | null {
  return state.get(key) ?? null
}

export function subscribeLidarProgress(key: string, fn: Listener): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (!set!.size) listeners.delete(key)
  }
}

function emit(key: string) {
  const p = state.get(key) ?? null
  for (const fn of listeners.get(key) ?? []) fn(p)
}

/** Publication (data/lidar.ts). Les objets sont remplacés, jamais mutés :
    React voit chaque étape. */
export function publishLidarProgress(key: string, patch: Partial<LidarProgress>): void {
  const prev = state.get(key)
  const base: LidarProgress = prev ?? {
    stage: 'batiment',
    emprise: null,
    points: 0,
    nodesDone: 0,
    nodesTotal: 0,
    batches: [],
    zLo: Infinity,
    zHi: -Infinity,
    millesime: null,
    pansCount: null,
    pans: null,
    startedAt: Date.now(),
  }
  state.set(key, { ...base, ...patch })
  emit(key)
}

/** Ajoute un lot de points (lon, lat, z) à l'échantillon (plafonné) et au
    compteur. */
export function publishLidarPoints(key: string, count: number, coords: Float64Array): void {
  const prev = state.get(key)
  if (!prev) return
  const shown = prev.batches.reduce((s, b) => s + b.coords.length / 3, 0)
  const room = Math.max(0, MAX_SAMPLE_POINTS - shown)
  const batch = coords.length / 3 > room ? coords.slice(0, room * 3) : coords
  let zLo = prev.zLo
  let zHi = prev.zHi
  for (let i = 2; i < batch.length; i += 3) {
    if (batch[i] < zLo) zLo = batch[i]
    if (batch[i] > zHi) zHi = batch[i]
  }
  state.set(key, {
    ...prev,
    points: prev.points + count,
    nodesDone: prev.nodesDone + 1,
    zLo,
    zHi,
    batches: batch.length ? [...prev.batches, { t: performance.now(), coords: batch }] : prev.batches,
  })
  emit(key)
}

/** Nouvelle mesure pour cette clé : repart de zéro. */
export function resetLidarProgress(key: string): void {
  state.delete(key)
  emit(key)
}
