# Étude — Données maison : âge, matériau de toiture, mesure de toiture (juillet 2026)

> Recherche menée par 3 sous-agents (17/07/2026), API testées en conditions réelles.
> Question : peut-on obtenir automatiquement, depuis les coordonnées d'une maison :
> (1) l'année de construction, (2) le matériau de toiture, (3) la surface de toiture ?
> **Réponse : OUI aux trois, en open data gratuit, sans clé API pour l'essentiel.**

## 1. Année de construction → BDNB (CSTB) ✅

- **Source** : BDNB (Base de Données Nationale des Bâtiments, CSTB) — redistribue en
  Licence Ouverte 2.0 la variable fiscale `jannath` des Fichiers fonciers.
  **Remplie à 99,9 % pour les maisons individuelles.**
- **API testée, sans clé** (offre Open ~10 000 req/mois) :
  - Par bbox (coordonnées **Lambert-93 EPSG:2154** obligatoires — conversion proj4js côté client) :
    `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox?xmin=…&ymin=…&xmax=…&ymax=…`
  - Par adresse BAN (la `cle_interop` = l'`id` de notre géocodeur BAN) via la table
    `rel_batiment_groupe_adresse` (le filtre BAN direct sur `batiment_groupe_complet` → erreurs 500).
- **Bonus dans la même réponse** : `mat_toit_txt` (ex. "TUILES"), `classe_bilan_dpe` (DPE !),
  `nb_niveau`, surface d'emprise, adresse BAN.
- **Caveats** : pics artificiels sur 1900, 1970, 2002-2003 (valeurs par défaut MAJIC) →
  afficher « construite vers ~1972 », se méfier des années rondes.
- **Fallback** : DPE ADEME (`dpe03existant`, API data-fair sans clé, champ `periode_construction`,
  couverture partielle — logements ayant eu un DPE depuis 2021).
- **Écartés** : Fichiers fonciers bruts (réservés aux acteurs publics), BD TOPO (pas d'année),
  RNB (pivot d'identifiants seulement).
- **Phase 2 (SaaS)** : import open data BDNB par département dans PostGIS (millésimes ~2/an).

## 2. Matériau de toiture → BD TOPO IGN ✅

- **Source** : champ `materiaux_de_la_toiture` (Shapefile `MAT_TOITS`) du thème Bâtiment
  BD TOPO — c'est le `dmatto` fiscal. **96,7 % de remplissage pour les maisons**
  (84,5 % tous bâtiments). Tests réels : Cesson-Sévigné 80/80 remplis (77 ardoise),
  Tournefeuille 37/40 (35 tuiles).
- **Nomenclature** (1er chiffre = matériau principal) : 0 indéterminé · **1 tuiles** ·
  **2 ardoises** · **3 zinc/alu** · 4 béton · 9 autres. Ex. `20` = ardoise, `13` = tuiles+zinc.
  ⚠️ Pas de code fibrociment : un `40`/`90` sur un pavillon 1960-80 = signal
  « fibrociment/amiante possible » (angle métier).
- **Accès testé, sans clé, ~200 ms** (WFS Géoplateforme, Licence Ouverte) :
  `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&COUNT=1&outputFormat=application/json&CQL_FILTER=INTERSECTS(geometrie,POINT({lat} {lng}))`
  (⚠️ ordre **lat lng** dans le POINT). Bonus même réponse : `materiaux_des_murs`,
  `hauteur`, `altitude_minimale_toit`, `altitude_maximale_toit`, `nombre_d_etages`, `usage_1`.
- **PAS dans nos tuiles plan_ign** (vérifié dans le metadata.json : `bati_surf` ne porte que
  alti_sol/hauteur/isole/niveau/symbo) → le WFS est obligatoire.
- **Caveats** : donnée déclarative fiscale, souvent figée à la construction (toiture rénovée =
  ancien code possible) → afficher « (probable) ». Fallback régional si vide
  (Bretagne → ardoise probable, Sud → tuile).

## 3. Mesure de toiture → BD TOPO (MVP) puis LiDAR HD / Solar API ✅

- **MVP (±10-15 %, suffisant pour une fourchette de prix)** :
  1. Emprise au sol : `turf.area()` sur le polygone `bati_surf` (déjà dans nos tuiles).
  2. Pente réelle : la MÊME réponse WFS BD TOPO donne `altitude_maximale_toit` (faîtage)
     et `altitude_minimale_toit` (gouttière) → comble = différence ; avec la demi-largeur
     du polygone : `pente = atan(comble / (largeur/2))` → **surface = emprise / cos(pente)**.
  3. Fallback forfait ×1,18 si altitudes absentes. Option : UI de correction (retracer le
     polygone sur l'ortho + slider de pente 25/35/45°).
- **Étape 2a — Google Solar API** (~1 jour) : `buildingInsights:findClosest` → pans détaillés
  (`pitchDegrees`, `azimuthDegrees`, `areaMeters2`). France couverte, 10 000 req/mois
  gratuites puis ~5 $/1000. Dépendance Google + clé (proxy Edge Function). Restrictions EEA
  07/2025 : ne touchent pas les roofSegmentStats. Vérifier conditions de cache avant de stocker.
- **Étape 2b — MNS LiDAR HD IGN** (~3-5 jours, souverain, ±5-10 %) : le WMS-Raster
  Géoplateforme sert le MNS en **GeoTIFF float32 à la demande** sur une bbox (~16 Ko/toit,
  testé) : couche `IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G`, décodage
  geotiff.js, gradient par pixel → pente par pan. Couverture ~80 % métropole fin 2025,
  100 % fin 2026. Fallback : MNS corrélé `HIGHRES.MNS`.
- **Écartés** : EagleView/Roofr/Hover (US seulement), cadastres solaires FR (B2B sans API
  publique), RGE ALTI (MNT terrain nu, inutile pour les toits).

## Architecture recommandée (convergence des 3 sujets)

À la pose d'un point (ou au 1er affichage de la fiche), **2 appels en arrière-plan** :
1. **WFS BD TOPO** (sans clé) → matériau toiture + altitudes toit (→ pente/surface) + hauteur + murs.
2. **API BDNB** (sans clé, quota 10 k/mois) → année de construction + DPE + confirmation matériau.

→ Persister sur la ligne `points` (migration : `annee_construction`, `mat_toit`, `toit_surface_m2`,
`dpe`…) : un seul appel par maison, cache définitif, stats manager gratuites.
Fiche maison cible : « Construite vers ~1972 · Toiture ardoise (probable) · ~120 m² de toit · DPE E ».
CORS à vérifier en prod ; sinon proxy Edge Function Supabase.
