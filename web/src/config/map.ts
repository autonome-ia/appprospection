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

export const orthoSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [ignTiles('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')],
  tileSize: 256,
  attribution: IGN_ATTRIBUTION,
  maxzoom: 21,
}

/** Vue initiale : France métropolitaine. */
export const FRANCE_CENTER: [number, number] = [2.35, 46.6]
export const FRANCE_ZOOM = 5.2
