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
import { createClusterBadge, type ClusterProps } from '../config/clusters'
import { toast } from 'sonner'
import { STATUS_BY_VALUE, statusColorExpression, type PointStatus } from '../domain/status'
import { StatusPicker } from './StatusPicker'
import { PointDetailSheet } from './PointDetailSheet'
import { AddressSearch } from './AddressSearch'
import { AppointmentForm } from './AppointmentForm'
import { Layers, Box, Plus } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase'
import { usePoints } from '../hooks/usePoints'
import type { MapPoint, Profile } from '../domain/types'
import type { FeatureCollection, Point } from 'geojson'

const POINTS_SOURCE = 'points'
const BUILDINGS_LAYER_ID = 'buildings-3d'
const MARKERS_LAYER = 'points-markers'
const SELECTED_LAYER = 'point-selected'
const SELECTED_BUILDING_SRC = 'selected-building'
const SELECTED_BUILDING_LAYER = 'selected-building-3d'
const NO_ID = '__none__'
// Couleur de la DA (même valeur que --accent dans index.css : MapLibre ne
// lit pas les variables CSS).
const ACCENT = '#2f6bff'
// Tolérance du tap (px) : un doigt n'est pas un curseur — on cherche les
// marqueurs dans un carré autour du point touché plutôt qu'au pixel exact.
const HIT_TOLERANCE = 14
// Zoom minimal pour poser un point au réticule (en dessous, on ne distingue
// pas les maisons : la pose serait forcément imprécise).
const PLACE_MIN_ZOOM = 15
// Hauteur approximative de la sheet détail (px) : padding bas appliqué à la
// carte pour recadrer le point sélectionné AU-DESSUS de la sheet.
const SHEET_PADDING = 310

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

export function MapView({ profile, active }: { profile: Profile | null; active: boolean }) {
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
  // Mode visée : réticule au centre, on déplace la carte sous le viseur puis
  // on valide — le doigt ne masque jamais la maison, aucun tap accidentel.
  const [placing, setPlacing] = useState(false)

  // Le handler de clic lit toujours les dernières valeurs via des refs.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const placingRef = useRef(placing)
  placingRef.current = placing

  // Quitter l'onglet Carte ferme ce qui est ouvert (les drawers sont portés
  // dans <body> et resteraient visibles par-dessus l'autre onglet).
  useEffect(() => {
    if (!active) {
      setSelectedId(null)
      setRdvPoint(null)
      setPlacing(false)
    }
  }, [active])

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
      // Pas de cercle de précision : le grand halo bleu pâle mange la carte
      // (le point suffit sur le terrain).
      showAccuracyCircle: false,
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

      // Voile chaud : teinte le sol (ton papier) pour que les routes blanches
      // ressortent. Inséré SOUS les routes si on les trouve (elles restent
      // blanches et nettes), sinon sous les labels.
      const firstRoad = layers.find((l) => {
        const sl = (l as { 'source-layer'?: string })['source-layer']
        return l.type === 'line' && typeof sl === 'string' && sl.includes('routier')
      })
      const washBefore = firstRoad?.id ?? beforeLabels
      if (washBefore) {
        map.addLayer(
          {
            id: 'base-wash',
            type: 'background',
            paint: { 'background-color': '#efe8da', 'background-opacity': 0.5 },
          },
          washBefore,
        )
      }

      // Palette : eau bleu doux, végétation verte -> touches de couleur.
      for (const layer of map.getStyle().layers ?? []) {
        const sl = (layer as { 'source-layer'?: string })['source-layer']
        if (!sl) continue
        const s = sl.toLowerCase()
        try {
          if (layer.type === 'fill') {
            // Teintes un peu appuyées : le voile chaud (au-dessus) les adoucit.
            if (s.includes('hydro') || s.includes('eau') || s.includes('water')) {
              map.setPaintProperty(layer.id, 'fill-color', '#aecfee')
            } else if (s.includes('veget') || s.includes('foret')) {
              map.setPaintProperty(layer.id, 'fill-color', '#cfe3b5')
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
          // Bâtiments CLAIRS (réf. Apple Plans / DA "Clair & précis") : le
          // relief vient de la lumière, la couleur reste aux marqueurs.
          // Les plus hauts sont à peine plus soutenus pour lire la ville.
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['case', ['has', 'hauteur'], ['to-number', ['get', 'hauteur']], 3],
            0, '#eae7e0',
            15, '#dedad1',
            40, '#cfcabf',
          ],
        },
      })

      // Lumière directionnelle un peu plus marquée : sur des façades claires,
      // c'est elle qui donne le relief.
      map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.6, position: [1.4, 200, 30] })

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
        {
          id: ORTHO_LAYER_ID,
          type: 'raster',
          source: ORTHO_SOURCE_ID,
          layout: { visibility: 'none' },
          // La BD ORTHO est voilée/laiteuse aux zooms moyens : contraste appuyé,
          // blancs légèrement rabaissés, saturation relevée.
          paint: {
            'raster-saturation': 0.25,
            'raster-contrast': 0.12,
            'raster-brightness-max': 0.95,
          },
        },
        beforeLabels,
      )

      // Marqueurs (images générées par statut).
      const images = generateMarkerImages()
      for (const status of Object.keys(images) as PointStatus[]) {
        const name = `${MARKER_PREFIX}${status}`
        if (!map.hasImage(name)) map.addImage(name, images[status], { pixelRatio: 2 })
      }

      // Source des points, avec regroupement (clustering). Seuils bas : dès
      // l'échelle quartier (z14+), on voit TOUS les points d'un coup d'œil —
      // les bulles ne subsistent qu'aux échelles ville.
      map.addSource(POINTS_SOURCE, {
        type: 'geojson',
        data: toFeatureCollection([]),
        cluster: true,
        clusterRadius: 36,
        clusterMaxZoom: 13,
      })

      // Bulles de regroupement : badges DOM (police et tokens de la DA),
      // synchronisés avec les clusters visibles à chaque mouvement.
      const badges = new Map<string, maplibregl.Marker>()
      const updateBadges = () => {
        const visible = new Set<string>()
        for (const f of map.querySourceFeatures(POINTS_SOURCE)) {
          const p = f.properties as ClusterProps | null
          if (!p || !p.cluster) continue
          const coords = (f.geometry as Point).coordinates as [number, number]
          // Clé = id + total : si le contenu change, on redessine.
          const key = `${p.cluster_id}:${p.point_count}`
          if (visible.has(key)) continue // dédoublonne (tuiles voisines)
          visible.add(key)
          if (badges.has(key)) continue
          const el = createClusterBadge(p)
          el.addEventListener('click', (ev) => {
            ev.stopPropagation()
            const src = map.getSource(POINTS_SOURCE) as maplibregl.GeoJSONSource
            void src.getClusterExpansionZoom(p.cluster_id).then((zoom) => {
              map.easeTo({ center: coords, zoom })
            })
          })
          badges.set(key, new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map))
        }
        for (const [key, m] of badges) {
          if (!visible.has(key)) {
            m.remove()
            badges.delete(key)
          }
        }
      }
      map.on('data', (e) => {
        const ev = e as maplibregl.MapSourceDataEvent
        if (ev.sourceId === POINTS_SOURCE && ev.isSourceLoaded) updateBadges()
      })
      map.on('move', updateBadges)
      map.on('moveend', updateBadges)

      // Surbrillance du point sélectionné (halo, sous les marqueurs).
      map.addLayer({
        id: SELECTED_LAYER,
        type: 'circle',
        source: POINTS_SOURCE,
        filter: ['==', ['get', 'id'], NO_ID],
        paint: {
          'circle-radius': 22,
          // Halo dans la couleur du statut du point sélectionné.
          'circle-color': statusColorExpression() as maplibregl.ExpressionSpecification,
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
          // Continue de grossir aux zooms "toit" (le marqueur reste proportionné
          // à la maison quand on est proche).
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1, 19, 1.25],
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

    // Curseur "main" au survol des marqueurs (les donuts sont des éléments
    // DOM avec leur propre curseur).
    const hover = (cursor: string) => () => {
      map.getCanvas().style.cursor = cursor
    }
    map.on('mouseenter', MARKERS_LAYER, hover('pointer'))
    map.on('mouseleave', MARKERS_LAYER, hover(''))

    // Clic : marqueur -> détail ; zone vide -> ferme le détail. Le zoom sur
    // une bulle est géré par le donut lui-même (élément DOM). La POSE d'un
    // point ne passe plus par le tap (source d'erreurs terrain) mais par le
    // mode visée (réticule + bouton), voir confirmPlace().
    map.on('click', (e) => {
      // En mode visée, le tap ne sert qu'à naviguer.
      if (placingRef.current) return

      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const hits = map.getLayer(MARKERS_LAYER)
        ? map.queryRenderedFeatures(bbox, { layers: [MARKERS_LAYER] })
        : []

      const marker = hits.find((f) => f.layer.id === MARKERS_LAYER)
      if (marker) {
        setSelectedId(marker.properties?.id as string)
        return
      }

      if (selectedIdRef.current) setSelectedId(null)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Pose le point sous le réticule (UI optimiste + toast avec "Annuler").
  const confirmPlace = () => {
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() < PLACE_MIN_ZOOM) {
      toast('Rapprochez-vous pour viser la maison', {
        description: 'Zoomez jusqu’à distinguer les toits avant de poser un point.',
      })
      return
    }
    const { lng, lat } = map.getCenter()
    const { point, saved } = addPoint(lng, lat, activeStatus)
    toast.success(`Point posé — ${STATUS_BY_VALUE[activeStatus].label}`, {
      action: { label: 'Annuler', onClick: () => void removePoint(point.id) },
    })
    void saved.then((created) => {
      // Poser un "RDV pris" enchaîne sur la saisie du rendez-vous.
      if (created && activeStatus === 'rdv_pris' && isSupabaseConfigured) {
        setRdvPoint(created)
      }
    })
    setPlacing(false)
  }

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

  // La sheet détail (non modale) couvre le bas de l'écran : on recadre le
  // point sélectionné au-dessus d'elle (padding bas), et on rend le padding
  // à la fermeture (sans recentrer).
  const pointsRef = useRef(points)
  pointsRef.current = points
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const pt = selectedId ? pointsRef.current.find((p) => p.id === selectedId) : null
    if (pt) {
      map.easeTo({
        center: [pt.lng, pt.lat],
        padding: { top: 0, bottom: SHEET_PADDING, left: 0, right: 0 },
        duration: 350,
      })
    } else {
      map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 250 })
    }
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

      {!placing && (
        <button
          type="button"
          className="map-fab"
          onClick={() => setPlacing(true)}
          aria-label="Poser un point"
        >
          <Plus size={26} strokeWidth={2.2} />
        </button>
      )}

      {placing && (
        <>
          {/* Réticule : la pose se fait au centre exact de la carte (getCenter). */}
          <div className="map-crosshair" aria-hidden="true">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="15" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <circle cx="26" cy="26" r="3" fill="var(--accent)" />
              <line x1="26" y1="3" x2="26" y2="9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
              <line x1="26" y1="43" x2="26" y2="49" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="26" x2="9" y2="26" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
              <line x1="43" y1="26" x2="49" y2="26" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="place-bar">
            <p className="eyebrow place-hint">Déplacez la carte — la maison sous le viseur</p>
            <StatusPicker active={activeStatus} onChange={setActiveStatus} />
            <div className="place-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPlacing(false)}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmPlace}>
                Poser ici
              </button>
            </div>
          </div>
        </>
      )}

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
