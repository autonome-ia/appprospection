# Feuille de route — AppProspection

> Ordre de priorité convenu. ✅ fait · 🔵 en cours · ⬜ à venir.

## Fondations ✅
- [x] Cadrage produit + spec (`SPEC.md`)
- [x] Choix techniques (PWA + Supabase + MapLibre/IGN/BAN)
- [x] Schéma de base de données (`db/schema.sql`)
- [x] Échafaudage PWA + carte IGN
- [x] Auth + persistance des points + temps réel (Supabase)
- [x] Détail / édition d'un point (clic sur marqueur)
- [x] Fond de carte **vectoriel** (Plan IGN) — rendu net et moderne

## Fondations (suite) ✅
- [x] **Recherche d'adresse (géocodage BAN)** — barre de recherche + centrage carte
- [x] **Affichage des bâtiments en 3D** — bouton 2D/3D, extrusion de `bati_surf` (champ `hauteur`) du Plan IGN, masquée en mode Toits

## Fondations (suite) ✅
- [x] **Agenda + flux RDV** — poser « RDV pris » ouvre la saisie du RDV (date/client/adresse auto via reverse BAN) ; agenda partagé (couleur par commercial) ; issues en 1 clic (Vendu/Effectué/Manqué/Annulé) ; « Vendu » rebascule le point en vendu. *Proposition à valider avec l'ami (Q6/Q7/Q10).*
- [x] **Statistiques (manager)** — tunnel de conversion (portes→contacts→RDV→effectués→ventes) + taux, classement des commerciaux, objectif hebdo de RDV (éditable par le manager), sélecteur jour/semaine/mois. *Définitions à valider avec l'ami (Q10/Q11).*

## Visuel carte (« beau & lisible »)
- [x] **Lisibilité** — fond adouci (voile sous les labels), marqueurs à icônes par statut (ombre, halo de sélection), regroupement/clustering avec bulles cliquables
- [x] **Effet 3D waouh** — éclairage des bâtiments, surbrillance (bleu) de la maison sélectionnée (ciel/brouillard retirés, invisibles). ~~Bâtiments sombres~~ → **bâtiments clairs** (réf. Apple Plans, cohérent DA) depuis le lot visuel de juillet 2026. **→ RETIRÉE (fin juillet 2026, décision briac)** : les prismes à toit plat (LOD1) n'apportaient rien sur le terrain et juraient avec les pans dessinés ; remplacée par la **maquette 3D du toit** dans la fiche (voir section LiDAR).
- [x] **Vue Toits hybride** — ortho-photo + noms de rues par-dessus (bâtiments blancs du plan masqués). **Vue Toits par défaut** à l'ouverture. (Contours des bâtiments testés puis retirés.)
- [x] **Vue rue / immersion** — explorée puis **ABANDONNÉE** : Mapillary trop juste en pavillonnaire, Google Street View écarté (dépendance + facturation), 3D photoréaliste Google bloquée en France. Code retiré.

## Fiabilité carte — suite de l'audit (juillet 2026)
- [x] **Lot 1 — Fiabilité de la donnée** : tolérance de tap (±14 px, plus de point parasite à côté d'un marqueur), garde double-tap-zoom (pose différée 300 ms, annulée par le 2e tap), toast « Point posé » avec action **Annuler**, pose **optimiste** (le point apparaît immédiatement, rollback + toast d'erreur si l'insert échoue).
- [x] **Lot 2 — Lisibilité soleil + cohérence DA** : halo blanc des labels uniquement quand l'ortho est active (restauré en plan), statuts « absent »/« à revoir » assombris (contraste ≥ 3:1 avec le glyphe blanc, alignés `status.ts` ↔ `--st-*`), glyphes et anneau des marqueurs épaissis, cluster blanc à anneau accent (fini la confusion avec « impossible »), halo/bâtiment sélection sur `--accent`, contrôles MapLibre restylés (tokens + cibles 44 px), Toits ↔ 3D cohérents (3D désactivée en vue Toits).
- [x] **Lot visuel (retour captures d'écran)** : bâtiments 3D passés de l'anthracite au **clair** (la masse sombre écrasait la vue), cercle de précision de la géolocalisation retiré (gros halo bleu laiteux), voile papier renforcé et placé **sous les routes** (le réseau de rues blanc ressort enfin), teintes eau/végétation ajustées, ortho ravivée (saturation/contraste), marqueurs qui grossissent jusqu'au zoom 19.
- [x] **Lot 3a — Carte persistante** : la carte reste montée entre les onglets (masquée en `visibility`), retour instantané, position/zoom conservés, pas de re-téléchargement des tuiles. Quitter l'onglet ferme drawers et mode visée.
- [x] **Lot 3b — Pose au réticule** (pattern Badger/SalesRabbit) : FAB « + » (zone pouce) → réticule au centre, on déplace la carte sous le viseur → statut + « Poser ici ». La pose au tap est retirée (plus de point accidentel possible, le doigt ne masque plus la maison). Garde-fou : zoom ≥ 15 requis.
- [x] **Lot 3c — Sheet détail non modale** : la carte reste visible et manipulable derrière le détail d'un point ; le point sélectionné est recadré au-dessus de la sheet (`easeTo` + padding bas, rendu à la fermeture) ; le halo de sélection prend la couleur du statut.
- [x] **Lot 3d — Clusters** : d'abord en donut par statut, puis **simplifiés après retour de briac** en badge accent (cercle bleu DA, chiffre blanc Geist Mono, halo doux — style pin Airbnb) : plus smooth, plus pro. Seuils abaissés (`clusterMaxZoom` 13, rayon 36) : dès l'échelle quartier (z14+) on voit tous les points individuellement, les bulles ne restent qu'aux échelles ville. Marqueurs DOM (`config/clusters.ts`), clic = zoom.
- [x] **Vol de caméra corrigé (juillet 2026, retour briac)** : chercher une adresse puis se faire ramener à sa position — le contrôle de géolocalisation était en mode **suivi continu** (re-centrage à chaque fix GPS, insensible aux déplacements programmatiques). Passé en localisation **à la demande** (one-shot, zoom rue) ; le zoom d'ouverture sur sa position ne s'exécute plus que si l'utilisateur n'a pas déjà navigué (fin de la course au chargement). Audit des autres mouvements de caméra (clusters, recadrage sheet, flyTo agenda/recherche) : cohérents.
- [ ] ⬜ **Lot 3 (suite, à choisir)** : filtres carte (statut/commercial).

## Système de notes (audit juillet 2026 — plainte : notes invisibles dans l'agenda)
- [x] **Quick wins notes** : note du RDV affichée sur la carte agenda (tous statuts) + note terrain du point lié (jointure) + bouton « Carte » (bascule d'onglet + flyTo + sélection) ; Modifier/Supprimer accessibles quel que soit le statut du RDV ; champ « Note (facultatif) » dans la barre de visée (capture à chaud, écrite dans `points.notes` ET `point_events.note`) ; pastille « a une note » sur les marqueurs ; fin du faux succès (erreur RLS/réseau → toast d'erreur) ; note éditable même si le fetch détail échoue ; note du point affichée dans le formulaire RDV.
- [x] **Flux de pose clarifié (retour briac)** : le champ note de la barre de visée est retiré (il laissait croire que c'était la seule saisie possible) ; désormais **chaque pose ouvre une fiche** — formulaire RDV complet pour « RDV pris », fiche du point (statut, **client**, note) pour les autres statuts. Nouvelle colonne `points.client_name` (**migration `db/0003_point_client_name.sql` à exécuter dans Supabase**).
- [x] **Journal de notes + client unifié** : table dédiée `point_notes` (**migration `db/0004_point_notes.sql` à exécuter** — séparée de `point_events` pour ne pas fausser les stats ; reprend en historique les notes existantes des points ET des RDV liés). Fiche point : historique horodaté avec auteur + champ « Ajouter une note » (on n'écrase plus jamais). Le nom du client saisi dans un RDV est synchronisé sur le point ; la note d'un RDV créé rejoint aussi le journal de la maison. `points.notes` = dernière note (pastille, agenda).

## Design — DA « Clair & précis » (Linear/Vercel/Emil Kowalski)
- [x] Système de design (tokens, police Geist, icônes Lucide, Sonner, Vaul, Motion)
- [x] Barre de navigation + écran Accueil
- [x] Carte (barre d'outils, recherche, chips, drawers Vaul, toasts)
- [x] Agenda (vue calendrier mois + planning du jour)
- [x] Stats (segmented animé, tunnel, classement)
- [ ] ⬜ Écran de connexion (encore ancien style) + finitions (contrôles carte)

## Déploiement ✅
- [x] Render (Static Site via `render.yaml`), repo GitHub `autonome-ia/appprospection`, HTTPS + PWA installable. Redéploiement auto à chaque `git push`.

## Quick wins SalesRabbit (étude `etude-salesrabbit.md`, juillet 2026)
- [x] **Relances datées** : champ « Revoir le » sur les points « à revoir » (**migration `db/0005_revisit_at.sql` à exécuter**), bloc « À relancer » sur l'Accueil (clic → carte + fiche). La date s'efface si le statut change.
- [x] **Adresse automatique** : géocodage inverse BAN en arrière-plan à la pose → adresse sur la fiche, l'Accueil et l'agenda.
- [x] **Filtres carte par statut** : chips en bas de carte (multi-sélection, vide = tout). « Vendu » seul = voir les chantiers pour prospecter autour (Customer Locator de SalesRabbit).
- [x] **Feed d'activité** sur l'Accueil : dernières actions de l'équipe (auteur, statut, client/adresse, il y a X min) depuis `point_events`.
- [x] **Retours briac** : les « à revoir » datés apparaissent aussi dans l'**agenda** (pastille ambre dans la grille du mois + liste « à revoir » sous les RDV du jour, tap → carte) ; les chips de filtre sont **repliées derrière un bouton filtres** dans la barre d'outils (la carte reste dégagée, bouton surligné quand un filtre est actif).
- [x] **Fiche maison enrichie** (étude `etude-donnees-maisons.md`, plan validé par briac) : à la pose, 2 appels open data en arrière-plan — WFS BD TOPO (matériau de toiture + altitudes → **surface de toit estimée**, calcul emprise/cos(pente) en Lambert-93) et BDNB (**année de construction** + classe DPE). Cache définitif sur le point (**migration `db/0006_maison_enrichie.sql` à exécuter**), backfill paresseux à l'ouverture des fiches anciennes. Affichage : badges compacts sous l'en-tête de la fiche (`~1972 · Ardoise · ~120 m² toit · DPE E`) avec nuances (~, « probable », title explicatifs) + attribution IGN/CSTB. Module `data/enrich.ts` (proj4) en chunk séparé chargé à la demande. Coût : 0 €.
- [x] **Fiche maison AVANT prospection (retour briac)** : taper une maison sans marqueur (zoom ≥ 16, garde double-tap) ouvre une sheet non modale — adresse, badges maison, **maison surlignée** sur la carte (polygone IGN) — avec choix du statut + « Poser le point » (enchaîne fiche/RDV comme le réticule). Consultation sans trace ; cache mémoire par coordonnées (poser après consultation ne refait aucun appel, ménage le quota BDNB).
- [x] **Précision toiture (retour briac : « Autre » trop vague)** : la nomenclature fiscale n'a que 5 catégories (limite de la source, pas un réglage) — matériau **secondaire** affiché (« Tuiles + zinc/alu ») et champ **« Toiture constatée »** sur la fiche (liste métier avec ardoise naturelle vs ardoise fibrociment, **migration `db/0007_mat_toit_confirme.sql`** exécutée) qui remplace la donnée fiscale — badge bleu « confirmé ». Un signal automatique « fibro ? » (Autre + ≤ 1997) a été testé puis **retiré** (jugé non pertinent : trop de bruit sur le parc ancien breton). Liste des matériaux à affiner avec le chef des ventes.
- [ ] ⬜ **Territoires** (en attente du retour du chef des ventes) : polygones dessinés par le manager + assignation + % de couverture (avec le nb réel de maisons par zone via BD TOPO). Puis équipe/invitations avant la prod.

## Vue satellite plus belle (étude `etude-imagerie-satellite.md`, juillet 2026)
- [x] **Étape 1 — IGN au maximum réel (gratuit)** : `maxzoom` 21→19 (zoom natif réel depuis que l'IGN a retiré la THR en mars 2025 — on demandait des tuiles inexistantes au zoom maison) ; **photo pure en mode Toits** : le voile papier `base-wash` et ~370 tracés du plan (routes en rubans blancs/jaunes, plans d'eau en aplats) étaient dessinés PAR-DESSUS l'ortho → masqués en Toits, restaurés en plan (seuls les noms de rues restent sur la photo) ; paint ortho adouci, dégressif avec le zoom ; variante « retina » WMS 512 px testable via `?ortho=wms2x` (A/B — colorimétrie du niveau pyramide à valider à l'écran).
- [ ] ⬜ **Étape 2 — POC Mapbox Satellite** (source raster dans MapLibre, autorisé officiellement, 750k tuiles/mois gratuites, @2x natif) : briac crée un token public gratuit → `VITE_MAPBOX_TOKEN` → comparaison côte à côte sur les zones prospectées, verdict du chef des ventes. Repli : Google 2D Tiles. MapKit JS non écarté mais dernier recours (réécriture complète, gain non démontré en pavillonnaire breton).

## Mesure de toiture LiDAR HD (SOP `sop-mesure-toiture-lidar.md`, juillet 2026)
- [x] **Cadrage + fondations vérifiées** : surface de toit quasi réelle (±3-5 % visés) depuis le nuage de points LiDAR HD IGN (open data, 0 €), en fond de fiche maison — pas de nouvelle carte. Dalle de test (Lesneven) trouvée via WFS, acquisition 12/2024, format COPC streamable (Range 206 testé). Phases avec GO/NO-GO dans le SOP.
- [x] **Phase 0 — spike technique** (`tools/lidar-spike/`) : pipeline complet fonctionnel sur 3 maisons de Lesneven (streaming COPC 2 Mo/maison en 3-6 s, pans + pentes + azimuts cohérents, cas « 2 dalles » résolu). Mesures +15 à +48 % vs estimation actuelle (débords + pentes réelles).
- [x] **Validation interne (sans vérité terrain)** : banc synthétique (`bench.mjs`, vérité mathématique, même code de mesure) → **erreur max 5,7 %** ; test toits plats réels (surface = emprise connue) → bug de double comptage multi-pans trouvé et corrigé (dédup des cellules).
- [ ] ⬜ **Gate G0 (précision externe)** : comparer sur 3-4 maisons de surface réellement connue — surfaces facturées du chef des ventes, ou auto-test briac (plans / facture / mesure pignon à l'inclinomètre).
- [x] **Phase 1 — durcissement (cœur)** : RANSAC déterministe, seuils adaptatifs à la densité, fusion des pans sur-segmentés, fermeture morphologique (banc à ±1,9 %), exclusion des mitoyens, ventilation par pan (principal/plat/secondaire → `totalPrincipal` pour le couvreur), gestion du rate-limit IGN (429 → concurrence 4 + backoff). Médiane vs cadastre Lyon : 15 % (l'estimation actuelle fait 34 % au même étalon).
- [x] **Gate G1 : PASSÉ** (`g1-suite.mjs`, 21 bâtiments, 4 scénarios) : pavillons 9,1 % / toits plats 12,6 % / mitoyens 8,7 % / boisés 16,3 % de médiane vs cadastre Lyon ; zéro crash — les cas pathologiques rendent des **verdicts** (`no_data`, `faible_confiance`, `grand_batiment`) au lieu de mentir ; végétation robuste (arbres jusqu'à 302 % de points sans dégrader la mesure).
- [x] **Phase 2 — intégration app** : mesure **dans le navigateur** (CORS IGN vérifié ouvert — pas d'Edge Function nécessaire, zéro infra), chunk séparé `data/lidar.ts` (copc + laz-perf wasm ~320 Ko chargés à la première mesure), déclenchée à la pose + backfill paresseux à l'ouverture des fiches anciennes, cache définitif en base avec **version d'algo** (un recalibrage post-G0 re-mesure tout paresseusement). Badge fiche : `137 m² toit` (style « confirmé », sans ~) quand le verdict est `ok`, sinon l'estimation reste affichée. **Migration `db/0008_toit_lidar.sql` À EXÉCUTER dans Supabase AVANT de tester** (sinon la carte ne charge plus les points).
- [x] **Gate G0 : VALIDÉ par le chef des ventes** (test en conditions réelles sur ses chantiers — GO donné le 24/07/2026). La mesure est officiellement fiable ; recalibrage possible à tout moment via bump de `LIDAR_VERSION`.
- [x] **Phase 3 — pans dessinés sur l'ortho** : à l'ouverture de la fiche d'une maison mesurée (avant prospection OU point posé), chaque pan s'affiche en polygone coloré semi-transparent sur la photo avec sa pastille « XX m² » (Geist Mono, bord teinté). Contours vectorisés au moment de la mesure (traçage de frontière + Douglas-Peucker adapté aux anneaux fermés — bug du DP fermé attrapé par test unitaire `tools/lidar-spike/test-outline.mjs`), stockés dans `toit_lidar_pans`, dessinés sans chevauchement. `LIDAR_VERSION` 1→2 : les maisons déjà mesurées régénèrent leurs contours à la prochaine ouverture de fiche. Puis passes cosmétiques v3 (lissage 1 m) et v4 (enveloppe morphologique pour les ardoises sombres à points épars, garde d'honnêteté < 60 %). Argument de vente : « voilà vos 4 pans, 137 m² » sur la tablette, devant la porte.
- [x] **Audit complet + durcissement (post-G0, juillet 2026)** : revue de code calcul + visuel + câblage (rapport dans le journal du SOP). Livré : tests **vitest sur le code shippé** (cœur pur extrait dans `lidar-core.ts`, banc synthétique seedé — `npm run test` dans `web/`) ; bâtiment le plus proche (≤ 10 m) au lieu d'un voisin WFS arbitraire ; **cache LiDAR partagé à l'équipe** (RPC security definer, migration `db/0009` exécutée) ; la re-mesure fraîche prime sur le cache périmé ; timeouts réseau (20 s/requête, 60 s/mesure → `error` re-tentable) ; verdict `grand_batiment` sans télécharger 2-3 Mo ; `toit_lidar_pans` sorti du SELECT global + `fetchPoints` paginé ; `azimut_deg` corrigé en azimut boussole (`LIDAR_VERSION` 4→5, re-mesure paresseuse). Hors périmètre assumé : Web Worker (si jank constaté sur le terrain).
- [x] **Maquette 3D du toit dans la fiche (fin juillet 2026)** : bouton « Voir le toit en 3D » (fiche point + fiche avant prospection) → toit du client manipulable au doigt, three.js en chunk séparé chargé au tap. En parallèle : **carte 3D (extrusion) retirée**. **v2** (rotation réparée, pans jointifs) puis **v3 après le 2e retour captures briac** : silhouette **ancrée sur le polygone BD TOPO** (gouttières droites, angles vrais — mêmes contours rectilignes sur l'ortho), murs droits extrudés de l'emprise avec pignons automatiques, débord de toit réel + ombre sur les murs, marches aux annexes basses, bandeau de rive, lumière maquette. **v4 (finition, 3e série de captures)** : échardes absorbées, noues aimantées aux coins des L, garde de silhouette, murs = hauteur BD TOPO − comble mesuré (fini les « donjons »), fentes comblées, pastilles triées. `LIDAR_VERSION` 9 (re-mesure paresseuse). Avis du chef des ventes à recueillir sur l'effet en rendez-vous.
- [x] **Confrontation factures + badge « la maison » (fin juillet 2026)** : autopsie des 2 chantiers du chef des ventes (`tools/lidar-spike/autopsy.mjs`) — Rosa Floch : corps principal mesuré **219 m² vs 223 facturés (−1,8 %)**, l'écart apparent (+36 %) venait du total qui incluait annexe plate et extension ; Deschard : sous-mesure réelle −15 % (pan mal ajusté + toit éclaté en 2 polygones BD TOPO + chutes facturées), à creuser. **Demande du chef des ventes actée** : le badge affiche désormais LA MAISON (corps principal par connectivité — les décrochés coupent, extensions/annexes/garages exclus), plus le grand total. `LIDAR_VERSION` 10.
- [ ] ⬜ **Quick wins estimation actuelle** (« étage 1 », ½ j, à valider) : débords de toit, toits plats, formes en L — améliore le fallback partout où le LiDAR ne peut rien.

## Prochains chantiers (à choisir avec briac)
- [ ] ⬜ **Écran de connexion** — dernier écran encore à l'ancien style ; l'habiller avec la DA (Geist/Lucide). Petit, rapide.
- [ ] ⬜ **Équipe (invitations)** — le manager partage un code ; les commerciaux s'inscrivent avec ce code et rejoignent SON agence (aujourd'hui chaque inscription = nouvelle agence isolée). Débloque le test réel à plusieurs. *Dépend un peu de l'ami (Q13-16).*
- [ ] ⬜ **Micro-ajustements métier** — après le retour de l'ami : statuts, flux RDV, définitions de stats (« contact » vs « impossible », etc. — voir `questions-ouvertes.md`).

## Idées / plus tard (hors MVP)
- Vue liste des points (filtres)
- Carnet de contacts / mini-CRM (clients à rappeler, R2)
- Chat / annonces manager
- Mode hors-ligne
- Mesure de toiture
- Multi-agences self-service + facturation
