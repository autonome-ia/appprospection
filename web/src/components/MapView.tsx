import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  PLAN_IGN_STYLE_URL,
  FRANCE_CENTER,
  FRANCE_ZOOM,
  ORTHO_LAYER_ID,
  ORTHO_SOURCE_ID,
  orthoSource,
} from '../config/map'
import { generateMarkerImages, MARKER_PREFIX } from '../config/markers'
import { toast } from 'sonner'
import { STATUS_BY_VALUE, type PointStatus } from '../domain/status'
import { StatusPicker } from './StatusPicker'
import { PointDetailSheet } from './PointDetailSheet'
import { AddressSearch } from './AddressSearch'
import { AppointmentForm } from './AppointmentForm'
import { Layers, Box } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase'
import { usePoints } from '../hooks/usePoints'
import type { MapPoint, Profile } from '../domain/types'
import type { FeatureCollection, Point } from 'geojson'

const POINTS_SOURCE = 'points'
const BUILDINGS_LAYER_ID = 'buildings-3d'
const MARKERS_LAYER = 'points-markers'
const CLUSTERS_LAYER = 'clusters'
const SELECTED_LAYER = 'point-selected'
const SELECTED_BUILDING_SRC = 'selected-building'
const SELECTED_BUILDING_LAYER = 'selected-building-3d'
const NO_ID = '__none__'
// Couleurs de la DA (mêmes valeurs que --accent / --ink dans index.css :
// MapLibre ne lit pas les variables CSS).
const ACCENT = '#2f6bff'
const INK = '#16161a'
// Tolérance du tap (px) : un doigt n'est pas un curseur — on cherche les
// marqueurs dans un carré autour du point touché plutôt qu'au pixel exact.
const HIT_TOLERANCE = 14
// Délai (ms) avant de poser un point : laisse le temps à un éventuel
// double-tap (zoom) d'annuler la pose. Aligné sur le seuil double-tap.
const CREATE_DELAY = 300

const EMPTY_FC: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }

function toFeatureCollection(points: MapPoint[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, status: p.status },
    })),
  }
}

export function MapView({ profile }: { profile: Profile | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Couches de bâtiments du fond Plan IGN (à masquer en mode Toits).
  const baseBatiLayersRef = useRef<string[]>([])
  // Couches de labels du fond (noms de rues…) : halo blanc ajouté en mode
  // Toits (illisibles sinon sur la photo), valeurs d'origine restaurées en plan.
  const baseLabelLayersRef = useRef<string[]>([])
  const labelHaloBackupRef = useRef(new Map<string, { color: unknown; width: unknown }>())

  const { points, addPoint, updatePoint, removePoint } = usePoints(profile)
  const [activeStatus, setActiveStatus] = useState<PointStatus>('absent')
  const [orthoOn, setOrthoOn] = useState(true) // vue Toits par défaut
  const [is3d, setIs3d] = useState(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Point pour lequel on saisit un RDV (après avoir posé/marqué "RDV pris").
  const [rdvPoint, setRdvPoint] = useState<MapPoint | null>(null)

  // Le handler de clic lit toujours les dernières valeurs via des refs.
  const activeStatusRef = useRef(activeStatus)
  activeStatusRef.current = activeStatus
  const addPointRef = useRef(addPoint)
  addPointRef.current = addPoint
  const removePointRef = useRef(removePoint)
  removePointRef.current = removePoint
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  // Pose de point en attente (timer) : annulée si un double-tap survient.
  const pendingCreateRef = useRef<number | null>(null)

  // Initialisation de la carte (une seule fois).
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: PLAN_IGN_STYLE_URL,
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      attributionControl: { compact: true },
    })
    mapRef.current = map

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    })
    map.addControl(geolocate, 'top-right')

    map.on('load', () => {
      // Repère : premier calque de texte (labels) + sa police, pour insérer le
      // voile juste en dessous (labels préservés) et réutiliser une police valide.
      const layers = map.getStyle().layers ?? []
      const firstSymbol = layers.find((l) => l.type === 'symbol')
      const beforeLabels = firstSymbol?.id

      // Couches de bâtiments du Plan IGN (fills) : à masquer en mode Toits pour
      // laisser voir la photo des toits en dessous.
      baseBatiLayersRef.current = layers
        .filter((l) => {
          const sl = (l as { 'source-layer'?: string })['source-layer']
          return l.type === 'fill' && typeof sl === 'string' && sl.includes('bati')
        })
        .map((l) => l.id)
      // Labels du fond IGN (capturés AVANT l'ajout de nos propres couches symbol).
      baseLabelLayersRef.current = layers.filter((l) => l.type === 'symbol').map((l) => l.id)
      const fontStack =
        firstSymbol && 'layout' in firstSymbol
          ? ((firstSymbol.layout as Record<string, unknown> | undefined)?.['text-font'] as
              | string[]
              | undefined)
          : undefined

      // Voile chaud léger : adoucit le fond (ton papier) et fait ressortir les
      // marqueurs, sans toucher aux libellés (rues) qui restent au-dessus.
      if (beforeLabels) {
        map.addLayer(
          {
            id: 'base-wash',
            type: 'background',
            paint: { 'background-color': '#f2ece1', 'background-opacity': 0.22 },
          },
          beforeLabels,
        )
      }

      // Palette : eau bleu doux, végétation verte -> touches de couleur.
      for (const layer of map.getStyle().layers ?? []) {
        const sl = (layer as { 'source-layer'?: string })['source-layer']
        if (!sl) continue
        const s = sl.toLowerCase()
        try {
          if (layer.type === 'fill') {
            if (s.includes('hydro') || s.includes('eau') || s.includes('water')) {
              map.setPaintProperty(layer.id, 'fill-color', '#c3ddf2')
            } else if (s.includes('veget') || s.includes('foret')) {
              map.setPaintProperty(layer.id, 'fill-color', '#d8e8c6')
            }
          } else if (layer.type === 'line') {
            if (s.includes('hydro') || s.includes('eau') || s.includes('water')) {
              map.setPaintProperty(layer.id, 'line-color', '#a8cee9')
            }
          }
        } catch {
          /* couche non modifiable : on ignore */
        }
      }

      // Bâtiments en 3D : extrusion de la couche bati_surf du Plan IGN (champ "hauteur").
      map.addLayer({
        id: BUILDINGS_LAYER_ID,
        type: 'fill-extrusion',
        source: 'plan_ign',
        'source-layer': 'bati_surf',
        minzoom: 14,
        paint: {
          'fill-extrusion-height': ['case', ['has', 'hauteur'], ['to-number', ['get', 'hauteur']], 3],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-vertical-gradient': true,
          // Bâtiments sombres (ardoise/charbon) pour contraster avec le fond clair.
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['case', ['has', 'hauteur'], ['to-number', ['get', 'hauteur']], 3],
            0, '#4a515f',
            15, '#3a4150',
            40, '#2b313d',
          ],
        },
      })

      // Lumière directionnelle pour révéler le relief des façades sombres.
      map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.45, position: [1.4, 200, 30] })

      // Surbrillance du bâtiment sous le point sélectionné (la "maison s'illumine").
      map.addSource(SELECTED_BUILDING_SRC, { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: SELECTED_BUILDING_LAYER,
        type: 'fill-extrusion',
        source: SELECTED_BUILDING_SRC,
        paint: {
          'fill-extrusion-color': ACCENT,
          'fill-extrusion-opacity': 0.7,
          'fill-extrusion-height': [
            '+',
            ['case', ['has', 'hauteur'], ['to-number', ['get', 'hauteur']], 3],
            1,
          ],
          'fill-extrusion-base': 0,
        },
      })

      // Ortho-photo (mode "Toits") : insérée SOUS les libellés pour que les noms
      // de rues restent visibles PAR-DESSUS la photo (vue hybride). Masquée par défaut.
      map.addSource(ORTHO_SOURCE_ID, orthoSource)
      map.addLayer(
        { id: ORTHO_LAYER_ID, type: 'raster', source: ORTHO_SOURCE_ID, layout: { visibility: 'none' } },
        beforeLabels,
      )

      // Marqueurs (images générées par statut).
      const images = generateMarkerImages()
      for (const status of Object.keys(images) as PointStatus[]) {
        const name = `${MARKER_PREFIX}${status}`
        if (!map.hasImage(name)) map.addImage(name, images[status], { pixelRatio: 2 })
      }

      // Source des points, avec regroupement (clustering).
      map.addSource(POINTS_SOURCE, {
        type: 'geojson',
        data: toFeatureCollection([]),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 15,
      })

      // Bulles de regroupement : blanches à anneau accent (distinctes du
      // marqueur sombre "impossible", lisibles sur plan comme sur ortho).
      map.addLayer({
        id: CLUSTERS_LAYER,
        type: 'circle',
        source: POINTS_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
          'circle-stroke-width': 3,
          'circle-stroke-color': ACCENT,
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: POINTS_SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 14,
          ...(fontStack ? { 'text-font': fontStack } : {}),
        },
        paint: { 'text-color': INK },
      })

      // Surbrillance du point sélectionné (halo, sous les marqueurs).
      map.addLayer({
        id: SELECTED_LAYER,
        type: 'circle',
        source: POINTS_SOURCE,
        filter: ['==', ['get', 'id'], NO_ID],
        paint: {
          'circle-radius': 22,
          'circle-color': ACCENT,
          'circle-opacity': 0.25,
        },
      })

      // Marqueurs individuels (points non regroupés).
      map.addLayer({
        id: MARKERS_LAYER,
        type: 'symbol',
        source: POINTS_SOURCE,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', MARKER_PREFIX, ['get', 'status']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-anchor': 'center',
        },
      })

      setMapLoaded(true)

      // Zoom automatique sur la position de l'utilisateur à l'ouverture.
      try {
        geolocate.trigger()
      } catch {
        /* géolocalisation indisponible : on reste sur la vue France */
      }
    })

    // Curseur "main" au survol des marqueurs / bulles.
    const hover = (cursor: string) => () => {
      map.getCanvas().style.cursor = cursor
    }
    map.on('mouseenter', MARKERS_LAYER, hover('pointer'))
    map.on('mouseleave', MARKERS_LAYER, hover(''))
    map.on('mouseenter', CLUSTERS_LAYER, hover('pointer'))
    map.on('mouseleave', CLUSTERS_LAYER, hover(''))

    // Pose un point (UI optimiste) + toast avec "Annuler" (filet anti-erreur).
    const createPointAt = (lng: number, lat: number) => {
      const status = activeStatusRef.current
      const { point, saved } = addPointRef.current(lng, lat, status)
      toast.success(`Point posé — ${STATUS_BY_VALUE[status].label}`, {
        action: { label: 'Annuler', onClick: () => void removePointRef.current(point.id) },
      })
      void saved.then((created) => {
        // Poser un "RDV pris" enchaîne sur la saisie du rendez-vous.
        if (created && status === 'rdv_pris' && isSupabaseConfigured) {
          setRdvPoint(created)
        }
      })
    }
    const cancelPendingCreate = () => {
      if (pendingCreateRef.current !== null) {
        window.clearTimeout(pendingCreateRef.current)
        pendingCreateRef.current = null
        return true
      }
      return false
    }

    // Clic : bulle -> zoom ; marqueur -> détail ; zone vide -> pose un point
    // (ou ferme le détail s'il est ouvert).
    map.on('click', (e) => {
      // 2e tap rapproché = double-tap (zoom) : on annule la pose en attente.
      const wasPending = cancelPendingCreate()

      const queryable = [CLUSTERS_LAYER, MARKERS_LAYER].filter((l) => map.getLayer(l))
      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const hits = queryable.length ? map.queryRenderedFeatures(bbox, { layers: queryable }) : []

      const cluster = hits.find((f) => f.layer.id === CLUSTERS_LAYER)
      if (cluster) {
        const clusterId = cluster.properties?.cluster_id
        const src = map.getSource(POINTS_SOURCE) as maplibregl.GeoJSONSource
        void src.getClusterExpansionZoom(clusterId).then((zoom) => {
          const [lng, lat] = (cluster.geometry as Point).coordinates
          map.easeTo({ center: [lng, lat], zoom })
        })
        return
      }

      const marker = hits.find((f) => f.layer.id === MARKERS_LAYER)
      if (marker) {
        setSelectedId(marker.properties?.id as string)
        return
      }

      if (selectedIdRef.current) {
        setSelectedId(null)
        return
      }

      // Zone vide juste après un tap annulé : c'était un double-tap-zoom.
      if (wasPending) return

      // Pose différée : un double-tap dans l'intervalle l'annule.
      const { lng, lat } = e.lngLat
      pendingCreateRef.current = window.setTimeout(() => {
        pendingCreateRef.current = null
        createPointAt(lng, lat)
      }, CREATE_DELAY)
    })

    // Ceinture + bretelles : si MapLibre émet dblclick, on annule aussi.
    map.on('dblclick', cancelPendingCreate)

    return () => {
      cancelPendingCreate()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Met à jour la source GeoJSON quand la liste de points change OU quand la
  // carte devient prête (évite le 1er rendu manqué si les points arrivent avant).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const source = map.getSource(POINTS_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(toFeatureCollection(points))
  }, [points, mapLoaded])

  // Surbrillance du point sélectionné.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer(SELECTED_LAYER)) return
    map.setFilter(SELECTED_LAYER, ['==', ['get', 'id'], selectedId ?? NO_ID])
  }, [selectedId, mapLoaded])

  // Surbrillance du bâtiment (maison) sous le point sélectionné.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource(SELECTED_BUILDING_SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    const pt = selectedId ? points.find((p) => p.id === selectedId) : null
    if (!pt || !map.getLayer(BUILDINGS_LAYER_ID)) {
      src.setData(EMPTY_FC)
      return
    }
    try {
      const p = map.project([pt.lng, pt.lat])
      const feats = map.queryRenderedFeatures(
        [
          [p.x - 6, p.y - 6],
          [p.x + 6, p.y + 6],
        ],
        { layers: [BUILDINGS_LAYER_ID] },
      )
      src.setData(
        feats.length
          ? { type: 'FeatureCollection', features: [feats[0] as unknown as FeatureCollection<Point>['features'][number]] }
          : EMPTY_FC,
      )
    } catch {
      src.setData(EMPTY_FC)
    }
  }, [selectedId, points, mapLoaded])

  // Bascule de la couche ortho-photo (voir les toits). S'applique aussi au
  // chargement (mapLoaded) pour honorer la vue Toits par défaut.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (map.getLayer(ORTHO_LAYER_ID)) {
      map.setLayoutProperty(ORTHO_LAYER_ID, 'visibility', orthoOn ? 'visible' : 'none')
    }
    // Bâtiments blancs du Plan IGN : masqués en mode Toits (sinon ils cachent les toits).
    for (const id of baseBatiLayersRef.current) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', orthoOn ? 'none' : 'visible')
      }
    }
    // Les bâtiments 3D ne s'affichent qu'en mode Plan (masqués sous l'ortho).
    for (const id of [BUILDINGS_LAYER_ID, SELECTED_BUILDING_LAYER]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', orthoOn ? 'none' : 'visible')
      }
    }
    // Halo blanc sous les labels (noms de rues) : indispensable sur la photo
    // (toits sombres, végétation) ; en plan, on restaure le style IGN d'origine.
    for (const id of baseLabelLayersRef.current) {
      if (!map.getLayer(id)) continue
      if (orthoOn) {
        if (!labelHaloBackupRef.current.has(id)) {
          labelHaloBackupRef.current.set(id, {
            color: map.getPaintProperty(id, 'text-halo-color'),
            width: map.getPaintProperty(id, 'text-halo-width'),
          })
        }
        map.setPaintProperty(id, 'text-halo-color', 'rgba(255, 255, 255, 0.9)')
        map.setPaintProperty(id, 'text-halo-width', 1.2)
      } else {
        const orig = labelHaloBackupRef.current.get(id)
        if (orig) {
          map.setPaintProperty(id, 'text-halo-color', orig.color)
          map.setPaintProperty(id, 'text-halo-width', orig.width)
        }
      }
    }
  }, [orthoOn, mapLoaded])

  // Inclinaison de la carte pour la vue 3D (+ zoom suffisant pour voir les bâtiments).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (is3d) {
      const zoom = map.getZoom() < 15.5 ? 16.5 : map.getZoom()
      map.easeTo({ pitch: 60, zoom, duration: 800 })
    } else {
      map.easeTo({ pitch: 0, duration: 600 })
    }
  }, [is3d])

  const selectedPoint = points.find((p) => p.id === selectedId) ?? null
  // Conserve le dernier point sélectionné le temps de l'animation de fermeture.
  const lastSelectedRef = useRef<MapPoint | null>(null)
  if (selectedPoint) lastSelectedRef.current = selectedPoint

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" />

      <AddressSearch
        onSelect={(r) => mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 18 })}
      />

      <div className="map-toolbar">
        <button
          type="button"
          className={`map-tool ${orthoOn ? 'is-on' : ''}`}
          onClick={() => {
            const next = !orthoOn
            setOrthoOn(next)
            // Les bâtiments 3D sont masqués sous l'ortho : passer en Toits
            // sort de la 3D (sinon on incline une photo plate).
            if (next && is3d) setIs3d(false)
          }}
          title={orthoOn ? 'Vue plan' : 'Vue toits (satellite)'}
        >
          <Layers size={20} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`map-tool ${is3d ? 'is-on' : ''}`}
          onClick={() => setIs3d((v) => !v)}
          disabled={orthoOn}
          title={orthoOn ? 'Vue 3D indisponible en vue Toits' : is3d ? 'Vue 2D' : 'Vue 3D'}
        >
          <Box size={20} strokeWidth={1.8} />
        </button>
      </div>

      <StatusPicker active={activeStatus} onChange={setActiveStatus} />

      <PointDetailSheet
        open={selectedPoint !== null}
        point={selectedPoint ?? lastSelectedRef.current}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onUpdate={updatePoint}
        onDelete={removePoint}
        onRdvNeeded={(p) => isSupabaseConfigured && setRdvPoint(p)}
      />

      {rdvPoint && profile && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setRdvPoint(null)}
          profile={profile}
          pointId={rdvPoint.id}
          coords={{ lng: rdvPoint.lng, lat: rdvPoint.lat }}
          onSaved={() => setRdvPoint(null)}
        />
      )}
    </div>
  )
}
