import proj4 from 'proj4'
import { supabase } from '../lib/supabase'

// -----------------------------------------------------------------------------
// Enrichissement "fiche maison" depuis l'open data (voir docs/etude-donnees-maisons.md)
//   * BD TOPO IGN (WFS Géoplateforme, sans clé) : matériau de toiture (code
//     fiscal dmatto), altitudes gouttière/faîtage + géométrie -> surface de toit.
//   * BDNB (CSTB, API open sans clé, ~10 000 req/mois) : année de construction,
//     classe DPE. Coordonnées en Lambert-93.
// Résultats mis en cache sur la ligne `points` : UN appel par maison, à la pose.
// -----------------------------------------------------------------------------

// Lambert-93 (EPSG:2154) — chaîne officielle IGN.
const L93 =
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

import type { HouseEnrichment } from '../domain/house'

// --- Géométrie (tout en Lambert-93 : les unités sont des mètres) --------------

function toL93(lng: number, lat: number): [number, number] {
  return proj4('WGS84', L93, [lng, lat]) as [number, number]
}

/** Aire (shoelace) et périmètre de l'anneau extérieur projeté en L93. */
function ringMetrics(ring: [number, number][]): { area: number; perimeter: number } {
  let area = 0
  let perimeter = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    area += x1 * y2 - x2 * y1
    perimeter += Math.hypot(x2 - x1, y2 - y1)
  }
  return { area: Math.abs(area) / 2, perimeter }
}

/**
 * Surface de toit estimée : emprise / cos(pente), avec la pente déduite de la
 * hauteur de comble (faîtage − gouttière) et de la demi-largeur du bâtiment
 * (largeur du rectangle équivalent de même aire/périmètre). Fallback : ×1,18.
 */
function roofSurface(
  ring: [number, number][],
  altMinToit: number | null,
  altMaxToit: number | null,
): number | null {
  const { area, perimeter } = ringMetrics(ring)
  if (!area || area < 8) return null // annexe minuscule : sans intérêt

  let factor = 1.18 // forfait pente ~32° si les altitudes manquent
  if (altMinToit != null && altMaxToit != null && altMaxToit > altMinToit) {
    const comble = altMaxToit - altMinToit
    // Largeur du rectangle équivalent : w + l = P/2 et w*l = A.
    const half = perimeter / 2
    const disc = half * half - 4 * area
    if (disc > 0) {
      const width = (half - Math.sqrt(disc)) / 2
      if (width > 2) {
        const pente = Math.atan(comble / (width / 2))
        const clamped = Math.min(Math.max(pente, (15 * Math.PI) / 180), (55 * Math.PI) / 180)
        factor = 1 / Math.cos(clamped)
      }
    }
  }
  return Math.round((area * factor) / 5) * 5 // arrondi à 5 m² (estimation assumée)
}

// --- BD TOPO (WFS Géoplateforme) ---------------------------------------------

interface BdTopoResult {
  mat_toit: string | null
  toit_surface_m2: number | null
}

async function fetchBdTopo(lng: number, lat: number): Promise<BdTopoResult> {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'BDTOPO_V3:batiment',
    COUNT: '1',
    outputFormat: 'application/json',
    // ⚠ ordre lat lng (axe nord d'abord) — vérifié sur l'API réelle.
    CQL_FILTER: `INTERSECTS(geometrie,POINT(${lat} ${lng}))`,
  })
  const r = await fetch(`https://data.geopf.fr/wfs/ows?${params.toString()}`)
  if (!r.ok) throw new Error(`WFS BD TOPO ${r.status}`)
  const j = (await r.json()) as {
    features?: {
      properties?: Record<string, unknown>
      geometry?: { type: string; coordinates: unknown }
    }[]
  }
  const f = j.features?.[0]
  if (!f) return { mat_toit: null, toit_surface_m2: null }

  const p = f.properties ?? {}
  const mat = typeof p.materiaux_de_la_toiture === 'string' ? p.materiaux_de_la_toiture : null

  // Anneau extérieur du (Multi)Polygon, projeté en L93 pour le calcul en mètres.
  let surface: number | null = null
  const g = f.geometry
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
    const outer = (
      g.type === 'Polygon'
        ? (g.coordinates as number[][][])[0]
        : (g.coordinates as number[][][][])[0]?.[0]
    ) as number[][] | undefined
    if (outer && outer.length >= 4) {
      const ring = outer.map(([x, y]) => toL93(x, y))
      surface = roofSurface(
        ring,
        typeof p.altitude_minimale_toit === 'number' ? p.altitude_minimale_toit : null,
        typeof p.altitude_maximale_toit === 'number' ? p.altitude_maximale_toit : null,
      )
    }
  }
  return { mat_toit: mat && mat.charAt(0) !== '0' ? mat : null, toit_surface_m2: surface }
}

// --- BDNB (année de construction + DPE) --------------------------------------

interface BdnbResult {
  annee_construction: number | null
  dpe_classe: string | null
}

async function fetchBdnb(lng: number, lat: number): Promise<BdnbResult> {
  const [x, y] = toL93(lng, lat)
  const params = new URLSearchParams({
    xmin: String(Math.round(x - 8)),
    ymin: String(Math.round(y - 8)),
    xmax: String(Math.round(x + 8)),
    ymax: String(Math.round(y + 8)),
    limit: '4',
  })
  const r = await fetch(
    `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox?${params.toString()}`,
  )
  if (!r.ok) throw new Error(`BDNB ${r.status}`)
  const j = (await r.json()) as Record<string, unknown>[] | { features?: unknown }
  const rows = Array.isArray(j) ? j : []
  const hit =
    rows.find((row) => typeof row.annee_construction === 'number') ??
    rows.find((row) => typeof row.classe_bilan_dpe === 'string') ??
    null
  return {
    annee_construction:
      hit && typeof hit.annee_construction === 'number' ? hit.annee_construction : null,
    dpe_classe: hit && typeof hit.classe_bilan_dpe === 'string' ? hit.classe_bilan_dpe : null,
  }
}

// --- Orchestration ------------------------------------------------------------

/**
 * Récupère les infos maison et les met en cache sur le point (best effort :
 * si la RLS refuse l'update — point d'un autre commercial — les données sont
 * quand même retournées pour affichage local).
 */
export async function enrichPoint(
  pointId: string,
  lng: number,
  lat: number,
): Promise<HouseEnrichment> {
  const [topo, bdnb] = await Promise.allSettled([fetchBdTopo(lng, lat), fetchBdnb(lng, lat)])
  const t = topo.status === 'fulfilled' ? topo.value : { mat_toit: null, toit_surface_m2: null }
  const b =
    bdnb.status === 'fulfilled' ? bdnb.value : { annee_construction: null, dpe_classe: null }
  if (topo.status === 'rejected') console.error('Enrichissement BD TOPO :', topo.reason)
  if (bdnb.status === 'rejected') console.error('Enrichissement BDNB :', bdnb.reason)

  const enrich: HouseEnrichment = {
    annee_construction: b.annee_construction,
    mat_toit: t.mat_toit,
    toit_surface_m2: t.toit_surface_m2,
    dpe_classe: b.dpe_classe,
  }

  if (supabase) {
    const { error } = await supabase
      .from('points')
      .update({ ...enrich, enriched_at: new Date().toISOString() })
      .eq('id', pointId)
    if (error) console.error('Cache enrichissement :', error.message)
  }
  return enrich
}
