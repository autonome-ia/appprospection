# CLAUDE.md — AppProspection

> Fiche d'onboarding lue automatiquement par Claude Code au démarrage d'une session
> ouverte dans ce dossier. Objectif : qu'une nouvelle conversation retrouve tout le contexte.

## Le projet
PWA **mobile-first** de prospection **porte-à-porte** pour commerciaux en **rénovation de toiture** (France).
Chaque commercial pose des points (statuts) sur les maisons visitées, sur une **carte partagée temps réel** ;
les RDV vont dans un **agenda** ; le manager pilote via des **statistiques**.
Porteur : **briac** (développeur). Besoin métier fourni par un ami **chef des ventes**.
Ambition : **outil interne d'abord**, puis **SaaS multi-agences** si concluant.

## Démarrer une session (rituel)
1. Ouvrir la session **dans ce dossier** (`C:\Users\briac\AppProspection`) pour que ce fichier se charge.
2. Lire **`docs/roadmap.md`** = état d'avancement + prochains chantiers (LA source de vérité du « où on en est »).
3. Docs utiles : `docs/SPEC.md` (spec produit), `docs/schema-bdd.md`, `docs/etude-cartographie.md`,
   `docs/questions-ouvertes.md` (points à valider avec l'ami).
4. **À la fin d'un chantier** : mettre à jour `docs/roadmap.md` (cocher le fait) et ce fichier si une
   décision structurante change.

## Structure du repo
- `web/` — l'application (Vite + React 19 + TS). **C'est là qu'on code.**
- `docs/` — spec, roadmap, études, questions ouvertes.
- `db/` — migrations SQL Supabase (`schema.sql` = migration 0001 ; `0002_agenda_stats.sql`).

## Stack
- **Front** : PWA Vite + React 19 + TypeScript.
- **Carte** : **MapLibre GL JS** + tuiles **IGN** (Plan IGN vectoriel + ortho BD ORTHO) ; géocodage **BAN**
  (`data.geopf.fr/geocodage`). Aucune clé nécessaire pour la carte.
- **Backend** : **Supabase** (Auth email/mot de passe, Postgres, Realtime, RLS multi-tenant).
  Projet : `xmrendifislsdlwytnlp`.
- **Déploiement** : **Render** (Static Site, blueprint `render.yaml`), repo GitHub
  `autonome-ia/appprospection`. `git push` → **redéploiement automatique** (~1-2 min). PWA installable.

## Commandes
```
cd web
npm install
npm run dev      # dev local -> http://localhost:5173
npm run build    # DOIT passer (tsc + vite) avant tout commit
```
Workflow type : coder → `npm run build` (vérifie) → commit → `git push` → Render déploie → tester
(sur mobile : fermer/rouvrir la PWA, ou Safari + rafraîchir).

## Variables d'environnement (`web/.env`, NON versionné)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (obligatoires). Aussi à renseigner dans Render.
- La clé anon Supabase est publique par nature (protégée par RLS). Ne jamais committer `.env` ni la `service_role`.

## Décisions actées (ne pas re-débattre)
- **Multi-tenant** dès le départ (`organization_id` + RLS), MAIS pas d'inscription publique ni facturation au MVP.
- **Statuts : 7 valeurs d'enum, 6 statuts AFFICHÉS** — `absent`, `a_revoir`, `impossible` (libellé « Refus »), `hors_cible` (25/07), `rdv_pris`, et la **fusion « Client »** (29/07 soir, retour chef des ventes) : `vendu` + `ancien_client` partagent libellé « Client », vert #17b26a et glyphe ✓ (`domain/status.ts` : `DISPLAY_STATUSES`, `sameDisplayStatus`). **La vente est un ÉVÉNEMENT, pas un état** : l'issue RDV « Vendu » OU la bascule manuelle « RDV pris » → « Client » écrivent `vendu` (comptées au tunnel — refonte 29/07 soir) ; pose directe, saisie Contacts et bascule depuis un autre statut écrivent `ancien_client` (une porte, jamais une vente). L'enum reste double en base : le journal garde la vérité, fusion réversible. Ajouter un statut = migration enum (modèle `db/0013`/`0015`) + `domain/status.ts` + glyphe `config/markers.ts` + token `--st-*` (index.css), le reste suit.
- **Pas de mode hors-ligne** (réseau supposé sur le terrain).
- **Pas de vue rue / Street View** : testé puis abandonné (Mapillary trop juste en pavillonnaire ;
  3D photoréaliste Google bloquée pour les entités françaises).
- **Carte** = MapLibre + IGN. **AFFICHAGE UNIQUE : photo (ortho IGN) permanente** — la vue Plan a été RETIRÉE (25/07/2026, personne ne s'en servait), puis les imageries alternatives **testées et écartées le même jour** : « HD » WMS 512 px (aucune différence perçue) et Esri/Maxar (30-50 cm, trop floue vs BD ORTHO 20 cm). L'ortho IGN est LA plus nette gratuite en France ; ne re-proposer une 2e imagerie que payante/à clé (Google Map Tiles, Mapbox — étude imagerie). La **3D carte (extrusion des bâtiments) a été RETIRÉE** (juillet 2026, décision briac) : prismes à toit plat sans valeur terrain — remplacée par la **maquette 3D du toit mesuré** dans la fiche maison (three.js, chunk séparé).
- **Maquette 3D** : **WebGLRenderer conservé** — pas de migration WebGPURenderer (bundle plus lourd, zéro gain pour ~20 meshes) ; **MeshLambert + MSAA natif** délibérés (Standard/FXAA contre-productifs sur mobile sans post-processing). ~142 Ko gz = plancher du chunk three. **L'avant/après matériau (« Votre toit en… ») et le select « Toiture constatée » ont été RETIRÉS** (25/07/2026, décision briac : sans valeur terrain) — la 3D s'affiche toujours en mode mesure (une couleur par pan) ; `mat_toit_confirme` reste en base (anciens points).
- **Agenda** : **vue mois plein écran par défaut** (26/07/2026 — retour assumé sur le « jour d'abord » C1, testé puis rejeté sur le terrain par briac) ; le planning d'un jour s'ouvre en **sheet vaul** au tap sur sa case. Agenda **partagé** par défaut + chip « Mes RDV », couleur = **commercial** dans la grille (décisions chef des ventes, ne pas re-débattre).
- **Géoplateforme** : **1 seule couche par appel WFS/WMS-V** (limite IGN au 15/06/2026 — ne jamais regrouper des TYPENAMES) ; la doc IGN vit sur **cartes.gouv.fr** (geoservices.ign.fr = redirections). `copc`/`laz-perf` figés en versions exactes ; toujours passer `{ lazPerf }` à `Copc.loadPointDataView` (sinon un 2e wasm s'instancie).

## Direction artistique (IMPORTANT)
DA **« Encre & signal »** (choisie par briac le 26/07/2026 sur prototypes comparés — remplace « Clair & précis »).
- **Encre quasi noire** (#111113) sur papier neutre, **relief marqué** (ombres franches, les cartes décollent).
- **UN seul accent : l'orange signal** (`--accent: #f54e00`) — réservé aux **actions, liens et états actifs**.
  JAMAIS pour de la donnée : les statuts gardent leurs couleurs sémantiques (« RDV pris » reste bleu,
  « Vendu » vert, « À revoir » ambre — couleur = statut sur la carte, couleur = commercial dans l'agenda).
- **Doctrine typo (26/07, bilan briac « trop de polices »)** : **Geist partout** — y compris les labels de
  section `.eyebrow` (Geist 11 uppercase 600 letterspacé, plus de mono) ; **Geist Mono STRICTEMENT réservé
  aux données chiffrées** (heures, m², compteurs, tableaux, cotes — `.tnum`). Dans une ligne mixte, seuls
  les nombres sont en mono (les dates/heures composées comptent comme données). **Échelle fermée de 8
  crans : 10 (micro, grille du mois seulement) · 11 (labels) · 12 (métas) · 13 (secondaire) · 15 (corps,
  actions) · 17 (titres de bloc) · 24 (titres d'écran) · 42 (héros)** — jamais de demi-pixels ni de
  tailles hors échelle. Graisses : 400/500 (courant), 600 (emphase), 650 (chiffres/titres forts).
- Icônes **Lucide** — **JAMAIS d'emojis** comme icônes.
- **Vaul** (bottom sheets / drawers), **Sonner** (toasts), **Motion** (animations).
- Tokens CSS dans `web/src/index.css` ; DA aussi cuite en TS : `config/markers.ts` (marqueurs/clusters),
  `MapView.tsx` (ACCENT halos/réticule), `lib/report-image.ts` (rapport client) — à garder alignés.
- **Mode sombre optionnel (29/07/2026, variante « Ligné » choisie sur planches)** : `[data-theme="dark"]`
  sur `<html>` — tokens dans `index.css`, préférence localStorage (`lib/theme.ts`), sélecteur
  Clair · Sombre · Auto dans la sheet « Profil & réglages » de l'Accueil (roue dentée + avatar), script
  inline `index.html` avant le premier rendu (pas de flash). **Clair = défaut, attribut ABSENT : aucun
  pixel du clair ne doit jamais bouger** (diff strict par les sondes). En sombre, le relief passe des
  ombres aux **bordures** (hairlines + anneau 1 px dans les tokens d'ombre) ; boutons à fond `var(--ink)`
  → blanc pur + texte nuit ; « Refus »/« Hors cible » éclaircis en sombre seulement (teinte inchangée).
  Règles : le **rapport client reste PAPIER** (tokens clairs re-déclarés sur `.roof-report-overlay`) ;
  tout élément posé sur la photo ou un canvas (pastilles m², boutons du viewer 3D) = **encre littérale
  #111113, jamais `var(--ink)`** ; marqueurs, clusters, halos MapView, rapport canvas : inchangés.
  Sondes des deux thèmes : `THEME=dark node check-accueil.mjs` / `check-stats.mjs`, `probe-theme.mjs`.
- Prototypage DA : `tools/screenshots/da-shots.mjs` (injection de tokens + captures comparées).
- Ne jamais retomber dans le look « IA générée » (emojis, composants basiques, styles génériques).

## Architecture data (rappel)
- `points` = état **actuel** d'une maison (ce qu'on affiche sur la carte).
- `point_events` = **journal horodaté** de chaque visite → **source des statistiques**.
- `appointments` = agenda partagé : **RDV et tâches libres** (colonne `kind`, db/0016 — une tâche
  « aller chercher l'acompte » n'a ni point, ni issues, et ne compte dans AUCUNE stat ; sa note est
  son titre). Poser/éditer un statut écrit dans **points ET point_events**.
- **Issues de RDV (refonte 29/07 soir)** : chaque issue fait suivre LE POINT — « Vendu » → Client
  (`vendu`, LA vente du tunnel), « En attente » (valeur `effectue`) → À revoir + relance J+7,
  « Refus » (`refus`, db/0017) → Refus, « Annulé » → rien + bouton « Replanifier ». « Manqué » retiré
  des boutons (valeur conservée pour l'historique). **« En attente » est un état OUVERT** : le RDV
  continue de proposer « Vendu » / « Refus » sans limite de date (la réponse du prospect se donne
  sur le MÊME RDV — vente différée comptée ; « Vendu » efface la relance). La vente compte AUSSI
  par bascule manuelle « RDV pris » → « Client » (écrit `vendu` + synchronise le RDV lié). Stats :
  « RDV effectués » = en attente + vendus + refusés (RDV tenus) ; les annulés ne comptent nulle part.
  **La date du réel (30/07)** : solder un RDV « à venir » date visite/vente au JOUR DU RDV
  (`occurred_at = scheduled_at`) — conclure un « En attente » ou basculer à la main = daté du jour
  du geste. **Popup du matin** (`PendingOutcomes`) : 1re ouverture du jour, RDV passés sans issue →
  « Que s'est-il passé ? » (4 issues en 1 tap, « Plus tard » non bloquant) ; jamais affiché sous
  Playwright (`navigator.webdriver`), forçable par `?popup-rdv` pour les sondes dédiées.

## État actuel
Voir **`docs/roadmap.md`**. En résumé : les 4 onglets (Accueil · Carte · Agenda · Stats) fonctionnent,
la DA premium est appliquée partout (écran de connexion compris depuis le 09/08), l'app est déployée sur
Render et installable. **Chantier Équipe en cours (09/08)** : 4 rôles (`manager`, `chef_ventes`,
`secretaire`, `commercial` — db/0018-0019, inscription par code OBLIGATOIRE, désactivation de compte),
l'agence réelle « Mister Toiture : Brest » est amorcée avec les 5 comptes historiques. ⚠ L'écran de
connexion est LE point d'entrée des sondes Playwright : placeholders « Email » / « Mot de passe » et
bouton « Se connecter » à ne JAMAIS renommer. Restent : écran Équipe (étape 3), UI par rôle (étape 4,
matrice à documenter ici), banc RLS `tools/rls-test/` à dérouler.
