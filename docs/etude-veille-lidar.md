# Veille stack LiDAR / 3D / concurrents (juillet 2026)

> Campagne de 5 agents de recherche en parallèle (workflow multi-agents, autorisée par
> briac) sur la documentation de notre stack, avec **vérifications en direct** sur les
> API. Synthèse classée impact/effort ; la colonne « État » indique ce qui a été
> implémenté dans la foulée (chantier « paliers 1-3 », voir SOP + roadmap).

## A. Écosystème LiDAR HD IGN / Géoplateforme

| Opportunité | Impact | État |
|---|---|---|
| **MNH LiDAR HD en WMS raster** : GetMap `image/x-bil;bits=32` sur `data.geopf.fr/wms-r` (couche `IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93`) → Float32 brut ~25 Ko, décodable sans lib (testé près de Rennes). | fort | ✅ éclaireur parallèle des verdicts (v20) — le court-circuit séquentiel a été écarté (1 RTT sur toutes les mesures pour un cas rare) ; repli « estimation MNH » quand la classe 6 est pauvre : **à faire** |
| **`procede_classement` + `date_edition`** déjà dans le champ `metadata` des dalles que l'on parse : tracer la qualité de classification (IGN_AUTO_V5), re-mesurer quand l'IGN réédite. | moyen | ✅ stockés au diag (v18) ; politique de re-mesure sur réédition : **à faire** (critère dans `lidarNeedsMeasure`) |
| **Classe 5** (végétation haute) : diagnostiquer la canopée, badge « végétation surplombante » (argument démoussage). Zéro octet de plus. | moyen | ✅ v18 |
| **Classe 67** « divers bâtis » en secours quand la classe 6 est pauvre (vérandas, annexes mal classées), plafonné `faible_confiance`. | moyen | ✅ v18 |
| Couverture : ~80 % fin 2025, complète fin 2026 (hors Guyane) ; **pas de 2e couverture actée**. Distinguer « hors couverture » (re-tenter) des autres no_data. | faible | ✅ v18 (motif `hors_couverture`) |
| **Menaces vérifiées** : geoservices.ign.fr → 301 cartes.gouv.fr ; API Adresse historique fermée 01/2026 (nous sommes déjà sur data.geopf.fr/geocodage) ; **15/06/2026 : max 2 couches par appel WFS/WMS-V** (nos appels sont mono-couche — règle à ne jamais « optimiser »). Aucune fermeture du WFS ni du COPC annoncée. | — | ✅ règle actée dans CLAUDE.md |

## B. COPC / copc.js / laz-perf

| Opportunité | Impact | État |
|---|---|---|
| **Cache par URL de dalle** (header + hiérarchie ~125 Ko + 4 requêtes, refaits à chaque maison) — fichiers IGN immuables, URL versionnée. | moyen | ✅ |
| **Cache par nœud des points utiles** (classes 5/6/67 filtrées ≈ 5-15 %, Float64Array) : la racine (~500 Ko) et les nœuds prof. 1-3 sont partagés par toutes les maisons de la dalle → transfert ÷5-10 dès la 2e maison du quartier, boucle wasm amortie. LRU 30 Mo. | fort | ✅ |
| Pré-verdict no_data sur les niveaux peu profonds déjà en cache (économiser les feuilles des maisons sous canopée). | moyen | ⬜ (le cache réduit déjà l'enjeu) |
| Fusion des requêtes Range de nœuds contigus (latence 4G : 8-20 requêtes → 2-4). | moyen | ⬜ |
| `include` de `loadPointDataView` : **gain nul, vérifié dans les sources** (les getters sont paresseux, laz-perf décompresse tout le chunk de toute façon) — ne pas y revenir. Classification testée en premier dans la boucle chaude : fait. | faible | ✅ |
| Versions : copc 0.0.8 / laz-perf 0.0.7 = dernières publiées ; figées (exact) et laz-perf déclaré. Pièges : toujours passer `{ lazPerf }` (sinon 2e wasm) ; le heap Emscripten ne rétrécit jamais. Alternatives écartées : loaders.gl (loader COPC inexistant, issue #2911), copc-lib (pas de wasm npm). | faible | ✅ |

## C. WFS BD TOPO & référentiels bâtiment

| Opportunité | Impact | État |
|---|---|---|
| **Attributs déjà téléchargés jamais lus** : usage_1/2, nombre_de_logements, nombre_d_etages, date_d_apparition (repli année quand la BDNB est muette), etat_de_l_objet, construction_legere, materiaux_des_murs, precision_planimetrique. | fort | ✅ (jsonb `maison_extra`, migration 0010, badges fiche) |
| **grand_batiment croisé** : logements ≥ 4, étages ≥ 3, IDs RNB multiples — au lieu du seul seuil 350 m² (les grandes longères passaient pour des collectifs). | fort | ✅ v18 |
| **Découpage RNB des polygones fusionnés** : `identifiants_rnb` multiples (séparés par « / ») → géométries propres via l'API RNB (gratuite, CORS `*`, ~20 req/s ; vérifié : 2 maisons fusionnées à Rennes → 2 polygones, 2 adresses). | fort | ✅ v20 |
| **Parcelle cadastrale** (`BAN-PLUS:lien_bati_parcelle`) : voisin accolé même parcelle = annexe/extension à INCLURE (piste Deschard), autre parcelle = vrai mitoyen à exclure. | fort | ✅ v20 (v1 : points inclus dans la collecte ; l'union des emprises pour la reconstruction reste **à faire** si le cas Deschard persiste) |
| Expliquer les no_data par la date du bâtiment vs millésime de survol. | moyen | ✅ v18 (`posterieur_survol`) |
| **Adresse officielle du bâtiment** (`BAN-PLUS:lien_adresse_bati`, cleabs → id BAN) : plus fiable que le reverse par distance ; nb_adr > 1 = indice de fusion. | moyen | ⬜ |
| **Potentiel solaire par bâtiment** (`POTENTIEL.SOLAIRE.BATIMENT:bati`, jointure cleabs) : argument photovoltaïque. | faible | ⬜ |

## D. three.js mobile (viewer maquette)

| Opportunité | Impact | État |
|---|---|---|
| Rendu à la demande (pattern officiel damping) + shadow map figée (scène statique) : GPU ~0 immobile, batterie en RDV. | fort | ✅ |
| Contexte WebGL iOS : re-cuisson ombre + frame sur `restored`, remontage si le contexte reste mort au retour au premier plan. | fort | ✅ |
| NeutralToneMapping + `normalBias` (modelé des pans, anti-acné). | moyen | ✅ |
| Tactile : `pointercancel` purge le tap ; `user-select: none` sur les pastilles ; `overscroll-behavior` en plein écran. | moyen | ✅ |
| **Décisions à ne pas re-débattre** : WebGLRenderer conservé (WebGPURenderer = bundle plus lourd, zéro gain pour ~20 meshes, maturité mobile inégale) ; MeshLambert + MSAA natif conservés (Standard/FXAA contre-productifs sans post-processing) ; ~142 Ko gz = plancher du chunk three. | — | ✅ actées (CLAUDE.md) |

## E. Concurrents (EagleView, RoofSnap, Hover, Roofr, iRoofing…)

| Opportunité | Impact | État |
|---|---|---|
| **Longueurs linéaires par type d'arête** (Ridges/Valleys/Rakes/Eaves/Step flashing des rapports EagleView) : le chiffrage couvreur au mètre — quasi gratuit depuis notre reconstruction (soudures/marches/arcs). | fort | ✅ v19 (`edgeMetrics`, jsonb `aretes`, affiché sous la maquette) |
| **Tableau de chutes multi-pourcentages** (EagleView : 0/10/…/22 %) : explique l'écart Deschard (facturé ≈ géométrique + chutes). Standards : 10 % pignon, 15-20 % croupe/ardoise, 20-25 % complexe. | fort | ✅ (chip sous la maquette + tableau du rapport ; **% à valider avec les factures ventilées du chef des ventes**, question ouverte n° 26) |
| **Diagramme 2D annoté** (Length/Notes Diagram) : SVG vu du dessus, cotes, lettres A-Z. | moyen | ✅ (`RoofDiagram`) |
| **Rapport client généré sur le pas de la porte** (les concurrents : 13-87 $ et des heures/jours de délai) : print CSS → PDF natif + Web Share. | fort | ✅ (`RoofReport`) ; capture de la maquette 3D dans le rapport : **à faire** si demandé |
| **Avant/après matériaux** (l'argument Hover « close rate doublé ») : textures procédurales ardoise/tuile/zinc sur la vraie géométrie du client. | moyen | ✅ |
| Nommer la provenance (« laser IGN LiDAR HD · survol AAAA · ±5 % ») : différenciateur français structurel — mesure instantanée gratuite, irréplicable par les acteurs US sans notre pipeline. | moyen | ✅ (rapport) ; benchmark pricing consigné ici pour la phase SaaS |

## Sources principales
- cartes.gouv.fr (doc LiDAR HD, MNH, nomenclature des classes, actualités 2025-2026)
- data.geopf.fr (WFS/WMS-R testés en direct), rnb.beta.gouv.fr + rnb-api.beta.gouv.fr (testée)
- github.com/connormanning/copc.js (+ sources installées copc 0.0.8 / laz-perf 0.0.7)
- threejs.org/manual (rendering-on-demand), discourse.threejs.org, webkit.org (WebGPU Safari 26)
- eagleview.com (Sample Premium Roof Report PDF), roofr.com, hover.to, roofingsoftwareguide.com
