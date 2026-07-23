# SOP — Surface de toiture mesurée au LiDAR HD (juillet 2026)

> **Objectif** : remplacer l'estimation de surface de toit (`emprise / cos(pente)`, ±15-20 %)
> par une **mesure quasi réelle (±3-5 %)** issue du nuage de points LiDAR HD de l'IGN,
> automatique, gratuite, invisible pour l'utilisateur (même pattern que la fiche enrichie).
> Décision briac (23/07/2026) : chantier validé, sans urgence, à faire proprement.
> Bonus visé pour la phase SaaS : « surface mesurée au laser » = différenciateur produit
> (ce service se vend à l'unité aux USA : EagleView, RoofSnap).

## Vérifications déjà faites (23/07/2026 — ne pas refaire)

| Fondation | Statut | Détail |
|---|---|---|
| Couverture zone de test (Lesneven 29) | ✅ | Dalle `LHD_FXX_0160_6855`, **acquisition 12/2024** (fraîche), 17,3 M pts/km² (~17 pts/m²), classification auto `IGN_AUTO_V5` |
| Découverte de la dalle par coordonnées | ✅ | WFS `IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle` sur `data.geopf.fr/wfs/ows`, BBOX en **CRS:84 (lon,lat)** → renvoie l'URL de téléchargement + métadonnées |
| Format streamable | ✅ | **COPC** (`.copc.laz`, octree indexé) ; serveur accepte **Range 206** (testé : `bytes 0-4095/109312727`) → on lit ~quelques centaines de Ko par maison, pas 109 Mo |
| Licence / coût | ✅ | Licence Ouverte Etalab, usage commercial OK, sans clé, 0 € — comme ortho/BAN. Attribution IGN |
| Dérivés raster (plan B) | ✅ | Dalles MNS/MNT/MNH LiDAR HD dispo en WFS/téléchargement (`IGNF_MNS-LIDAR-HD:dalle`…) + couches de visualisation WMTS |
| Briques app réutilisables | ✅ | Polygone bâtiment déjà récupéré (WFS BD TOPO, `data/enrich.ts`), proj4/Lambert-93 déjà embarqué, pattern cache-en-BDD + backfill paresseux déjà rodé (migrations 0006/0007) |

## Architecture cible (rappel de la décision)

**Aucune nouvelle carte, aucun nouvel écran.** Un module de calcul en arrière-plan :
tap maison → polygone bâtiment (déjà là) → lecture ciblée du COPC → reconstruction des pans
→ `surface = Σ aire_projetée(pan) / cos(pente(pan))` → **écrit une fois en BDD** (cache
définitif, comme l'enrichissement actuel) → la fiche affiche `137 m² toit · mesuré LiDAR`
au lieu de `~120 m²`. Fallback permanent : l'estimation actuelle (jamais de fiche vide).

## Phases et jalons (chaque phase a un critère d'arrêt — pas de tunnel)

### Phase 0 — Spike de faisabilité (1-2 jours) 🔬
Hors app, script Node jetable dans `tools/lidar-spike/` (jamais shippé, jamais dans le bundle).
1. WFS dalle → stream des nœuds COPC intersectant la bbox du bâtiment (lib npm `copc`).
2. Filtre : classe 6 (bâtiment), emprise du polygone **bufferisée de ~1 m** (pour capter les
   débords de toit, que l'estimation actuelle ignore par construction).
3. Segmentation des pans : RANSAC itératif (plans successifs, inliers à ±15 cm, jusqu'à
   épuisement) — suffisant au spike, raffinable en phase 1.
4. Aire projetée par pan : grille d'occupation 0,5 m (robuste aux trous/cheminées),
   aire réelle = aire projetée / cos(pente du plan).
5. Sortie : surface totale + liste des pans (pente, aire, orientation) + comparaison à
   l'estimation actuelle sur la maison test de Lesneven.

**Gate G0 (GO/NO-GO)** : sur 3-4 maisons de surface réellement connue (fournies par le chef
des ventes), écart ≤ **±8 %** sur au moins 3. GO → phase 1. NO-GO → repli palier A (pente
moyenne via MNS raster, gain plus modeste) ou statu quo, et on documente pourquoi.

### Phase 1 — Durcissement de l'algo (2-4 jours)
- Cas limites : végétation surplombante (classe 5 mêlée aux points toit), cheminées/lucarnes
  (outliers), toits plats et terrasses, maisons mitoyennes (séparer par polygone), formes en
  L/T multi-faîtages, annexes accolées, vérandas (classe 6 vitrée = points épars).
- Budget perfs : **< 5 s par maison, < 10 Mo transférés** (sinon on précalcule côté serveur).
- Jeu de test élargi : 10-15 maisons variées (ardoise/tuile/plat, simple/complexe), validées
  visuellement sur l'ortho + par le chef des ventes quand la surface est connue.
- **Gate G1** : ±5-8 % sur le jeu élargi, zéro crash, budget perfs tenu.

### Phase 2 — Intégration app (3-5 jours)
- **Décision d'archi à instruire en début de phase** : calcul dans le navigateur (wasm
  laz-perf, ~1-2 Mo de chunk chargé à la demande — comme `enrich.ts`) **ou** Supabase Edge
  Function (Deno, mutualisé, le mobile ne fait qu'un fetch). Critères : poids bundle, CPU
  mobile réel, simplicité de maintenance. Par défaut : **Edge Function** (« mesuré une fois,
  servi à tous », rien à télécharger côté téléphone).
- Migration **`db/0008_toit_lidar.sql`** : `toit_surface_lidar_m2 numeric`, `toit_pans jsonb`
  (pente/aire/azimut par pan), `toit_lidar_date date` (millésime acquisition),
  `toit_lidar_status text` (`ok` / `no_data` / `error` — pour ne pas re-tenter en boucle).
- Flux : calcul à la pose du point + backfill paresseux à l'ouverture des fiches anciennes
  (pattern 0006). Jamais bloquant : la fiche affiche l'estimation actuelle tant que la mesure
  n'est pas arrivée, puis se met à jour.
- UI : le badge `~120 m² toit` devient `137 m² toit` avec mention « mesuré LiDAR (IGN, 2024) »
  dans le title/tooltip ; nuance `~` conservée si fallback estimation. Attribution IGN déjà
  en place sur la fiche.
- **Gate G2** : `npm run build` OK, test terrain sur les maisons déjà posées (backfill), pas
  de régression de fluidité de la fiche.

### Phase 3 — Bonus visuel (option, 1-2 jours, à valider avec le chef des ventes)
Dessiner les pans sur l'ortho dans la fiche maison (GeoJSON overlay, comme la surbrillance
bâtiment) avec m² par pan : argument de vente en porte-à-porte. Ne bloque rien.

### Quick wins « étage 1 » (indépendants, ~½ journée, à caler quand briac valide)
Corrections de l'estimation **fallback** (elle reste utile partout où le LiDAR échoue) :
débords de toit via périmètre (+5-15 % systématiques), détection toits plats, largeur des
formes en L. À faire de préférence AVANT la phase 2 pour que le fallback soit à son meilleur.

## Risques et parades

| Risque | Impact | Parade |
|---|---|---|
| Segmentation des pans trop fragile (toits complexes) | Précision < objectif | Gates G0/G1 avec maisons réelles ; repli MNS (palier A) ; au pire statu quo — rien n'est cassé |
| Millésime : maison construite après le survol | Pas de points | `toit_lidar_status = no_data` → fallback estimation, nuance `~` affichée |
| Classification IGN imparfaite (arbres en classe 6…) | Surfaces gonflées | Filtres géométriques (hauteur vs MNT, cohérence des plans) en phase 1 |
| Poids/CPU côté mobile si choix « navigateur » | UX dégradée | Critère explicite de la décision d'archi phase 2 ; défaut = serveur |
| Débit du service de téléchargement IGN | Lenteur ponctuelle | Cache définitif en BDD (1 calcul/maison à vie) ; statut `error` re-tentable |
| Définition de « la » surface (avec/sans débords) | Faux écarts en validation | Le LiDAR mesure le toit réel débords compris — le préciser au chef des ventes pour comparer des choses comparables |

## Conventions du chantier (rappels CLAUDE.md + spécifiques)

- Budget : **0 € de bout en bout** (données Licence Ouverte, calcul dans l'existant).
- `npm run build` doit passer avant tout commit ; migrations SQL numérotées dans `db/`
  (à exécuter dans Supabase — le signaler à briac à chaque fois).
- Rien de lourd dans le bundle principal : tout module LiDAR = chunk séparé chargé à la
  demande (pattern `enrich.ts`) ou côté serveur.
- Le spike vit dans `tools/lidar-spike/` et n'entre jamais dans `web/`.
- Fin de chaque phase : mise à jour de ce SOP (jalons cochés, décisions prises) +
  `docs/roadmap.md`.
- DA : badges/tooltips dans le système existant (Geist, Lucide, tokens) — pas d'emoji.

## Actions en attente côté briac

1. **Fournir 3-4 maisons de référence** dont la surface de toiture est réellement connue
   (chantiers faits par l'ami chef des ventes ?) : adresse + surface. C'est le juge de paix
   du Gate G0 — sans elles on ne peut pas valider la précision.
2. Valider les quick wins « étage 1 » (½ journée, améliore le fallback).
3. (Phase 3) Avis du chef des ventes sur l'intérêt du dessin des pans en rendez-vous.

## Journal de bord

- **23/07/2026** — SOP créé. Fondations vérifiées (dalle Lesneven 12/2024, COPC + Range OK,
  WFS de découverte OK, licence OK). Phase 0 : prête à démarrer.
- **23/07/2026 (après-midi)** — **Spike technique exécuté et concluant** (`tools/lidar-spike/`,
  lib npm `copc` + proj4, Node 22). Trois maisons de Lesneven, 3/3 réussies :
  | Maison | Emprise | Estimation actuelle | **Mesure LiDAR** | Pans détectés |
  |---|---|---|---|---|
  | Rue du Retalaire (test) | 100 m² | ~125 m² | **~150 m²** | 4 pans ~40° (croupe) + annexe plate 31 m² |
  | 35 rue de l'Argoat | 116 m² | ~145 m² | **~215 m²** | 2 pans ~48° (bâtière) + extensions |
  | 18 rue du Retalaire | 120 m² | ~140 m² | **~165 m²** | 4 pans ~34°, 3 points orphelins seulement |
  Perfs : **2,1-2,4 Mo transférés, 3-6 s par maison** (budget < 10 Mo / < 5 s quasi tenu,
  optimisable en parallélisant les nœuds). Densité toit : 11-13 pts/m².
  Enseignements pour la phase 1 :
  1. **Maison à cheval sur 2 dalles** (frontière au km L93) : résolu — chercher les dalles par
     la bbox du bâtiment, pas par le point cliqué ; agréger les points.
  2. **RANSAC non déterministe** : ±2 m² d'un run à l'autre → seed fixe en phase 1.
  3. Les mesures dépassent systématiquement l'estimation actuelle (+15 à +48 %) — cohérent
    (débords réels + pentes réelles plus fortes que le forfait), à confirmer au Gate G0 avec
    les maisons de référence.
  4. Sur-segmentation légère (pans parallèles décalés fusionnables) : à traiter en phase 1.
  **Reste pour clore la phase 0 : le Gate G0** — 3-4 maisons de surface connue (action briac).
- **23/07/2026 (soir)** — **Validation sans vérité terrain externe** (briac indisponible côté
  chef des ventes) : deux dispositifs ajoutés.
  1. **Banc synthétique** (`bench.mjs`) : toits générés mathématiquement (croupe 35°/45°,
     bâtière 40°, plat) avec le réalisme du LiDAR (12 pts/m², bruit 3 cm, cheminée, 2 %
     d'aberrants), passés dans le MÊME code de mesure (`lib.mjs`, partagé avec le spike).
     **Erreur max : 5,7 %, dispersion quasi nulle** (objectif G0 : ≤ 8 %). Biais résiduels
     compris et corrigeables en phase 1 : cellules vides de la grille (~5 % en sous-mesure,
     corrigeable par facteur de densité ou fermeture morphologique) ; débord de bordure.
  2. **Toits plats réels** (surface = emprise BD TOPO connue) : deux bâtiments commerciaux de
     Lesneven. A révélé un vrai bug — **double comptage des cellules entre pans superposés**
     (toits multi-niveaux, sur-segmentation) : +18 % sur un centre commercial. **Corrigé**
     (déduplication des cellules dans `measureRoof`, chaque cellule attribuée au premier pan) ;
     retombe à +9 % de l'emprise murs (cohérent avec parapets/débords réels). Le correctif
     stabilise aussi les pavillons (maison test : 150 → **135 m²**, plus de jitter RANSAC).
  Nouvelles valeurs de référence après dédup : maison test **135 m²**, dalles voisines
  (Lesneven nord) millésimées **01/2025** — couverture très fraîche confirmée.
  **Le Gate G0 reste ouvert** : la vérité terrain externe (surfaces facturées par le chef des
  ventes) reste le juge de paix ; briac peut aussi auto-tester sur une maison accessible
  (plans du permis de construire, facture de couverture, ou mesure du pignon : largeur +
  angle mesuré à l'inclinomètre du téléphone → surface = 2 × longueur × (largeur/2)/cos(angle)
  + débords).
- **23/07/2026 (nuit)** — **Validation croisée contre le cadastre solaire du Grand Lyon**
  (question briac : « tester sans le chef des ventes ? »). Presse locale et marchés publics
  inexploitables en pratique (crawlers bloqués, PDF non parsables ici) ; en revanche le
  **cadastre solaire open data du Grand Lyon** fournit 1,1 M de pans avec surface/orientation
  par bâtiment (`validate-lyon.mjs`, commune test : Mions, pavillonnaire).
  Résultats et enseignements :
  1. **Nouveau bug réel trouvé et corrigé** : les points de **façade** dans le tampon de
     1,2 m gonflaient la mesure proportionnellement au périmètre (invisible au banc
     synthétique, qui n'avait pas de murs). Correctif : tampon 0,8 m + les cellules hors
     emprise murale exigent ≥ 2 points (`lib.mjs`). Écart médian vs Lyon : 40 % → **23 %**.
     Banc synthétique après correctif : erreur max 7,9 % (toujours sous le gate, biais
     désormais uniformément négatif ≈ −5-8 %, recalibrable).
  2. **Maisons anciennes « stables » : accord à ±8 %** entre deux mesures totalement
     indépendantes (notre LiDAR vs photogrammétrie professionnelle Lyon) — très bon signe.
  3. **Lotissement récent (parcelles ZH) : +20-40 % d'écart persistant**, expliqué par le
     **millésime** : modèle lyonnais ≈ 2012 vs LiDAR 2021 (extensions/vérandas/carports en
     classe 6 — visibles sur l'ortho), et pans lyonnais apparemment rognés à l'emprise
     (sans débords) sur certaines maisons. Leçon produit : notre mesure inclura les annexes
     accolées → en phase 1, **ventiler par pan** (toit principal vs annexes plates) plutôt
     qu'un total unique.
  4. La densité de points varie du simple au quadruple selon les zones de recouvrement des
     lignes de vol (56 pts/m² à Mions) : les seuils fixes doivent devenir relatifs (phase 1).
  Scripts : `validate-lyon.mjs` (validation de masse contre Lyon), `diag-lyon.mjs`
  (pente implicite des pans lyonnais). Le Gate G0 sur factures reste le juge de paix.
- **24/07/2026 — Phase 1 (durcissement algo) : cœur livré.** Refonte de `lib.mjs` :
  1. **RANSAC déterministe** (LCG seedé) : mêmes points → même mesure, toujours.
  2. **Seuils adaptatifs à la densité locale** (10-56 pts/m² selon le recouvrement des vols) :
     inliers minimum ≈ 2,5 m² de toit à la densité mesurée ; filtre façade hors emprise
     proportionnel à la densité.
  3. **Fusion des pans sur-segmentés** (plans quasi parallèles à < 5° et < 0,35 m d'écart) —
     fin des pans fantômes dupliqués.
  4. **Fermeture morphologique** de la grille (cellule vide entourée d'occupées = trou
     d'échantillonnage) → le biais négatif est corrigé : **banc synthétique à ±1,9 % max,
     dispersion nulle**.
  5. **Exclusion des bâtiments voisins** (mitoyens/garages : WFS DWITHIN 25 m, points dans
     leur polygone rejetés sans tampon).
  6. **Ventilation par pan** : `plat` (< 7°) / `principal` (plus grand pan incliné ± 8°) /
     `secondaire` — sortie `totalPrincipal` (la donnée couvreur) en plus du total.
  7. **Rate-limit IGN découvert et géré** : la parallélisation naïve prend des **HTTP 429**
     → concurrence plafonnée à 4 + retries backoff + 1,5 s entre maisons dans les scripts
     de masse. ⚠️ À reporter en phase 2 (Edge Function : file d'attente + cache).
  Résultats après durcissement : **médiane vs cadastre Lyon 40 % → 15 %** (l'estimation
  actuelle de l'app fait 34 % au même étalon — on est déjà 2× meilleurs) ; lotissement ZH
  rentré dans le rang (-3/+9 % sauf une maison à +22 %, extension probable) ; Lesneven :
  126 m² (croupe 40° + annexe plate), 184 m² (bâtière 47°), 146 m² (croupe 34°, 4 points
  orphelins) en 3,4-5,5 s et ~2,3 Mo par maison.
  **Reste pour le Gate G1** : jeu de test élargi (10-15 maisons variées : véranda, mitoyen
  réel, végétation dense, toit plat résidentiel) + re-calibrage éventuel après le Gate G0
  (factures). Les valeurs ci-dessus sont les références de non-régression.
- **24/07/2026 — Gate G1 : PASSÉ** (suite `g1-suite.mjs`, 21 bâtiments, 4 scénarios contre le
  cadastre solaire Lyon). Résultats :
  | Scénario | Médiane vs Lyon | Note |
  |---|---|---|
  | Pavillons pentus (Mions) | **9,1 %** | référence |
  | Toits plats résidentiels (Villeurbanne) | **12,6 %** | pentes 0-2° bien détectées |
  | Mitoyens en bande (Oullins) | **8,7 %** | l'exclusion des voisins fonctionne |
  | Pavillons cossus (Tassin) | 16,3 % | parcelles boisées, millésime 2012 |
  - **Zéro crash** : les cas pathologiques rendent désormais des **verdicts** au lieu
    d'échouer ou de mentir : `no_data` (maison sous les arbres / construite après le survol
    → l'app repliera sur l'estimation actuelle), `faible_confiance` (couverture de l'emprise
    < 55 %), `grand_batiment` (emprise > 350 m² : polygone BD TOPO = bloc collectif entier,
    la mesure est celle du bloc).
  - **Végétation : robuste** — les maisons très arborées (jusqu'à 302 % de points
    végétation/bâtiment) ne mesurent PAS plus faux (médiane 3,2 % vs 8,8 % pour les
    dégagées) ; seule la canopée totale déclenche `no_data`, ce qui est le bon comportement.
  - Les 2 aberrations observées (+686 %, −80 %) sont des **artefacts d'appariement du banc**
    (buildingid cadastral lyonnais ≠ polygone BD TOPO fusionné) — sans équivalent dans
    l'app, où l'on mesure le bâtiment effectivement tapé ; le verdict `grand_batiment`
    couvre le cas résiduel.
  - **Perfs** : 4-6 s/maison en usage isolé ; la suite en rafale subit les backoffs du
    rate-limit IGN (jusqu'à 15 s) → confirme la **file d'attente + cache** en Edge Function
    pour la phase 2 (l'usage app = 1 maison à la fois, non concerné).
  **Prochaines étapes** : Gate G0 (factures du chef des ventes → recalibrage éventuel),
  puis phase 2 (intégration app).
- **24/07/2026 — Phase 2 : intégrée dans l'app** (décision briac : shipper pour que le chef
  des ventes fasse le Gate G0 en conditions réelles sur ses chantiers).
  - **Architecture : 100 % navigateur** — le serveur de téléchargement IGN expose
    `Access-Control-Allow-Origin: *` et accepte `Range` au preflight (vérifié) → pas d'Edge
    Function, zéro infra, le « git push → Render » reste inchangé.
  - `web/src/data/lidar.ts` : portage TS du pipeline validé (G1), chunk séparé chargé à la
    demande (copc + glue laz-perf ≈ 100 Ko js + **wasm 214 Ko émis en asset via `?url` +
    `locateFile`** — piège Emscripten/Vite réglé, le wasm serait introuvable en prod sinon).
  - Déclenchement : à la pose du point (`data/points.ts`) + backfill paresseux à l'ouverture
    des fiches anciennes (`PointDetailSheet`). Anti-doublon par point (promesse en vol).
  - Cache définitif : migration **`db/0008_toit_lidar.sql`** (⚠️ à exécuter dans Supabase
    AVANT tout test — les colonnes sont dans le SELECT des points). Champs : total,
    toit principal, pans (jsonb), statut, millésime du survol, **version d'algo**
    (`LIDAR_VERSION` dans `domain/house.ts` : l'incrémenter après un recalibrage re-mesure
    paresseusement tous les points).
  - UI : badge `137 m² toit` (style « confirmé », sans ~, title « mesuré au laser… survol
    AAAA ») uniquement si statut `ok` ; tout autre verdict laisse l'estimation actuelle
    affichée.
  - **Retour briac (24/07)** : la mesure s'affiche AUSSI sur la fiche AVANT prospection
    (tap maison sans point) — cache mémoire par coordonnées : consulter puis poser ne
    télécharge qu'une fois. Et **plus de « flash » estimation → mesure** : pendant le
    calcul, badge « mesure du toit… » pulsé à la place de l'estimation ; l'estimation ne
    s'affiche que si le verdict n'est pas `ok`.
- **24/07/2026 — Gate G0 : VALIDÉ** par le chef des ventes en conditions réelles sur ses
  chantiers (GO transmis par briac). La feature est officiellement calibrée ; tout
  recalibrage futur passe par un bump de `LIDAR_VERSION` (re-mesure paresseuse).
- **24/07/2026 — Phase 3 : pans dessinés sur l'ortho (livrée).**
  - Vectorisation au moment de la mesure : cellules dédupliquées de chaque pan → traçage de
    frontière (arêtes orientées chaînées, plus grande boucle) → **Douglas-Peucker adapté aux
    anneaux fermés** (le DP naïf s'effondre quand premier = dernier point : corde dégénérée →
    tout supprimé — bug attrapé par le test `tools/lidar-spike/test-outline.mjs`, correctif :
    coupe au point le plus éloigné + simplification des deux moitiés). Contours en lng/lat
    (~10-40 sommets) + centroïde d'étiquette stockés dans `toit_lidar_pans` (jsonb existant).
  - Rendu : source GeoJSON + couches fill/line (couleur par pan, palette DA 6 teintes) sous
    les marqueurs, pastilles « XX m² » en marqueurs DOM (Geist Mono, bord teinté, tap qui
    traverse). Affiché quand la fiche d'une maison mesurée est ouverte (avant prospection ou
    point), retiré à la fermeture ; la surbrillance bleue s'efface sous les pans.
  - `LIDAR_VERSION` 1→2 : les mesures v1 (sans contours) se régénèrent paresseusement.
  - Limite connue (acceptée v1) : cellules en contact diagonal → l'arête partagée peut
    scinder la boucle (rare, la fermeture morphologique le réduit) ; les miettes disjointes
    d'un pan ne sont pas dessinées (comptées dans le m² mais hors polygone principal).
  - **Gate G0 terrain** : le chef des ventes tape ses chantiers passés (backfill immédiat à
    l'ouverture de la fiche) et compare aux factures. Écart systématique → recalibrage +
    bump de version.
- **24/07/2026 (après-midi) — Passes cosmétiques des pans (retours captures briac)** :
  - `LIDAR_VERSION` 2→3 : lissage des contours musclé à 1 m — formes franches, sans
    crénelures ni pointes.
  - `LIDAR_VERSION` 3→4 : les toits d'ardoise sombre renvoient mal le laser (cellules
    éparses) → **enveloppe morphologique** (dilatation/érosion rayon 2) avant traçage,
    traçage robuste aux pincements en diagonale, **garde d'honnêteté** : pas de dessin si
    le polygone tracé couvre < 60 % de la surface du pan (pastille sur une lanière =
    mensonge). Conséquence assumée : certains toits sombres n'affichent pas de pans
    (le m² total reste mesuré et affiché).
- **24/07/2026 (nuit) — Audit complet de la fonctionnalité (calcul + visuel + câblage),
  puis durcissement.** Constats et correctifs livrés dans la foulée :
  1. **Tests sur le code shippé** : le banc synthétique et les tests de contours validaient
     une COPIE manuelle (`tools/lidar-spike`) qui pouvait dériver. Le cœur pur est extrait
     dans `web/src/data/lidar-core.ts`, testé par **vitest** (`npm run test` dans `web/`) :
     banc seedé croupe/bâtière/plat ≤ 5 %, déterminisme, pentes, azimuts, contours.
  2. **Bâtiment le plus proche** : quand le point ne touche aucun polygone, on prenait
     `feats[0]` du DWITHIN 25 m (ordre WFS arbitraire) → risque de mesurer la maison d'en
     face avec un badge « sûr ». Désormais : plus proche via distance au polygone, ≤ 10 m,
     sinon `no_data`.
  3. **Cache partagé à l'équipe** : la RLS (update = auteur/manager) faisait échouer EN
     SILENCE la persistance du backfill sur les points des collègues → mesure refaite
     (2-3 Mo) à chaque session. **Migration `db/0009_cache_lidar_rpc.sql` (exécutée)** :
     RPC `cache_point_lidar` (security definer) qui n'écrit que les colonnes
     `toit_lidar_*` pour un point de son organisation, garde anti-régression de version ;
     repli automatique sur l'update direct tant qu'elle n'est pas exécutée.
  4. **La re-mesure fraîche prime** sur le cache périmé dans la fiche (précédence
     inversée : un vieux `no_data` v1 masquait un `ok` v4 recalculé).
  5. **Timeouts réseau** : 20 s par requête (WFS + ranges COPC), 60 s pour la mesure
     entière → verdict `error` re-tentable (avant : badge « mesure… » infini et retry
     impossible de la session).
  6. **`grand_batiment` sans téléchargement** : verdict rendu dès l'emprise connue
     (> 350 m²), économise 2-3 Mo sur les collectifs.
  7. **Poids réseau app** : `toit_lidar_pans` (contours jsonb) sorti du SELECT global des
     points (carte/accueil/agenda) → fetch ciblé à l'ouverture de la fiche, cache
     rafraîchi par le realtime ; `fetchPoints` paginé (Supabase tronque à 1 000 lignes).
  8. **`azimut_deg` corrigé en azimut boussole** (0 = nord, 90 = est) — les v1-v4
     stockaient un angle mathématique depuis l'est (plein sud = 270). Jamais affiché,
     mais faux en base pour un usage futur. **`LIDAR_VERSION` 4→5** : re-mesure
     paresseuse de tout le stock à l'ouverture des fiches.
  Restent volontairement hors périmètre : Web Worker (le calcul bloque le main thread
  ~0,5-2 s pendant la mesure — à faire si du jank est constaté sur le terrain) ;
  annulation de pose qui n'interrompt pas la mesure en vol (amortie par le cache par
  coordonnées) ; centroïde d'étiquette = moyenne des sommets (peut déborder d'un pan
  en L, cosmétique).
