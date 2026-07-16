# Étude comparative — fond de carte (juillet 2026)

> Recherche menée pour choisir la brique cartographique d'AppProspection.
> Besoins : carte mobile, milliers de marqueurs colorés par statut, géocodage d'adresses **françaises**, **imagerie aérienne pour voir les toits**, coût maîtrisé, compatible SaaS multi-agences.
> Sources détaillées et estimations en fin de section de chaque option.

## TL;DR — Recommandation

**Stack retenue (reco) : MapLibre GL JS + imagerie aérienne IGN (BD ORTHO®) + géocodage BAN, tuiles de fond via MapTiler (gratuit) au départ.**

Pourquoi c'est le meilleur choix **pour ce projet français précisément** :
- **Coût quasi nul** : ~0 €/mois à 5 commerciaux, ~10–20 $/mois même à 50 (vs plusieurs centaines de $ avec Google/Mapbox à cette échelle).
- **Meilleure vue des toits** : l'ortho-photo aérienne **IGN (20 cm, parfois 5 cm)** est *supérieure* à l'imagerie satellite Google/Mapbox sur beaucoup de zones françaises. C'est notre cœur de métier (toiture).
- **Meilleur géocodage FR** : la **BAN** (Base Adresse Nationale, officielle) est gratuite, précise au numéro de rue, **et on a le droit de stocker les coordonnées** (crucial pour une base de prospection persistante).
- **Pas de lock-in, RGPD-friendly, souverain** (données publiques françaises).

Seul inconvénient : **un peu plus d'assemblage** que Google « clé en main ». Comme c'est moi (le dev) qui code, cet effort est absorbable et ne pèse pas sur toi.

---

## Tableau comparatif de synthèse

| Critère | **MapLibre + IGN + BAN** (reco) | Google Maps Platform | Mapbox |
|---|---|---|---|
| Coût 5 commerciaux | **~0 €** | 0–20 $ | ~0 $ |
| Coût 50 commerciaux | **~10–20 $** | ~150–350 $ | 0–200 $ |
| Palier gratuit | Illimité (IGN/BAN) + MapTiler 100k | 10 000 map loads/SKU/mois | 50 000 map loads/mois |
| Imagerie toits FR | **Ortho IGN 20 cm (excellente)** | Satellite bonne | Satellite bonne (inclut IGN) |
| Géocodage FR | **BAN : officiel, niveau maison, gratuit** | Très bon mais payant | Moyen en rural |
| Stockage des coordonnées | **Autorisé (BAN)** | ⚠️ cache 30 j max (ou place_id) | ⚠️ Permanent payant (5$/1000) |
| Marqueurs en masse | Oui (WebGL) | Oui (Advanced Markers, illimité) | Oui (symbol layer WebGL) |
| Mélange avec autre carte | Libre | ⚠️ **interdit** | Libre |
| Effort d'intégration | Moyen (assemblage) | Faible (clé en main) | Faible/moyen |
| Lock-in / souveraineté | **Aucun / souverain** | Fort (Google) | Moyen (Mapbox) |

---

## Détail par option

### Option A — MapLibre + IGN + BAN (RECOMMANDÉE)

- **MapLibre GL JS** : moteur de rendu WebGL open-source (fork de Mapbox GL v1), **gratuit, sans clé, sans quota**. Rend des milliers de marqueurs, clustering natif, gestes tactiles mobiles, marqueurs HTML colorés par statut. Ne fournit *que* le moteur → il faut y brancher des tuiles + un géocodeur.
- **Fond de carte (tuiles vectorielles)** :
  - **MapTiler Cloud** : 100 000 requêtes tuiles + 5 000 sessions/mois gratuits, usage commercial autorisé. → idéal pour **démarrer sans setup**.
  - **Protomaps (PMTiles)** : fichier auto-hébergeable (extraction « France » de quelques Go) servi depuis **Cloudflare R2 (~11 $/mois pour 10 M requêtes, egress gratuit)**. → à basculer plus tard pour zéro dépendance de quota. MapLibre rend ce changement trivial.
- **Imagerie aérienne toits — IGN BD ORTHO®** : WMTS **gratuit, sans clé, usage commercial autorisé** (Licence Ouverte Etalab 2.0). Couche `ORTHOIMAGERY.ORTHOPHOTOS`, projection Web Mercator, consommable directement par MapLibre en source raster. Résolution 20 cm (jusqu'à 5 cm par endroits) → **on distingue nettement une toiture, sa forme, son orientation**. Limite de débit 40 req/s (à lisser par cache/CDN à grande échelle).
- **Géocodage — BAN / Géoplateforme** : gratuit, sans clé, précision au numéro, autocomplétion incluse, **coordonnées stockables**. ⚠️ **Migration importante** : l'endpoint passe de `api-adresse.data.gouv.fr` à **`https://data.geopf.fr/geocodage/search/`** (l'ancien domaine cesse de rediriger le **14 avril 2026** — coder directement contre le nouveau). Limite 50 req/s.
- **Inconvénients** : assemblage à faire soi-même ; limites de débit IGN/BAN à gérer par cache à grande échelle ; zone grise licence IGN sur le *téléchargement massif brut* (mais **la diffusion via WMTS que nous utilisons est bien dans le cadre gratuit autorisé**) — à reconfirmer auprès de l'IGN avant gros volume SaaS.

### Option B — Google Maps Platform

- **Modèle 2025+** : plus de crédit universel de 200 $ ; désormais **quota gratuit par produit** (~10 000 map loads/mois pour Dynamic Maps). Au-delà : **7 $/1 000 map loads**, géocodage **5 $/1 000**.
- **Marqueurs** : facturés au map load, **pas au nombre de marqueurs** → milliers de points = même prix. Utiliser `AdvancedMarkerElement`.
- **Satellite** : `mapTypeId: 'satellite'` **sans surcoût**, bonne qualité FR.
- **⚠️ Contraintes fortes** : (1) coordonnées géocodées **cachables 30 jours max** (sinon stocker le `place_id`) → gênant pour une base persistante ; (2) **interdiction d'afficher du contenu Google avec une carte non-Google** ; (3) attribution/logo Google obligatoires.
- **Avantage** : le plus « clé en main », UX familière. **Inconvénient** : coût qui grimpe vite à l'échelle, lock-in, contraintes de stockage.

### Option C — Mapbox

- **Palier gratuit généreux** : 50 000 map loads/mois, puis 5 $/1 000 (dégressif). Géocodage : 100 000/mois gratuits en *Temporary* (**stockage interdit**) ; *Permanent* (stockable) = 5 $/1 000 sans palier gratuit.
- **Marqueurs** : excellent rendu WebGL via `symbol`/`circle layer` GeoJSON (data-driven par statut) — cas d'usage natif.
- **Satellite** : bonne résolution, **intègre même de l'imagerie IGN** en France.
- **⚠️ Contraintes** : stockage géocodage (Temporary vs Permanent), interdiction de cacher/redistribuer les tuiles, attribution obligatoire, clause « no derivative basemaps ».
- **Avantage** : quasi gratuit à notre échelle si carte persistante + géocodage délégué à la BAN. **Inconvénient** : moins bon géocodage FR rural, facturation USD à la session (maîtriser le cycle de vie de la carte).

---

## Points de vigilance techniques communs (valables quel que soit le choix)

1. **Coût = nombre de « map loads »**, pas nombre de marqueurs. → Concevoir la PWA en **SPA à carte persistante** (1 chargement par session), ne pas recréer la carte à chaque navigation d'écran. C'est LE facteur qui distingue 0 € de plusieurs centaines de $.
2. **Marqueurs en masse** : jamais de marqueurs DOM au-delà de ~100 → utiliser des **couches WebGL (GeoJSON symbol/circle)** + clustering.
3. **Géocodage via la BAN** dans tous les scénarios (gratuit, précis FR, stockable) — même si on prenait Google/Mapbox pour l'affichage.

## Ré-étude Mapbox + passage au Plan IGN vectoriel (2026-07-16)

Question soulevée : les cartes de mapbox.com paraissent « incroyables » — a-t-on eu tort d'écarter Mapbox ?

Conclusion (étude approfondie, un sous-agent) : **non**. Le rendu impressionnant de Mapbox = **vectoriel + 3D + éclairage**, pas un secret propriétaire. Notre moteur **MapLibre est le fork de Mapbox GL** et fait tout ça (vecteur, 3D `fill-extrusion`, terrain, globe, ciel). Le « manque de beauté » venait de notre **fond raster IGN**, pas de MapLibre.

Exclusif à Mapbox (non réplicable) : le style « Mapbox Standard », ses ~6 500 landmarks 3D et façades texturées — **aucune ville française couverte**, sans valeur pour repérer une toiture.

Contraintes Mapbox rédhibitoires pour ce projet : facturation aux map loads + lock-in (SDK/style propriétaires), et surtout **POI interdits pour la génération de leads / le ciblage** (frotte avec un usage prospection).

**Action réalisée** : le fond « plan » est passé du **raster IGN** au **Plan IGN VECTORIEL** gratuit (style `https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json`), net/fluide/moderne, en gardant l'ortho IGN raster pour le mode « toits ». Upgrade visuel majeur, coût nul, sans changer de stack.

Pistes premium ultérieures si besoin d'un rendu encore plus « SaaS moderne » : MapTiler (Streets/Outdoor), Protomaps auto-hébergé, + bâtiments 3D (OSM/BD TOPO) via `fill-extrusion`.

## Incertitudes à lever

- Comptage réel des map loads dans notre PWA → à mesurer sur un prototype.
- Usage commercial IGN à très gros volume / conditions exactes → confirmer auprès de l'IGN avant la phase SaaS multi-agences.
- Débit BAN/IGN (40–50 req/s) → gérer par cache/CDN quand le nombre d'agences grandit.
