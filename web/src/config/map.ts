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

// Couche ortho-photo (par-dessus le fond vectoriel, TOUJOURS visible — la vue
// Plan a été retirée le 25/07/2026, décision briac : personne ne s'en servait).
export const ORTHO_SOURCE_ID = 'ortho-ign'
export const ORTHO_LAYER_ID = 'ortho-ign'
// Imagerie ALTERNATIVE (Esri World Imagery) : un autre rendu complet —
// couleurs, millésimes et traitement différents de l'IGN. Bascule via le
// bouton de la barre d'outils (demande briac 25/07 : « deux visuels »).
export const ESRI_SOURCE_ID = 'sat-esri'
export const ESRI_LAYER_ID = 'sat-esri'

// ⚠️ Zoom natif max de l'ortho IGN = 19 depuis mars 2025 (la THR 5 cm a été
// retirée du flux, TileMatrixSet passé de PM_0_21 à PM_0_19 — vérifié dans le
// GetCapabilities). Au-delà, MapLibre agrandit proprement la z19 ; déclarer
// plus haut ferait demander des tuiles inexistantes. Réf. docs/etude-imagerie-satellite.md
const ORTHO_NATIVE_MAXZOOM = 19

export const orthoWmtsSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [ignTiles('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')],
  tileSize: 256,
  attribution: IGN_ATTRIBUTION,
  maxzoom: ORTHO_NATIVE_MAXZOOM,
}

// Esri World Imagery (Maxar) — gratuit jusqu'à 2 M tuiles/mois, attribution
// obligatoire. Rendu plus chaud/contrasté que l'IGN ; en rural breton la
// résolution native plafonne vers z19 et peut être plus floue que la BD ORTHO
// 20 cm au zoom maison (mesuré, docs/etude-imagerie-satellite.md) — c'est un
// LOOK alternatif, pas un gain de netteté. (La variante « HD » WMS 512 px a
// été retirée le 25/07 : aucune différence perçue sur le terrain.)
export const esriSatelliteSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ],
  tileSize: 256,
  attribution:
    '© <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, GIS User Community',
  maxzoom: ORTHO_NATIVE_MAXZOOM,
}

/** Vue initiale : France métropolitaine. */
export const FRANCE_CENTER: [number, number] = [2.35, 46.6]
export const FRANCE_ZOOM = 5.2
