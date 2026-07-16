# SPEC produit — AppProspection

> Document de référence pour le développement. Construit à partir de `besoin-metier-brut.md`.
> Statut : **v0.1 — à valider avec l'expert métier** (voir `questions-ouvertes.md`).
> Les points marqués 🟡 dépendent d'une réponse encore attendue.

---

## 1. Vision & problème

Les commerciaux d'une entreprise de rénovation de toiture prospectent en **porte-à-porte**. Aujourd'hui, rien ne permet de savoir, d'un coup d'œil, **quelle maison / quel quartier a déjà été visité, par qui, et avec quel résultat**. Résultat : maisons re-toquées inutilement, zones oubliées, aucun pilotage terrain.

**AppProspection** est une application **mobile-first** de cartographie de prospection en temps réel : chaque commercial pose un point sur la maison qu'il visite avec un statut, et toute l'équipe partage la même carte vivante. Le manager pilote l'activité (RDV, ventes, classement) depuis des tableaux de bord.

## 2. Utilisateurs & rôles

| Rôle | Description | Accès clés |
|---|---|---|
| **Commercial** | Prospecteur terrain, sur mobile. | Sa carte + carte équipe, pose des points, son agenda, ses stats, son carnet de contacts, chat. |
| **Manager** | Chef des ventes / responsable d'agence. | Tout ce que voit un commercial + stats globales agence, classement, poste des messages dans le chat. |

🟡 Un manager prospecte-t-il aussi (pose des points) ou est-il purement en supervision ? (voir Q rôles)

## 3. Modèle produit (interne d'abord, SaaS ensuite)

**Décision (2026-07-16)** : le produit démarre comme **outil interne** pour l'agence de l'expert. **Objectif à terme** : le vendre à d'autres agences de rénovation **si l'usage est concluant dans son équipe**.

- Le MVP sert **une seule organisation** (son agence). Pas d'inscription self-service, pas de facturation.
- Notion d'**organisation / agence** = un espace isolé regroupant une équipe.
- Toutes les données (carte, agenda, stats) sont **partagées à l'intérieur d'une organisation** et **strictement cloisonnées entre organisations**.
- Formules évoquées pour plus tard : **compte seul** (indépendant) et **compte équipe**.

> ⚠️ Implication technique : on **conçoit multi-tenant dès le départ** (chaque donnée porte un `organization_id`, cloisonnement strict) pour ne pas avoir à tout refondre au moment de commercialiser — **mais on ne construit pas** l'inscription publique ni la facturation dans le MVP. Coût quasi nul aujourd'hui, gros gain plus tard.

## 4. Écrans & fonctionnalités

Navigation principale : barre inférieure à 4 entrées → **Accueil · Carte · Agenda · Statistiques**. Chat accessible en complément.

### 4.1 Connexion / Onboarding
- Écran de connexion + création de compte (illustration, phrase d'accroche, nom du logiciel).
- **Tutoriel** intégré : succession d'écrans/photos expliquant le fonctionnement.
- Accès **profil** (réglages, photo de profil) depuis l'accueil.

### 4.2 Accueil
- Point d'entrée après connexion.
- Accès profil (haut/gauche) et case « tutoriel ».
- 🟡 Contenu exact à définir (résumé du jour ? raccourcis ? notifications ?). Non détaillé par l'expert.

### 4.3 Carte *(cœur de l'app)*
- Carte plein écran, style Google Maps.
- **Recherche d'adresse.**
- **Poser un point** sur une maison, avec un **statut** parmi une liste figée (voir §5).
- Chaque point = maison géolocalisée + statut + auteur + horodatage.
- **Carte volontairement épurée** : elle n'affiche **que les marqueurs colorés par statut**, rien d'autre (pas de stats, pas de surcharge d'infos). Objectif = lisibilité terrain d'un coup d'œil. Les détails d'un point s'ouvrent au clic.
- **Carte partagée équipe** : chacun voit les points de tous, avec distinction visuelle (couleur/icône par statut ; 🟡 distinction par commercial aussi ?).
- **Vue « Liste »** : listing de tous les points posés (filtrable — 🟡 filtres à définir).
- **Outil de mesure de toiture** : mesure d'une surface de toit vue du dessus (approximatif, « style Google Earth »). Fonction **secondaire/pratique**, pas critique.
  - ✅ **Décision (2026-07-16) : hors MVP.** Gros chantier (photogrammétrie / tuiles satellite) pour un usage « nice to have ». Reporté en v2+.

### 4.4 Agenda
- **Agenda partagé** commun à toute l'équipe.
- Les **RDV pris** (via un point de statut « RDV pris ») **s'inscrivent automatiquement** dans l'agenda.
- **Une couleur par commercial** pour la lisibilité (référence citée : « Groupcall »).
- 🟡 Vues attendues (jour/semaine/mois), édition manuelle d'un RDV, rappels ? À préciser.

### 4.5 Statistiques / Analyse
- **Destination : les managers.** Cet écran sert au **pilotage de la performance des commerciaux**, il est distinct de la carte (qui reste épurée). Un commercial voit ses propres stats ; le manager voit celles de toute l'agence.
- **Deux niveaux de tableau** :
  - **par vendeur** : ses propres stats ;
  - **global agence** : réservé au manager.
- Indicateurs cœur :
  - nombre d'**absents** rapporté au **nombre de points** posés ;
  - nombre de **RDV pris** ;
  - nombre de **RDV effectués** ;
  - nombre de **ventes** ;
  - suivi d'un **objectif de RDV**.
- **Granularité temporelle** : jour / semaine / mois.
- **Classement des vendeurs.**
- **Graphique** journalier : portes toquées, prospects vus, refus, RDV pris.

### 4.6 Carnet de contacts (mini-CRM)
- Suivi des contacts qualifiés issus du terrain :
  - **clients à rappeler**,
  - **R2 à positionner** (2ᵉ rendez-vous à caler),
  - carnet de contacts général.
- 🟡 Champs d'une fiche contact à définir (nom, adresse, tél, notes, lien vers le point carte).

### 4.7 Chat / Communication
- Espace où le **manager poste des messages à toute l'équipe** (annonces).
- 🟡 Périmètre à trancher : simple canal d'annonces (manager → équipe) ou messagerie complète (commerciaux entre eux, DM) ? L'expert lui-même hésite (« est-ce qu'on peut partager ce qu'on veut ? »).

## 5. Statuts d'un point (FIGÉ — 5 statuts)

**Décision (2026-07-16, Hypothèse A)** : liste fixée à **5 statuts**. « Hors cible » et « impossible » sont fusionnés en un seul statut **« Impossible »**. Facile à faire évoluer plus tard si le terrain le demande.

| Statut | Sens | Déclenche |
|---|---|---|
| **Absent** | Personne / pas d'ouverture au moment de la visite | Compté dans « absents » |
| **À revoir** | Repasser plus tard (a remplacé « refus » dans le doc) | — |
| **Impossible** | Pour une raison X ou Y, inutile d'y retourner (pas cible : locataire, immeuble, pas de projet ; ou inaccessible : portail, digicode…). Statut « on n'y revient pas ». | — |
| **RDV pris** | Rendez-vous obtenu | ➜ création auto d'un RDV dans l'agenda + compteur |
| **Vendu** | Vente conclue | ➜ comptée dans les ventes |

> « Transfert automatique » = poser un statut sur la carte alimente automatiquement l'agenda (RDV pris) et les statistiques.

## 6. Règles & flux transverses

- **Temps réel** : un point posé par un commercial est visible par l'équipe rapidement (idéalement live, sinon à la synchro).
- **Automatisations** : `RDV pris` → agenda ; tous statuts → compteurs stats ; `Vendu` → ventes.
- **Cloisonnement** : données visibles uniquement au sein de l'organisation.

## 7. Contraintes techniques identifiées

- **Mobile-first** (croquis = téléphone). ✅ **Décision** : pas d'app native stores au départ → **web app / PWA** (techno en discussion).
- **Géolocalisation** + fond de carte tiers (Google Maps / Mapbox / MapLibre+OSM — à choisir ; impact coût & quotas).
- ✅ **Décision** : **pas de mode hors-ligne au MVP** — on suppose du réseau sur le terrain. À réévaluer en v2 si les commerciaux manquent de 4G.
- **Multi-tenant** (voir §3).
- **RGPD** : on stocke des **adresses de particuliers associées à un statut commercial** = données personnelles → base légale, durée de conservation, droit à l'effacement à cadrer.
- **Temps réel** : Supabase Realtime.

### Stack technique (décidée — 2026-07-16)
- **Backend / base** : ✅ **Supabase** (Auth + Postgres + Realtime + cloisonnement multi-tenant via Row Level Security).
- **Front** : ✅ **web app / PWA** mobile-first (framework à confirmer, penchant React).
- **Carte** : ✅ **MapLibre GL JS** (moteur de rendu open-source, gratuit).
  - **Fond de carte** : ✅ **Plan IGN VECTORIEL** (style officiel `PLAN.IGN/standard.json`, gratuit, sans clé, net/fluide). Alternatives premium possibles plus tard (MapTiler, Protomaps/PMTiles auto-hébergé). Choix confirmé après ré-étude de Mapbox (voir `etude-cartographie.md` §Mapbox) : le rendu « waouh » vient du vectoriel, que MapLibre gère nativement — Mapbox non retenu (coût, lock-in, licence POI interdite pour lead-gen, pas de données 3D françaises).
  - **Imagerie toits** : **IGN BD ORTHO®** via WMTS gratuit (couche `ORTHOIMAGERY.ORTHOPHOTOS`) — ortho-photo aérienne 20 cm, idéale pour voir les toitures.
  - **Géocodage / recherche d'adresse** : **BAN (Base Adresse Nationale)** via `https://data.geopf.fr/geocodage/search/` — gratuit, précis au numéro, coordonnées **stockables**. ⚠️ ne pas utiliser l'ancien domaine `api-adresse.data.gouv.fr` (redirection stoppée le 14/04/2026).
- **Marqueurs** : couches WebGL (GeoJSON symbol/circle, data-driven par statut) + clustering — **jamais** de marqueurs DOM au-delà de ~100.
- **Règle d'archi coût** : PWA en **SPA à carte persistante** (1 « map load » par session) pour minimiser les coûts de tuiles.

> Détail complet des alternatives et sources : voir `etude-cartographie.md`.

## 8. Périmètre MVP (proposition — à valider)

Objectif : le plus court chemin vers un outil **réellement utilisable sur le terrain** par l'équipe de ton ami.

**Dans le MVP**
1. Auth + organisation (une seule agence au départ) + rôles commercial/manager.
2. Carte partagée + pose de points avec statuts figés + recherche d'adresse.
3. Vue liste des points.
4. Agenda partagé avec création auto des RDV (couleur par commercial).
5. Stats de base (compteurs par vendeur + global) + classement.

**Hors MVP (v2+)** — à confirmer
- Outil de mesure de toiture.
- Mini-CRM complet (rappels, R2).
- Chat / annonces.
- Mode hors-ligne avancé.
- Graphiques riches, objectifs paramétrables.
- Facturation / self-service multi-agences.

> 🟡 Cette découpe MVP est **notre proposition** ; à arbitrer avec l'expert ce soir.

## 9. Hors périmètre (pour l'instant)

- Facturation et gestion des abonnements.
- Intégrations tierces (CRM externe, logiciel de devis toiture).
- Web app desktop dédiée manager (à évaluer plus tard ; le manager peut utiliser le mobile au début).
