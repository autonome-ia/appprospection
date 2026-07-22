# Étude — une vue satellite plus belle (juillet 2026)

> Chantier : la vue « Toits » (ortho IGN) est jugée pas assez belle par briac et le chef des ventes.
> Deux volets : (1) tests empiriques menés en local sur les tuiles réelles, (2) rapport de recherche
> web (sous-agent, sources officielles 2026) comparant IGN optimisé / Mapbox / Apple MapKit / autres.
> Complète `etude-cartographie.md` (choix initial de la stack carto).

## TL;DR — décisions

1. **Étape 1 (faite, gratuite)** : réparer le rendu IGN — `maxzoom` 21→19 (le natif réel),
   masquage en mode Toits du voile papier et des ~370 tracés du plan dessinés **par-dessus** la
   photo (routes en rubans, lacs en aplats), variante « retina » WMS 512 px testable via
   `?ortho=wms2x`, corrections paint adoucies et dégressives avec le zoom.
2. **Étape 2 (à faire)** : POC **Mapbox Satellite en source raster dans MapLibre** (autorisé
   officiellement, 750k tuiles/mois gratuites, tuiles @2x nettes sur mobile, couleurs corrigées).
   Comparaison côte à côte sur les zones réellement prospectées, verdict du chef des ventes.
3. **Apple MapKit JS** : pas totalement écarté (palier gratuit énorme : 250k vues/jour, 99 $/an),
   mais ses CGU interdisent de consommer les tuiles hors SDK Apple → il faudrait **remplacer
   MapLibre** (1-2 semaines de réécriture, perte 3D custom/Plan IGN vectoriel/symbol layers), pour
   un gain non démontré en pavillonnaire breton (la THR Apple est concentrée sur ~350 villes).
   À ne tenter que si l'étape 1 ET le POC Mapbox déçoivent, après un test visuel sur
   [maps.apple.com](https://maps.apple.com) au-dessus des zones de prospection.

---

## Volet 1 — Tests empiriques (tuiles réelles, secteur Lesneven/Le Folgoët 29)

Méthode : téléchargement direct des tuiles z18/z19/z20 au droit d'un lotissement réellement
prospecté (géocodé via BAN), depuis le WMTS IGN (`ORTHOIMAGERY.ORTHOPHOTOS` et
`HR.ORTHOIMAGERY.ORTHOPHOTOS`), le WMS-Raster IGN et Esri World Imagery ; plus lecture du
GetCapabilities WMTS complet.

**Constats :**

- **Le zoom natif max de l'ortho IGN en Web Mercator est 19** (`TileMatrixSet PM_0_19`, vérifié
  dans le GetCapabilities du jour). L'app déclarait `maxzoom: 21` : aux zooms 20-21 — pile là où
  on inspecte un toit — MapLibre demandait des tuiles inexistantes au lieu d'agrandir proprement
  la z19. L'IGN a retiré la très haute résolution (5 cm) du flux en mars 2025 : la vue s'est
  objectivement dégradée cette année-là, indépendamment de nous.
- **`HR.ORTHOIMAGERY.ORTHOPHOTOS` est identique octet pour octet** à la couche standard en PM :
  aucun gain à en attendre. La variante `HR...L93` monte à 10 cm/z20 mais en Lambert-93,
  projection que MapLibre ne sait pas consommer.
- **La donnée IGN 20 cm est bonne, et meilleure qu'Esri ici** : au même endroit, la tuile Esri
  World Imagery (Maxar) est plus floue, bouchée dans les ombres, et vide au-delà de z19
  (« Map data not yet available »). Le problème n'est pas la source, c'est notre rendu.
- **Le vrai coupable du rendu laiteux était dans notre code** : le voile papier `base-wash`
  (beige, opacité 0,5, ajouté pour faire ressortir les routes du mode plan) était inséré sous les
  routes… donc **au-dessus de l'ortho** dans l'ordre des calques. En mode Toits, toute la photo
  était recouverte d'un voile beige semi-transparent, que les réglages
  `raster-contrast/saturation` tentaient de compenser. Idem pour ~370 couches non-texte du style
  Plan IGN (le style entremêle textes et tracés : tout ce qui est rendu après le premier calque
  texte passait au-dessus de la photo — routes en rubans blancs/jaunes opaques, plans d'eau en
  aplats bleu pâle…).
- **Netteté retina** : le WMTS IGN ne sert que du 256 px (pas de @2x) → sur mobile (DPR 2-3),
  1 pixel d'image est étalé sur 2-3 pixels physiques, d'où le flou perçu. Le **WMS-Raster**
  (`data.geopf.fr/wms-r`) accepte des GetMap 512 px sur les mêmes données → 2 px d'image par px
  CSS. Testé fonctionnel. ⚠️ Réserve : à cette résolution le WMS pioche dans un niveau de
  pyramide dont la colorimétrie/le millésime peut différer localement du niveau z18 WMTS
  (constaté sur la zone de test : rendu plus pâle par endroits) → à valider à l'écran, d'où le
  A/B `?ortho=wms2x` plutôt qu'une bascule aveugle.

**Implémentation étape 1** (`web/src/config/map.ts` + `web/src/components/MapView.tsx`) :
`maxzoom: 19` ; recensement au chargement des couches non-texte situées au-dessus de l'ortho avec
leur visibilité d'origine, masquées en mode Toits et restaurées en mode plan (`base-wash`
compris) ; paint ortho adouci et dégressif avec le zoom (la correction forte devenait artificielle
une fois le voile retiré) ; variante WMS 512 px derrière `?ortho=wms2x`.

**Comment juger** : sur mobile (PWA rechargée), comparer aux zooms 15 / 17 / 19 : les routes
doivent être de la photo (plus de rubans), les couleurs plus franches, et `?ortho=wms2x` doit
être visiblement plus net à z ≤ 18. Envoyer des captures au chef des ventes.

---

## Volet 2 — Rapport du sous-agent (recherche web, juillet 2026)

> Reproduit tel quel. Note : sa lecture du GetCapabilities n'avait pas pu être directe
> (permissions) ; elle a depuis été confirmée par le volet 1 (PM_0_19, HR identique).

### 0. Diagnostic préalable : pourquoi la vue actuelle est floue

Deux causes techniques identifiées, **dont une régression IGN de mars 2025** :

1. **La couche `ORTHOIMAGERY.ORTHOPHOTOS` a été plafonnée au zoom 19 en mars 2025.** L'IGN a
   retiré les images très haute résolution (THR 5-10 cm) du flux et fait passer le TileMatrixSet
   de `PM_0_21` à `PM_0_19` ; les flux `THR.ORTHOIMAGERY.ORTHOPHOTOS` ont été dépubliés fin mai
   2025 (source : actualité Géoservices IGN, 09/07/2025). Or la config déclarait `maxzoom: 21` :
   aux zooms 20-21 — précisément là où on regarde les toits — MapLibre demande des tuiles qui
   n'existent plus et affiche du z19 upscalé ×2 à ×4.
2. **Tuiles 256 px sur écrans mobiles Retina (DPR 2-3)** : chaque pixel de tuile est étalé sur
   2-3 pixels physiques → flou perçu même au zoom natif (issues MapLibre #141, #1257). Le WMTS
   IGN ne sert que du 256 px, mais le **WMS-Raster** (`data.geopf.fr/wms-r`) permet de demander
   des images 512/1024 px sur les mêmes données.

Le « voile laiteux » de la BD ORTHO est, lui, une caractéristique radiométrique du produit
(mosaïque homogénéisée) — les corrections `raster-saturation/contrast` sont la bonne approche,
mais elles ne créeront jamais de détail au-delà des 20 cm/pixel natifs (≈ zoom 19).

### (a) Tableau comparatif

| Option | Qualité image France pavillonnaire (zoom natif max) | Coût 2026 (~5 users) | Coût (~50 users) | Palier gratuit | Licence / EEA / MapLibre | Effort |
|---|---|---|---|---|---|---|
| **1. IGN optimisé** (maxzoom 19 + WMS @2x + paint) | BD ORTHO 20 cm/px, **z19 natif max** (THR retirée en 2025). Voile radiométrique persistant. Millésime : départements bretons refaits tous les 3 ans | **0 €** | **0 €** | Illimité (licence ouverte, sans clé) | Licence ouverte, attribution IGN. MapLibre : natif | **1-2 h**, on garde tout |
| **2. Mapbox Satellite (raster dans MapLibre)** ⭐ | Maxar Vivid 50 cm global + **aérien 15 cm sur ~75 % de la France (490 000 km²)** + Vexcel 10-20 cm sur des villes d'Europe ; couleurs retravaillées, tuiles **@2x (512 px) natives**, tileset servi jusqu'à z22 (détail natif réel ≈ z19-20 selon zones) | **0 €** (≈ 150-250 k tuiles/mois estimées, sous le palier) | ≈ 1,5-2 M tuiles/mois → **~190-310 $/mois** ($0.25/1k au-delà de 750k, dégressif) | **Raster Tiles API : 750 000 tuiles/mois gratuites** | **Officiellement autorisé dans MapLibre** (page Mapbox « Use Mapbox APIs in MapLibre GL JS »). Attribution © Mapbox © Maxar. Pas de restriction EEA connue. Cache persistant interdit | **~1-2 h** : nouvelle source raster, on garde tout |
| **3. Apple MapKit JS** | Imagerie correcte ; la THR (Flyover) est limitée à ~353 villes ; hors de ces zones, résolution standard — **pas de gain démontré en pavillonnaire breton** | 99 $/an (Apple Developer) | 99 $/an | **250 000 map views/jour + 25 000 appels service/jour** | Schedule 6 Apple Developer Agreement : **interdiction d'extraire/cacher les tuiles** → impossibles à consommer dans MapLibre. Il faudrait remplacer le moteur | **1-2 semaines+ de réécriture** : perte extrusion 3D custom, symbol layers WebGL, style Plan IGN |
| **4a. MapTiler Satellite** | En France = **la même ORTHO HR IGN retraitée** (blog MapTiler), z14-18, z19 sur 4 villes → aucun gain de netteté vs IGN direct | Free = non-commercial → **Flex 29 $/mois** minimum | ~29-95 $/mois | 100k requêtes/mois mais usage non commercial uniquement | OK MapLibre, OK EEA | ~1 h, mais sans intérêt qualité |
| **4b. Esri World Imagery** | Maxar Vivid : 30 cm sur certaines parties d'Europe de l'Ouest, sinon 50 cm → **moins détaillé que l'IGN 20 cm** en rural breton (confirmé par test volet 1), millésimes parfois plus frais | **0 €** | **0 €** (sous 2 M tuiles/mois) | **2 M tuiles/mois**, puis $0.15/1k | MapLibre officiellement supporté. Attribution Esri/Maxar. OK EEA | ~1-2 h |
| **4c. Google 2D Satellite Tiles (Map Tiles API)** | **Probablement la plus belle** : aérien Google, zoom natif souvent 20-21 en périurbain | 100k requêtes/mois gratuites ; prix au-delà non vérifié | Quelques dizaines-centaines $/mois — à chiffrer | 100 000 appels/mois/SKU | **Renderer tiers autorisé** (logo Google + attribution viewport API, cache interdit). ⚠️ Satellite réservé à des « specific imagery visualization use cases » → possible validation d'usage. ToS EEA dédiées depuis 07/2025 ; seule la 3D photoréaliste est bloquée. Session tokens obligatoires | **0,5-1 jour**, on garde MapLibre |
| **4d. Azure Maps / HERE** | Bing/Airbus (Pléiades 50 cm, Neo 30 cm), zoom max 19 → pas mieux que l'IGN | $5/1k transactions | idem | faible | OK techniquement | Non compétitif, écarté |
| **4e. Vexcel / Maxar en direct** | Le meilleur du marché (7,5-15 cm) | **Devis uniquement**, ordre de grandeur plusieurs milliers €/an minimum | idem | aucun | — | Hors budget au stade actuel |

### (b) Recommandation

**Étape 0 obligatoire et gratuite : réparer la config IGN** (`maxzoom 21 → 19` ; fait, voir
volet 1). À lui seul ce correctif supprime le « flou sale » des zooms 20-21, mais ne rend pas la
BD ORTHO « belle » : plafond physique à 20 cm/px + voile radiométrique.

**Recommandation principale : Mapbox Satellite en source raster dans MapLibre** ⭐
- **Beauté** : imagerie color-corrected (fini le voile laiteux), tuiles @2x natives (nettes sur
  Retina, ce que le WMTS IGN ne sait pas faire), aérien 15 cm sur ~75 % de la France, overzoom
  fluide jusqu'à z22.
- **Coût** : 750 000 tuiles/mois gratuites — à 5 commerciaux, 0 €. À ~50 users : ~200-300 $/mois
  (à renégocier à ce stade, ou basculer une partie du trafic sur Esri/IGN).
- **Licence** : usage dans MapLibre documenté officiellement par Mapbox ; contrepartie =
  facturation à la tuile + attribution + pas de cache persistant. Pas de blocage EEA.
- **Effort** : ~10 lignes. On garde MapLibre, le Plan IGN vectoriel, les marqueurs, le
  clustering, la 3D, la BAN, les drawers. Zéro régression fonctionnelle.

**Compromis honnête** : en Bretagne rurale, la source sous-jacente de Mapbox est en partie…
l'ortho IGN open data retraitée. Le gain garanti = colorimétrie + netteté Retina + overzoom
propre ; le gain de résolution *native* dépend de la commune. Le millésime peut aussi être plus
ancien que le dernier millésime IGN du département. **Valider visuellement sur 3-4 zones réelles
avant de généraliser** (un token gratuit suffit).

**Replis si Mapbox déçoit** : Google 2D Satellite Tiles via Map Tiles API dans MapLibre
(imagerie quasi certainement la plus belle, intégration 0,5-1 j, validation d'usage possible) ;
puis Esri World Imagery (gratuit, 2 M tuiles/mois, mais moins résolu que l'IGN en rural — vérifié).

### (c) Plan d'implémentation POC Mapbox (étape 2)

1. Créer un compte Mapbox, générer un token public (scope tiles), le mettre en
   `VITE_MAPBOX_TOKEN` dans `web/.env` **et** dans Render (jamais commité).
2. Dans `web/src/config/map.ts` :
   ```ts
   export const satelliteMapboxSource: RasterSourceSpecification = {
     type: 'raster',
     tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`],
     tileSize: 512, // tuiles @2x : nettes sur Retina — LE point clé
     maxzoom: 22,
     attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © Maxar',
   }
   ```
3. Brancher la couche Toits sur cette source (sélection par variante d'URL comme `?ortho=wms2x`,
   p. ex. `?ortho=mapbox`) ; paint neutre (l'imagerie est déjà corrigée). IGN reste le défaut et
   le fallback si token absent.
4. Comparer sur 3-4 lotissements réellement prospectés, zooms 17-20 : lisibilité des toits
   (faîtage, cheminées, matériau), couleurs, netteté, **fraîcheur** (lotissement récent visible ?).
   Verdict du chef des ventes sur captures côte à côte.
5. Si adopté : surveiller le compteur Raster Tiles API dans le dashboard Mapbox après 2 semaines
   d'usage réel + poser une alerte de dépassement.

### Sources

**IGN / Géoplateforme**
- https://geoservices.ign.fr/actualites/2025-07-09-mise-%C3%A0-jour-flux-ortho (PM_0_21 → PM_0_19, retrait THR fin mai 2025)
- https://geoservices.ign.fr/bdortho · https://www.data.gouv.fr/datasets/bd-ortho-r
- https://cms.geobretagne.fr/application/publication-orthophoto (millésimes bretons)

**MapLibre (netteté/tileSize)**
- https://github.com/maplibre/maplibre-gl-js/issues/141 · https://github.com/maplibre/maplibre-gl-js/issues/1257
- https://docs.maptiler.com/guides/maps-apis/maps-platform/difference-between-256x256-512x512-and-hidpiretina-rasterized-tiles/

**Mapbox**
- https://docs.mapbox.com/help/dive-deeper/mapbox-in-maplibre/ (usage officiel des APIs Mapbox dans MapLibre)
- https://docs.mapbox.com/accounts/guides/pricing/ · https://www.mapbox.com/pricing (Raster Tiles API : 750k tuiles/mois gratuites)
- https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/ (tileset, maxzoom 22, @2x.jpg90)
- https://docs.mapbox.com/help/dive-deeper/imagery/ · https://blog.mapbox.com/france-imagery-is-live-c594e2e88ea7 (15 cm sur 490 000 km²)

**Apple**
- https://developer.apple.com/maps/web/ (250 000 map views/jour gratuits)
- https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ (Schedule 6 : pas d'extraction des tuiles)

**Google**
- https://developers.google.com/maps/documentation/tile/policies (renderer tiers autorisé)
- https://developers.google.com/maps/documentation/tile/usage-and-billing (100k appels/mois ; « specific imagery visualization use cases »)

**Esri / MapTiler / Azure / Maxar-Vexcel**
- https://location.arcgis.com/pricing/ · https://developers.arcgis.com/maplibre-gl-js/
- https://www.maptiler.com/news/2021/03/french-imagery-ready-for-your-next-project-with-maptiler/ · https://www.maptiler.com/cloud/pricing/
- https://azure.microsoft.com/en-us/pricing/details/azure-maps/
- https://www.vexcel-imaging.com/vexcel-data-program/ (pricing non public)

**Points non vérifiés à ce jour** : prix Google 2D Tiles au-delà de 100k/mois ; part exacte
d'imagerie propriétaire vs IGN retraitée chez Mapbox sur les communes bretonnes (à trancher
visuellement par le POC).
