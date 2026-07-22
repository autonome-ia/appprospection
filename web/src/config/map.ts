import type { RasterSourceSpecification } from 'maplibre-gl'

// -----------------------------------------------------------------------------
// Configuration carte — MapLibre + données IGN (Géoplateforme), sans clé API.
// Fond « Plan IGN » VECTORIEL (net, fluide, moderne) + couche ortho-photo raster
// (BD ORTHO) pour voir les toits. Référence : docs/etude-cartographie.md
// -----------------------------------------------------------------------------

/**
 * Style vectoriel officiel du Plan IGN (licence ouverte, MapLibre-compatible).
 * Sert de fond de carte de base ("mode plan").
 */
export const PLAN_IGN_STYLE_URL =
  'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json'

const IGN_WMTS = 'https://data.geopf.fr/wmts'
const IGN_ATTRIBUTION = '© <a href="https://www.ign.fr/">IGN</a> / Géoplateforme'

/** Construit une URL de tuiles XYZ depuis le WMTS IGN (TILEMATRIX=z, TILEROW=y, TILECOL=x). */
function ignTiles(layer: string, format: 'image/png' | 'image/jpeg'): string {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer,
    STYLE: 'normal',
    TILEMATRIXSET: 'PM',
    FORMAT: format,
    TILEMATRIX: '{z}',
    TILEROW: '{y}',
    TILECOL: '{x}',
  })
  return `${IGN_WMTS}?${params.toString()}`.replace(/%7B/g, '{').replace(/%7D/g, '}')
}

// Couche ortho-photo (ajoutée par-dessus le fond vectoriel, masquée par défaut).
export const ORTHO_SOURCE_ID = 'ortho-ign'
export const ORTHO_LAYER_ID = 'ortho-ign'

// ⚠️ Zoom natif max de l'ortho IGN = 19 depuis mars 2025 (la THR 5 cm a été
// retirée du flux, TileMatrixSet passé de PM_0_21 à PM_0_19 — vérifié dans le
// GetCapabilities). Au-delà, MapLibre agrandit proprement la z19 ; déclarer
// plus haut ferait demander des tuiles inexistantes. Réf. docs/etude-imagerie-satellite.md
const ORTHO_NATIVE_MAXZOOM = 19

const orthoWmtsSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [ignTiles('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')],
  tileSize: 256,
  attribution: IGN_ATTRIBUTION,
  maxzoom: ORTHO_NATIVE_MAXZOOM,
}

// Variante « retina » : mêmes données via le WMS-Raster, images 512 px sur une
// emprise de tuile 256 → 2 px d'image par px CSS, net sur mobile (le WMTS ne
// sait pas servir de @2x). En test A/B : activer avec ?ortho=wms2x dans l'URL.
const orthoWms2xSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [
    'https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&CRS=EPSG:3857&BBOX={bbox-epsg-3857}' +
      '&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg&STYLES=',
  ],
  tileSize: 256,
  attribution: IGN_ATTRIBUTION,
  maxzoom: ORTHO_NATIVE_MAXZOOM,
}

/** Source ortho active : WMTS par défaut, WMS 512 px si `?ortho=wms2x` (test A/B). */
export function getOrthoSource(): RasterSourceSpecification {
  const variant = new URLSearchParams(window.location.search).get('ortho')
  return variant === 'wms2x' ? orthoWms2xSource : orthoWmtsSource
}

/** Vue initiale : France métropolitaine. */
export const FRANCE_CENTER: [number, number] = [2.35, 46.6]
export const FRANCE_ZOOM = 5.2
