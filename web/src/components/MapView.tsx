import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  PLAN_IGN_STYLE_URL,
  FRANCE_CENTER,
  FRANCE_ZOOM,
  ORTHO_LAYER_ID,
  ORTHO_SOURCE_ID,
  orthoWmtsSource,
} from '../config/map'
import {
  generateMarkerImages,
  markerDataUrl,
  MARKER_PREFIX,
  MARKER_PIXEL_RATIO,
  NOTE_SUFFIX,
} from '../config/markers'
import { createClusterBadge, type ClusterProps } from '../config/clusters'
import { PAN_COLORS } from '../domain/colors'
import { toast } from 'sonner'
import {
  CLIENT_STATUSES,
  DISPLAY_STATUSES,
  STATUS_BY_VALUE,
  isClientStatus,
  statusColorExpression,
  type PointStatus,
} from '../domain/status'
import { StatusPicker } from './StatusPicker'
import { PointDetailSheet } from './PointDetailSheet'
import { HousePreviewSheet } from './HousePreviewSheet'
import { fetchPointPans, localDayKey, reverseGeocode } from '../data/points'
import type { HouseInfo } from '../data/enrich'
import type { LidarResult } from '../data/lidar'
import type { LidarPan, RoofData } from '../domain/house'
import { AddressSearch } from './AddressSearch'
import { AppointmentForm } from './AppointmentForm'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { colorForCommercial } from '../domain/colors'
import { BellRing, Plus, SlidersHorizontal } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase'
import { usePoints } from '../hooks/usePoints'
import { isSupervisorRole, type MapPoint, type Profile } from '../domain/types'
import type { Appointment } from '../domain/appointments'
import type { FeatureCollection, Point } from 'geojson'

const POINTS_SOURCE = 'points'
const MARKERS_LAYER = 'points-markers'
const SELECTED_LAYER = 'point-selected'
// Surbrillance de la maison consultée (fiche maison avant prospection).
const HOUSE_SRC = 'house-preview'
const HOUSE_FILL_LAYER = 'house-preview-fill'
const HOUSE_LINE_LAYER = 'house-preview-line'
// Pans de toiture mesurés (LiDAR) : dessinés sur l'ortho quand la fiche d'une
// maison mesurée est ouverte — l'argument « voilà vos 4 pans » à la porte.
const PANS_SRC = 'lidar-pans'
const PANS_FILL_LAYER = 'lidar-pans-fill'
const PANS_LINE_LAYER = 'lidar-pans-line'
// Position de l'utilisateur : point vivant alimenté par watchPosition (le
// GeolocateControl one-shot laissait le point planté — retour terrain 27/07).
const USER_SRC = 'user-location'
const USER_HALO_LAYER = 'user-location-halo'
const USER_DOT_LAYER = 'user-location-dot'
// Bleu « position » (convention cartos) — volontairement ≠ du bleu statut
// « RDV pris » (#2f6bff) ; la forme (rond à liseré blanc vs goutte) fait le
// reste de la distinction.
const USER_BLUE = '#1a73e8'
const NO_ID = '__none__'
// Couleur de la DA (même valeur que --accent dans index.css : MapLibre ne
// lit pas les variables CSS). DA « Encre & signal » : orange signal.
const ACCENT = '#f54e00'
// Tolérance du tap (px) : un doigt n'est pas un curseur — on cherche les
// marqueurs dans un carré autour du point touché plutôt qu'au pixel exact.
const HIT_TOLERANCE = 14
// Zoom minimal pour poser un point au réticule (en dessous, on ne distingue
// pas les maisons : la pose serait forcément imprécise).
const PLACE_MIN_ZOOM = 15
// Zoom minimal pour ouvrir la fiche maison d'un tap (évite les fiches
// parasites en manipulant la carte au niveau ville).
const PREVIEW_MIN_ZOOM = 16
// Délai avant d'ouvrir la fiche maison : un double-tap (zoom) l'annule.
const PREVIEW_DELAY = 300
// Recadrage au-dessus de la sheet : hauteur RÉELLE de la sheet ouverte,
// mesurée au moment du mouvement — l'ancienne constante 310 datait d'avant
// l'enrichissement de la fiche (badges, 3D, plan coté) : le point et ses
// pans de toit étaient recadrés DERRIÈRE la sheet. Plafonné à 60 % du
// viewport pour garder une bande de carte utile ; 310 reste le plancher
// (sheet pas encore montée au moment d'un flyTo).
function sheetPadding(): number {
  const el = document.querySelector('.drawer-content')
  const h = el ? Math.round(el.getBoundingClientRect().height) + 16 : 0
  return Math.min(Math.max(h, 310), Math.round(window.innerHeight * 0.6))
}

const EMPTY_FC: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }

function toFeatureCollection(points: MapPoint[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, status: p.status, has_note: Boolean(p.note && p.note.trim()) },
    })),
  }
}

/** Cible à montrer sur la carte (depuis l'agenda : « Voir sur la carte »). */
export interface MapFocus {
  pointId: string
  lng: number
  lat: number
}

export function MapView({
  profile,
  active,
  focus,
  onFocusHandled,
  whoFocus,
  onWhoFocusHandled,
}: {
  profile: Profile | null
  active: boolean
  focus?: MapFocus | null
  onFocusHandled?: () => void
  /** Pont Stats→Carte (audit UX B5) : id du commercial dont le drill-down
      demande « Voir ses points » — pré-applique le filtre « Qui ». */
  whoFocus?: string | null
  onWhoFocusHandled?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const { points, addPoint, updatePoint, addNote, removePoint } = usePoints(profile)
  const [activeStatus, setActiveStatus] = useState<PointStatus>('absent')
  const [mapLoaded, setMapLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Point pour lequel on saisit un RDV (après avoir posé/marqué "RDV pris"),
  // avec le RDV « à venir » à ÉDITER le cas échéant (décaler une date sans
  // créer de doublon — 29/07).
  const [rdvTarget, setRdvTarget] = useState<{
    point: MapPoint
    existing: Appointment | null
  } | null>(null)
  // Incrémenté à chaque RDV enregistré : le bloc « Rendez-vous » de la fiche
  // (ouverte dessous) se rafraîchit sans rouvrir (audit UX B1).
  const [apptSeq, setApptSeq] = useState(0)
  // Mode visée : réticule au centre, on déplace la carte sous le viseur puis
  // on valide — le doigt ne masque jamais la maison, aucun tap accidentel.
  const [placing, setPlacing] = useState(false)
  // Filtre par statut (vide = tout afficher). Ex. « Vendu » seul = voir les
  // chantiers pour prospecter autour. Chips repliées derrière le bouton
  // filtres de la barre d'outils (la carte reste dégagée).
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<PointStatus>>(new Set())
  // Filtre « ancienneté » (jours depuis la DERNIÈRE visite, null = tout) :
  // combiné en ET avec le statut — ex. « Absent » + « > 1 mois » = les portes
  // à retenter en priorité.
  const [ageFilter, setAgeFilter] = useState<number | null>(null)
  // Filtre « À relancer » (audit UX B6) : les « à revoir » dont la date de
  // relance est atteinte — les relances dues, visibles là où on en a besoin
  // (dans le quartier). Chip seule, pas de pastille marqueur (véto designer).
  const [dueOnly, setDueOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Filtre « Qui » (superviseur : manager + chef des ventes) : voir les
  // points d'un ou plusieurs commerciaux. Le commercial, lui, ne voit QUE ses
  // points (décision chef des ventes, 25/07).
  const [whoFilter, setWhoFilter] = useState<ReadonlySet<string>>(new Set())
  const [orgProfiles, setOrgProfiles] = useState<OrgProfile[]>([])
  const isSupervisor = isSupervisorRole(profile?.role)
  useEffect(() => {
    if (!isSupervisor) return
    fetchOrgProfiles().then(setOrgProfiles).catch((e) => console.error('Profils :', e))
  }, [isSupervisor])
  // Pont Stats→Carte : applique le filtre « Qui » demandé par le drill-down
  // et déplie la barre de filtres (la chip active dit ce qu'on regarde).
  useEffect(() => {
    if (!whoFocus) return
    setWhoFilter(new Set([whoFocus]))
    setFiltersOpen(true)
    onWhoFocusHandled?.()
  }, [whoFocus, onWhoFocusHandled])
  // Badge du bouton filtres (nb de critères actifs).
  const nFilters =
    statusFilter.size + (ageFilter !== null ? 1 : 0) + (whoFilter.size > 0 ? 1 : 0) + (dueOnly ? 1 : 0)
  // « Poser ici » grisé tant que le zoom ne permet pas de viser une maison.
  const [placeZoomOk, setPlaceZoomOk] = useState(true)
  // Déplacement d'un point mal posé (demande briac 25/07) : appui long sur
  // SON marqueur → le point se soulève et SUIT LE DOIGT, on le lâche sur la
  // bonne maison (vrai drag, pas de réticule).
  const [dragId, setDragId] = useState<string | null>(null)
  const dragRef = useRef<{ point: MapPoint; marker: maplibregl.Marker } | null>(null)
  const profileRef = useRef(profile)
  profileRef.current = profile
  // Fiche maison AVANT prospection : maison tapée (sans marqueur) + ses infos.
  const [housePreview, setHousePreview] = useState<{ lng: number; lat: number } | null>(null)
  const [houseInfo, setHouseInfo] = useState<HouseInfo | null>(null)
  const [houseAddress, setHouseAddress] = useState<string | null>(null)
  // Mesure LiDAR de la maison consultée (cache mémoire côté data/lidar).
  const [houseLidar, setHouseLidar] = useState<LidarResult | null>(null)

  // Le handler de clic lit toujours les dernières valeurs via des refs.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const placingRef = useRef(placing)
  placingRef.current = placing
  const activeRef = useRef(active)
  activeRef.current = active
  const housePreviewRef = useRef(housePreview)
  housePreviewRef.current = housePreview
  // Ouverture de fiche maison en attente (timer) : annulée par un double-tap.
  const pendingPreviewRef = useRef<number | null>(null)
  // Pilotage du watchPosition (défini par l'effet d'init) : coupé hors de
  // l'onglet Carte et en arrière-plan — GPS seulement quand la carte sert.
  const watchCtlRef = useRef<{ start: () => void; stop: () => void } | null>(null)
  useEffect(() => {
    if (active) watchCtlRef.current?.start()
    else watchCtlRef.current?.stop()
  }, [active])

  // Quitter l'onglet Carte ferme ce qui est ouvert (les drawers sont portés
  // dans <body> et resteraient visibles par-dessus l'autre onglet).
  useEffect(() => {
    if (!active) {
      setSelectedId(null)
      setRdvTarget(null)
      setPlacing(false)
      setHousePreview(null)
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

    // --- Position vivante (retour terrain 27/07 : « le point ne me suit
    // pas »). Le GeolocateControl de MapLibre couple le point et la caméra :
    // en one-shot le point restait planté, en suivi la caméra volait vers la
    // position après chaque recherche d'adresse (bug briac 25/07). On sépare
    // les deux : un watchPosition alimente LE POINT en continu, la caméra ne
    // bouge JAMAIS toute seule — le bouton ⌖ ne fait que la recentrer.
    let lastFix: [number, number] | null = null
    let watchId: number | null = null
    let denied = false
    const userFC = (): FeatureCollection<Point> =>
      lastFix
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lastFix }, properties: {} }],
          }
        : EMPTY_FC

    const onFix = (pos: GeolocationPosition) => {
      const first = lastFix === null
      lastFix = [pos.coords.longitude, pos.coords.latitude]
      const src = map.getSource(USER_SRC) as maplibregl.GeoJSONSource | undefined
      src?.setData(userFC())
      // Zoom d'accueil sur le 1er fix — seulement si l'utilisateur n'a pas
      // déjà navigué (recherche, « Voir sur la carte ») : on ne vole pas la
      // caméra à qui s'en sert (même garde que l'ancien one-shot).
      if (first) {
        const c = map.getCenter()
        const untouched =
          Math.abs(c.lng - FRANCE_CENTER[0]) < 1e-6 &&
          Math.abs(c.lat - FRANCE_CENTER[1]) < 1e-6 &&
          Math.abs(map.getZoom() - FRANCE_ZOOM) < 0.01
        if (untouched) map.easeTo({ center: lastFix, zoom: 16, duration: 1200 })
      }
    }
    const startWatch = () => {
      if (watchId !== null || denied || !navigator.geolocation) return
      watchId = navigator.geolocation.watchPosition(
        onFix,
        (err) => {
          // Refus explicite : on arrête (sinon iOS relance l'erreur en
          // boucle) — un tap sur ⌖ retentera et expliquera.
          if (err.code === err.PERMISSION_DENIED) {
            denied = true
            stopWatch()
          }
        },
        { enableHighAccuracy: true, maximumAge: 1000 },
      )
    }
    const stopWatch = () => {
      if (watchId !== null) {
        navigator.geolocation?.clearWatch(watchId)
        watchId = null
      }
    }
    watchCtlRef.current = { start: startWatch, stop: stopWatch }
    // Écran éteint / PWA en arrière-plan : GPS coupé (batterie) — le point
    // se recale au premier fix du retour.
    const onVisibility = () => {
      if (document.hidden) stopWatch()
      else if (activeRef.current) startWatch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (activeRef.current) startWatch()

    // Bouton ⌖ (même emplacement que l'ancien contrôle, mêmes styles
    // .maplibregl-ctrl-group) : recentre la carte sur le point vivant.
    const locateBtn = document.createElement('button')
    locateBtn.type = 'button'
    locateBtn.className = 'locate-btn'
    locateBtn.setAttribute('aria-label', 'Ma position')
    locateBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>'
    locateBtn.addEventListener('click', () => {
      if (lastFix) {
        map.easeTo({ center: lastFix, zoom: Math.max(map.getZoom(), 17), duration: 900 })
        return
      }
      // Pas encore de fix : on (re)tente — utile après un refus corrigé dans
      // les réglages iOS, ou pendant l'attente du premier fix.
      denied = false
      startWatch()
      toast.message('Recherche de votre position…', {
        description: 'Autorisez la localisation si rien ne vient.',
      })
    })
    const locateCtl: maplibregl.IControl = {
      onAdd: () => {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        div.appendChild(locateBtn)
        return div
      },
      onRemove: () => locateBtn.parentElement?.remove(),
    }
    map.addControl(locateCtl, 'top-right')

    map.on('load', () => {
      // Repère : premier calque de texte (labels) — l'ortho s'insère juste en
      // dessous (les noms de rues restent lisibles par-dessus la photo).
      const layers = map.getStyle().layers ?? []
      const firstSymbol = layers.find((l) => l.type === 'symbol')
      const beforeLabels = firstSymbol?.id

      // La vue Plan a été retirée (25/07) : la photo est PERMANENTE. Le style
      // Plan IGN entremêle textes et tracés — ~370 couches non-texte rendues
      // APRÈS le premier symbol passeraient par-dessus l'ortho (rubans de
      // routes opaques, lacs aplats) : masquées définitivement, ainsi que les
      // bâtiments. Les labels reçoivent un halo blanc (illisibles sinon sur
      // la photo). Plus de restauration : il n'y a plus de mode plan.
      const firstSymbolIndex = firstSymbol ? layers.indexOf(firstSymbol) : layers.length
      for (const l of layers.slice(firstSymbolIndex)) {
        if (l.type !== 'symbol') map.setLayoutProperty(l.id, 'visibility', 'none')
      }
      for (const l of layers) {
        const sl = (l as { 'source-layer'?: string })['source-layer']
        if (l.type === 'fill' && typeof sl === 'string' && sl.includes('bati')) {
          map.setLayoutProperty(l.id, 'visibility', 'none')
        }
        if (l.type === 'symbol') {
          try {
            map.setPaintProperty(l.id, 'text-halo-color', 'rgba(255, 255, 255, 0.9)')
            map.setPaintProperty(l.id, 'text-halo-width', 1.2)
          } catch {
            /* couche non modifiable : on ignore */
          }
        }
      }

      // Correction douce, dégressive avec le zoom : la mosaïque IGN est
      // voilée aux zooms moyens mais la photo 20 cm est propre au zoom
      // maison — la sur-corriger la rendait artificielle.
      const orthoPaint = {
        'raster-saturation': ['interpolate', ['linear'], ['zoom'], 13, 0.25, 17, 0.15, 19, 0.08],
        'raster-contrast': ['interpolate', ['linear'], ['zoom'], 13, 0.12, 17, 0.07, 19, 0.03],
        'raster-brightness-max': ['interpolate', ['linear'], ['zoom'], 13, 0.95, 19, 0.99],
      } as maplibregl.RasterLayerSpecification['paint']

      // Affichage UNIQUE : l'ortho IGN — la plus nette gratuite en France
      // (les alternatives HD/Esri ont été testées puis écartées le 25/07).
      map.addSource(ORTHO_SOURCE_ID, orthoWmtsSource)
      map.addLayer(
        { id: ORTHO_LAYER_ID, type: 'raster', source: ORTHO_SOURCE_ID, paint: orthoPaint },
        beforeLabels,
      )

      // Marqueurs (images générées par statut + variantes "a une note").
      const images = generateMarkerImages()
      for (const key of Object.keys(images)) {
        const name = `${MARKER_PREFIX}${key}`
        if (!map.hasImage(name)) map.addImage(name, images[key], { pixelRatio: MARKER_PIXEL_RATIO })
      }

      // Surbrillance de la maison consultée (fiche maison) : contour + voile
      // accent, visibles sur le plan comme sur l'ortho.
      map.addSource(HOUSE_SRC, { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: HOUSE_FILL_LAYER,
        type: 'fill',
        source: HOUSE_SRC,
        paint: { 'fill-color': ACCENT, 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: HOUSE_LINE_LAYER,
        type: 'line',
        source: HOUSE_SRC,
        paint: { 'line-color': ACCENT, 'line-width': 2.5 },
      })

      // Pans de toiture mesurés (au-dessus de la surbrillance maison, sous les
      // marqueurs ajoutés ensuite). Couleur portée par chaque feature.
      map.addSource(PANS_SRC, { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: PANS_FILL_LAYER,
        type: 'fill',
        source: PANS_SRC,
        // Aplat léger : le toit photo reste lisible dessous, c'est le contour
        // qui structure (retour captures briac).
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.24 },
      })
      map.addLayer({
        id: PANS_LINE_LAYER,
        type: 'line',
        source: PANS_SRC,
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 },
      })

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
          // Clé = id + total + POSITION : après un changement de filtre, un
          // cluster_id réutilisé au même effectif gardait un badge à une
          // position obsolète, avec un zoom de tap incohérent (audit).
          const key = `${p.cluster_id}:${p.point_count}:${coords[0].toFixed(5)}:${coords[1].toFixed(5)}`
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
          'icon-image': [
            'concat',
            MARKER_PREFIX,
            ['get', 'status'],
            ['case', ['get', 'has_note'], NOTE_SUFFIX, ''],
          ],
          // Continue de grossir aux zooms "toit" (le marqueur reste proportionné
          // à la maison quand on est proche).
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1, 19, 1.25],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-anchor': 'center',
        },
      })

      // Point de position AU-DESSUS des marqueurs (« où suis-je » doit rester
      // trouvable) — un fix a pu arriver avant le chargement du style.
      map.addSource(USER_SRC, { type: 'geojson', data: userFC() })
      map.addLayer({
        id: USER_HALO_LAYER,
        type: 'circle',
        source: USER_SRC,
        paint: {
          'circle-radius': 13,
          'circle-color': USER_BLUE,
          'circle-opacity': 0.18,
        },
      })
      map.addLayer({
        id: USER_DOT_LAYER,
        type: 'circle',
        source: USER_SRC,
        paint: {
          'circle-radius': 6.5,
          'circle-color': USER_BLUE,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      })

      setMapLoaded(true)
    })

    // Curseur "main" au survol des marqueurs (les donuts sont des éléments
    // DOM avec leur propre curseur).
    const hover = (cursor: string) => () => {
      map.getCanvas().style.cursor = cursor
    }
    map.on('mouseenter', MARKERS_LAYER, hover('pointer'))
    map.on('mouseleave', MARKERS_LAYER, hover(''))

    const cancelPendingPreview = () => {
      if (pendingPreviewRef.current !== null) {
        window.clearTimeout(pendingPreviewRef.current)
        pendingPreviewRef.current = null
        return true
      }
      return false
    }

    // Clic : marqueur -> fiche point ; zone vide -> ferme ce qui est ouvert,
    // sinon ouvre la FICHE MAISON (infos avant prospection) au zoom maison.
    // Le zoom sur une bulle est géré par le donut lui-même (élément DOM).
    map.on('click', (e) => {
      // En mode visée ou en plein drag, le tap ne sert qu'à naviguer.
      if (placingRef.current || dragRef.current) return

      // 2e tap rapproché = double-tap (zoom) : annule la fiche en attente.
      const wasPending = cancelPendingPreview()

      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const hits = map.getLayer(MARKERS_LAYER)
        ? map.queryRenderedFeatures(bbox, { layers: [MARKERS_LAYER] })
        : []

      const marker = hits.find((f) => f.layer.id === MARKERS_LAYER)
      if (marker) {
        setHousePreview(null)
        setSelectedId(marker.properties?.id as string)
        return
      }

      // Un tap dans le vide ferme d'abord ce qui est ouvert.
      if (selectedIdRef.current) {
        setSelectedId(null)
        return
      }
      if (housePreviewRef.current) {
        setHousePreview(null)
        return
      }

      // Zone vide juste après un tap annulé : c'était un double-tap-zoom.
      if (wasPending) return
      if (map.getZoom() < PREVIEW_MIN_ZOOM) return

      // Ouverture différée : un double-tap dans l'intervalle l'annule.
      const { lng, lat } = e.lngLat
      pendingPreviewRef.current = window.setTimeout(() => {
        pendingPreviewRef.current = null
        // Le mode visée a pu s'ouvrir pendant le délai (tap puis FAB « + ») :
        // la fiche maison ne doit pas surgir par-dessus le réticule (audit).
        if (placingRef.current) return
        setHousePreview({ lng, lat })
      }, PREVIEW_DELAY)
    })

    map.on('dblclick', cancelPendingPreview)

    return () => {
      cancelPendingPreview()
      stopWatch()
      document.removeEventListener('visibilitychange', onVisibility)
      watchCtlRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Pose un point (UI optimiste + toast "Annuler"), puis enchaîne : RDV pris
  // -> formulaire de rendez-vous ; autres statuts -> fiche du point (contexte
  // à chaud). Utilisé par le réticule ET par la fiche maison.
  const poseAt = (lng: number, lat: number, status: PointStatus) => {
    // Profil pas (encore) chargé alors que Supabase est configuré : la pose
    // partirait en « mode local » silencieux — point PERDU au rafraîchissement
    // (audit, bloquant). On refuse plutôt que de mentir.
    if (isSupabaseConfigured && !profile) {
      toast.error('Connexion en cours, réessayez dans un instant')
      return
    }
    // Un filtre actif qui masquerait le point tout juste posé = risque de
    // double pose (audit) : on l'assouplit. Le filtre d'ancienneté exclut par
    // construction un point qu'on vient de visiter.
    if (ageFilter !== null) setAgeFilter(null)
    if (dueOnly) setDueOnly(false) // un point tout juste posé n'a pas de relance due
    if (statusFilter.size > 0 && !statusFilter.has(status)) setStatusFilter(new Set())
    const { point, saved } = addPoint(lng, lat, status)
    // La fiche ne s'ouvre PLUS après chaque pose (audit UX A1 : 3 taps pour
    // un « Absent », ×40-60 par tournée) — le toast sert de filet : Annuler,
    // et « + Note » pour ouvrir la fiche seulement quand on a quelque chose
    // à dire. DEUX exceptions enchaînent d'office : « RDV pris » (formulaire
    // RDV — un RDV sans date ne sert à rien) et « Client » (fiche du point
    // sur la section Client — le statut n'a aucun intérêt sans le nom et la
    // note, retour briac 29/07 ; la pose écrit `ancien_client`, jamais
    // `vendu` — la vente n'arrive que par l'issue RDV).
    const chained = status === 'rdv_pris' || status === 'ancien_client'
    toast.success(`Point posé : ${STATUS_BY_VALUE[status].label}`, {
      cancel: {
        label: 'Annuler',
        onClick: () =>
          void removePoint(point.id).catch((e) => {
            console.error('Annulation du point :', e)
            toast.error('Annulation impossible : vérifiez le réseau')
          }),
      },
      action: chained
        ? undefined
        : {
            label: '+ Note',
            onClick: () =>
              void saved.then((created) => {
                if (created && activeRef.current) setSelectedId(created.id)
              }),
          },
    })
    void saved.then((created) => {
      if (!created) return
      // L'insert peut se confirmer APRÈS un changement d'onglet : ne pas
      // faire surgir le formulaire RDV par-dessus l'Agenda (audit).
      if (!activeRef.current) return
      if (status === 'rdv_pris' && isSupabaseConfigured)
        setRdvTarget({ point: created, existing: null })
      if (status === 'ancien_client') setSelectedId(created.id)
    })
  }

  // Appui long (~550 ms, doigt quasi immobile) sur un de SES marqueurs →
  // drag : le pan de la carte est suspendu, un fantôme du point suit le
  // doigt, le relâcher écrit la nouvelle position (avec « Annuler »).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    let timer: number | undefined
    let start: { x: number; y: number } | null = null
    let candidate: MapPoint | null = null
    const clear = () => {
      window.clearTimeout(timer)
      timer = undefined
      start = null
      candidate = null
    }

    const beginDrag = () => {
      const pt = candidate
      timer = undefined
      if (!pt) return
      navigator.vibrate?.(30)
      map.dragPan.disable() // le doigt déplace le POINT, plus la carte
      const el = document.createElement('div')
      el.className = 'drag-ghost'
      // Le VRAI marqueur suit le doigt (retour briac 25/07), pas un rond plat.
      el.style.backgroundImage = `url(${markerDataUrl(pt.status)})`
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .addTo(map)
      dragRef.current = { point: pt, marker }
      setSelectedId(null)
      setHousePreview(null)
      setDragId(pt.id) // masque l'original pendant le drag
    }

    const finishDrag = () => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      map.dragPan.enable()
      const dropped = d.marker.getLngLat()
      d.marker.remove()
      setDragId(null)
      // Lâché quasi sur place : simple appui long raté, pas d'écriture.
      const from = map.project([d.point.lng, d.point.lat])
      const to = map.project(dropped)
      if (Math.hypot(to.x - from.x, to.y - from.y) < 10) return
      const prev = { lng: d.point.lng, lat: d.point.lat }
      updatePoint(d.point.id, { lng: dropped.lng, lat: dropped.lat })
        .then(() =>
          toast.success('Point déplacé', {
            action: {
              label: 'Annuler',
              onClick: () =>
                void updatePoint(d.point.id, prev).catch((e) => {
                  console.error('Retour du point :', e)
                  toast.error('Impossible de revenir en arrière : vérifiez le réseau')
                }),
            },
          }),
        )
        .catch((e) => {
          console.error('Déplacement du point :', e)
          toast.error('Déplacement impossible : réseau, ou point d’un autre commercial')
        })
    }

    const onDown = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (placingRef.current || dragRef.current) return
      if (!map.getLayer(MARKERS_LAYER)) return
      const bbox: [[number, number], [number, number]] = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const hit = map.queryRenderedFeatures(bbox, { layers: [MARKERS_LAYER] })[0]
      if (!hit) return
      const pt = pointsRef.current.find((p) => p.id === (hit.properties?.id as string))
      if (!pt || pt.id.startsWith('temp-')) return
      const prof = profileRef.current
      // Seul l'auteur (ou un superviseur) peut déplacer — même règle que la RLS.
      if (!prof || (!isSupervisorRole(prof.role) && pt.created_by !== null && pt.created_by !== prof.id))
        return
      clear()
      candidate = pt
      start = { x: e.point.x, y: e.point.y }
      timer = window.setTimeout(beginDrag, 550)
    }
    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const d = dragRef.current
      if (d) {
        d.marker.setLngLat(e.lngLat)
        return
      }
      // Tolérance de tremblement AVANT le déclenchement : > 8 px = pan voulu.
      if (timer !== undefined && start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 8) {
        clear()
      }
    }
    const onUp = () => {
      if (dragRef.current) finishDrag()
      else clear()
    }
    map.on('touchstart', onDown)
    map.on('mousedown', onDown)
    map.on('touchmove', onMove)
    map.on('mousemove', onMove)
    map.on('touchend', onUp)
    map.on('touchcancel', onUp)
    map.on('mouseup', onUp)
    return () => {
      clear()
      // Démontage en plein drag : on nettoie sans écrire.
      if (dragRef.current) {
        dragRef.current.marker.remove()
        dragRef.current = null
        map.dragPan.enable()
      }
      map.off('touchstart', onDown)
      map.off('mousedown', onDown)
      map.off('touchmove', onMove)
      map.off('mousemove', onMove)
      map.off('touchend', onUp)
      map.off('touchcancel', onUp)
      map.off('mouseup', onUp)
    }
  }, [mapLoaded, updatePoint])

  // Suit le zoom pendant la visée : grise « Poser ici » sous le seuil.
  useEffect(() => {
    const map = mapRef.current
    if (!placing || !map) return
    const update = () => setPlaceZoomOk(map.getZoom() >= PLACE_MIN_ZOOM)
    update()
    map.on('zoom', update)
    return () => {
      map.off('zoom', update)
    }
  }, [placing])

  // Pose le point sous le réticule.
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
    poseAt(lng, lat, activeStatus)
    setPlacing(false)
  }

  // Charge les infos de la maison consultée (cache mémoire côté data/enrich).
  useEffect(() => {
    if (!housePreview) {
      setHouseInfo(null)
      setHouseAddress(null)
      setHouseLidar(null)
      return
    }
    let alive = true
    setHouseInfo(null)
    setHouseAddress(null)
    setHouseLidar(null)
    void import('../data/enrich')
      .then((m) => m.fetchHouseInfo(housePreview.lng, housePreview.lat))
      .then((info) => {
        if (alive) setHouseInfo(info)
      })
      .catch((e) => console.error('Fiche maison :', e))
    // Mesure LiDAR en parallèle (chunk séparé, cache par coordonnées : poser
    // le point après consultation réutilise ce calcul).
    void import('../data/lidar')
      .then((m) => m.fetchHouseLidar(housePreview.lng, housePreview.lat))
      .then((r) => {
        if (alive) setHouseLidar(r)
      })
      .catch((e) => console.error('Mesure LiDAR :', e))
    void reverseGeocode(housePreview.lng, housePreview.lat).then((label) => {
      if (alive && label) setHouseAddress(label)
    })
    return () => {
      alive = false
    }
  }, [housePreview])

  // Surbrillance du polygone de la maison consultée.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource(HOUSE_SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    if (housePreview && houseInfo?.geometry) {
      src.setData({ type: 'Feature', geometry: houseInfo.geometry, properties: {} })
    } else {
      src.setData(EMPTY_FC)
    }
  }, [housePreview, houseInfo, mapLoaded])

  // Pans du point sélectionné : le SELECT global ne transporte plus le jsonb
  // des contours (poids) — récupérés à la demande à l'ouverture de la fiche
  // (cache côté data/points, rafraîchi par le temps réel). Les inserts et
  // updates realtime des AUTRES points ne redessinent plus rien (la référence
  // ne change pas), fini le clignotement des pastilles.
  const [selPans, setSelPans] = useState<RoofData | null>(null)
  useEffect(() => {
    const sel = selectedId ? (points.find((p) => p.id === selectedId) ?? null) : null
    if (!sel || sel.toit_lidar_statut !== 'ok') {
      setSelPans(null)
      return
    }
    // Ligne realtime (complète) : les pans sont déjà là. Sinon : fetch ciblé.
    if (sel.toit_lidar_pans) {
      setSelPans(sel.toit_lidar_pans)
      return
    }
    let alive = true
    fetchPointPans(sel.id)
      .then((ps) => {
        if (alive) setSelPans(ps)
      })
      .catch((e) => console.error('Pans du point :', e))
    return () => {
      alive = false
    }
  }, [selectedId, points])

  // Pans de toiture mesurés : dessinés quand la fiche d'une maison mesurée
  // est ouverte (fiche avant prospection OU fiche d'un point), avec une
  // pastille « XX m² » par pan (marqueurs DOM : police et tokens de la DA).
  const panLabelsRef = useRef<maplibregl.Marker[]>([])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource(PANS_SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    for (const m of panLabelsRef.current) m.remove()
    panLabelsRef.current = []

    let pans: LidarPan[] | null = null
    if (housePreview) {
      if (houseLidar?.toit_lidar_statut === 'ok') pans = houseLidar.toit_lidar_pans?.pans ?? null
    } else {
      pans = selPans?.pans ?? null
    }
    // La surbrillance bleue de la maison ferait double emploi sous les pans.
    const houseSrc = map.getSource(HOUSE_SRC) as maplibregl.GeoJSONSource | undefined
    // Seuls les pans significatifs sont dessinés : les miettes (< 10 m²)
    // restent comptées dans le badge total mais morcelaient la lecture.
    // Index ORIGINAL conservé : même couleur qu'en 3D et sur le plan (A21).
    const drawable = (pans ?? [])
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.contour && p.contour.length >= 4 && p.m2 >= 10)
    if (!drawable.length) {
      src.setData(EMPTY_FC)
      return
    }
    src.setData({
      type: 'FeatureCollection',
      features: drawable.map(({ p, idx }) => ({
        type: 'Feature',
        properties: { color: PAN_COLORS[idx % PAN_COLORS.length] },
        geometry: { type: 'Polygon', coordinates: [p.contour!] },
      })),
    })
    if (housePreview) houseSrc?.setData(EMPTY_FC)
    // Pastilles selon le zoom (audit UX A31) : dézoomées, les pastilles à
    // taille fixe s'empilaient en tas illisible SUR le toit — sous ~17,5 une
    // seule pastille Σ au centroïde, le détail par pan au-delà.
    const drawLabels = () => {
      for (const m of panLabelsRef.current) m.remove()
      panLabelsRef.current = []
      const centres = drawable.filter(({ p }) => p.centre)
      if (!centres.length) return
      if (map.getZoom() < 17.5 && centres.length > 1) {
        const total = Math.round(centres.reduce((s, { p }) => s + p.m2, 0))
        const cx = centres.reduce((s, { p }) => s + p.centre![0], 0) / centres.length
        const cy = centres.reduce((s, { p }) => s + p.centre![1], 0) / centres.length
        const el = document.createElement('div')
        el.className = 'pan-chip tnum'
        el.textContent = `Σ ${total} m²`
        panLabelsRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([cx, cy]).addTo(map),
        )
        return
      }
      for (const { p, idx } of centres) {
        const el = document.createElement('div')
        el.className = 'pan-chip tnum'
        el.textContent = `${p.m2} m²`
        el.style.borderColor = PAN_COLORS[idx % PAN_COLORS.length]
        panLabelsRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat(p.centre!).addTo(map),
        )
      }
    }
    drawLabels()
    map.on('zoomend', drawLabels)
    return () => {
      map.off('zoomend', drawLabels)
    }
    // houseInfo dans les deps : si la surbrillance bleue arrive APRÈS la
    // mesure, ce nettoyage doit rejouer.
  }, [housePreview, houseInfo, houseLidar, selPans, mapLoaded])

  // Met à jour la source GeoJSON quand la liste de points ou le filtre change
  // OU quand la carte devient prête (évite le 1er rendu manqué si les points
  // arrivent avant). Filtre appliqué à la SOURCE : les bulles de regroupement
  // restent cohérentes avec ce qui est affiché.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const source = map.getSource(POINTS_SOURCE) as maplibregl.GeoJSONSource | undefined
    const cutoff = ageFilter !== null ? Date.now() - ageFilter * 86_400_000 : null
    const today = localDayKey(new Date()) // relances dues = revisit_at ≤ aujourd'hui
    const visible = points.filter(
      (p) =>
        // Carte privée : le commercial ne voit que SES points (les temp-
        // locaux, created_by null, sont forcément à lui) ; le superviseur
        // voit tout, filtrable par commercial.
        p.id !== dragId && // l'original est masqué pendant le drag (fantôme au doigt)
        (isSupervisor
          ? whoFilter.size === 0 || p.created_by === null || whoFilter.has(p.created_by)
          : p.created_by === null || p.created_by === profile?.id) &&
        (statusFilter.size === 0 || statusFilter.has(p.status)) &&
        (cutoff === null || (p.visited_at !== null && Date.parse(p.visited_at) < cutoff)) &&
        (!dueOnly || (p.status === 'a_revoir' && p.revisit_at !== null && p.revisit_at <= today)),
    )
    source?.setData(toFeatureCollection(visible))
  }, [points, mapLoaded, statusFilter, ageFilter, whoFilter, dueOnly, isSupervisor, profile?.id, dragId])

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
  // Vrai quand un flyTo "focus" (venu de l'agenda) gère déjà la caméra : le
  // recadrage de sélection ne doit pas l'interrompre.
  const skipRecenterRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (skipRecenterRef.current) {
      skipRecenterRef.current = false
      return
    }
    const pt = selectedId ? pointsRef.current.find((p) => p.id === selectedId) : null
    // La fiche maison (avant prospection) recadre aussi : sans mouvement de
    // caméra, la sheet recouvrait la maison tapée et sa surbrillance — on ne
    // pouvait pas vérifier QUELLE maison la fiche décrit avant de poser.
    const target = pt ?? housePreview
    if (target) {
      // rAF : laisse la sheet se monter pour mesurer sa hauteur réelle.
      const raf = requestAnimationFrame(() => {
        map.easeTo({
          center: [target.lng, target.lat],
          padding: { top: 0, bottom: sheetPadding(), left: 0, right: 0 },
          duration: 350,
        })
      })
      return () => cancelAnimationFrame(raf)
    }
    map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 250 })
  }, [selectedId, housePreview, mapLoaded])

  // « Voir sur la carte » depuis l'agenda : vole vers le point et le sélectionne.
  useEffect(() => {
    const map = mapRef.current
    if (!focus || !map || !mapLoaded) return
    skipRecenterRef.current = true
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: 18,
      padding: { top: 0, bottom: sheetPadding(), left: 0, right: 0 },
    })
    setSelectedId(focus.pointId)
    onFocusHandled?.()
  }, [focus, mapLoaded, onFocusHandled])

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

      {!placing && (
        <>
          {filtersOpen && (
          <div className="map-filterbar">
            <div className="map-filterrow">
              {DISPLAY_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`chip ${statusFilter.has(s.value) ? 'is-active' : ''}`}
                  style={{ ['--chip' as string]: s.color }}
                  onClick={() =>
                    setStatusFilter((prev) => {
                      const next = new Set(prev)
                      // La chip « Client » couvre les DEUX valeurs (fusion
                      // 29/07) : vendu et ancien_client entrent/sortent
                      // ensemble, le test `.has(p.status)` reste trivial.
                      const vals = isClientStatus(s.value) ? CLIENT_STATUSES : [s.value]
                      if (next.has(s.value)) vals.forEach((v) => next.delete(v))
                      else vals.forEach((v) => next.add(v))
                      return next
                    })
                  }
                >
                  <img className="chip-marker" src={markerDataUrl(s.value)} alt="" />
                  {s.label}
                </button>
              ))}
            </div>
            {/* Superviseur : filtre par commercial (décision chef des ventes). */}
            {isSupervisor && orgProfiles.length > 1 && (
              <div className="map-filterrow">
                {orgProfiles.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    className={`chip ${whoFilter.has(op.id) ? 'is-active' : ''}`}
                    style={{ ['--chip' as string]: colorForCommercial(op.id, op.color) }}
                    onClick={() =>
                      setWhoFilter((prev) => {
                        const next = new Set(prev)
                        if (next.has(op.id)) next.delete(op.id)
                        else next.add(op.id)
                        return next
                      })
                    }
                  >
                    <span
                      className="chip-dot"
                      style={{ background: colorForCommercial(op.id, op.color) }}
                    />
                    {(op.full_name ?? 'Commercial').split(/\s/)[0]}
                  </button>
                ))}
              </div>
            )}
            <div className="map-filterrow">
              {/* Relances dues (revisit_at atteint) — audit UX B6. */}
              <button
                type="button"
                className={`chip ${dueOnly ? 'is-active' : ''}`}
                onClick={() => setDueOnly((v) => !v)}
                title="Points « à revoir » dont la date de relance est atteinte"
              >
                <BellRing size={13} strokeWidth={2} /> À relancer
              </button>
              {(
                [
                  [14, '> 2 sem'],
                  [30, '> 1 mois'],
                  [90, '> 3 mois'],
                ] as [number, string][]
              ).map(([days, label]) => (
                <button
                  key={days}
                  type="button"
                  className={`chip ${ageFilter === days ? 'is-active' : ''}`}
                  onClick={() => setAgeFilter((prev) => (prev === days ? null : days))}
                  title={`Dernière visite il y a plus de ${label.slice(2)}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          )}
          {/* Filtres en zone pouce, empilés sur le FAB (audit UX A14) : le
              toggle vivait en haut à droite, ses chips apparaissent en bas. */}
          <button
            type="button"
            className={`map-fab-filters ${filtersOpen || nFilters > 0 ? 'is-on' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label="Filtrer (statut, ancienneté)"
          >
            <SlidersHorizontal size={20} strokeWidth={1.8} />
            {nFilters > 0 && <span className="map-fab-badge tnum">{nFilters}</span>}
          </button>
          <button
            type="button"
            className="map-fab"
            onClick={() => {
              setHousePreview(null)
              // Sous le zoom de pose, on rapproche AVANT d'ouvrir le réticule
              // (audit UX A34 : l'erreur ne tombait qu'après avoir visé).
              const m = mapRef.current
              if (m && m.getZoom() < PLACE_MIN_ZOOM) m.easeTo({ zoom: 16.5, duration: 450 })
              setPlacing(true)
            }}
            aria-label="Poser un point"
          >
            <Plus size={26} strokeWidth={2.2} />
          </button>
        </>
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
            <p className="eyebrow place-hint">Déplacez la carte : la maison sous le viseur</p>
            <StatusPicker active={activeStatus} onChange={setActiveStatus} />
            <div className="place-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPlacing(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmPlace}
                disabled={!placeZoomOk}
              >
                {placeZoomOk ? 'Poser ici' : 'Zoomez pour viser'}
              </button>
            </div>
          </div>
        </>
      )}


      {housePreview && (
        <HousePreviewSheet
          open
          address={houseAddress}
          coords={housePreview}
          info={houseInfo}
          lidar={houseLidar}
          activeStatus={activeStatus}
          onStatusChange={setActiveStatus}
          onOpenChange={(o) => !o && setHousePreview(null)}
          onPose={(status) => {
            poseAt(housePreview.lng, housePreview.lat, status)
            setHousePreview(null)
          }}
        />
      )}

      <PointDetailSheet
        open={selectedPoint !== null}
        point={selectedPoint ?? lastSelectedRef.current}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onUpdate={updatePoint}
        onAddNote={addNote}
        onDelete={removePoint}
        onRdvNeeded={(p, existing) =>
          isSupabaseConfigured && setRdvTarget({ point: p, existing: existing ?? null })
        }
        apptsVersion={apptSeq}
      />

      {rdvTarget && profile && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setRdvTarget(null)}
          profile={profile}
          // Mode ÉDITION quand la fiche a demandé un décalage (« Modifier »
          // du bloc RDV) — sinon création liée au point, comme avant.
          existing={rdvTarget.existing ?? undefined}
          pointId={rdvTarget.point.id}
          coords={{ lng: rdvTarget.point.lng, lat: rdvTarget.point.lat }}
          pointNote={rdvTarget.point.note}
          defaultClientName={rdvTarget.point.client_name}
          defaultClientPhone={rdvTarget.point.client_phone}
          onSaved={() => {
            setRdvTarget(null)
            setApptSeq((s) => s + 1)
          }}
        />
      )}
    </div>
  )
}
