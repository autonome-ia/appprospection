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
- **5 statuts figés** : `absent`, `a_revoir`, `impossible`, `rdv_pris`, `vendu`.
- **Pas de mode hors-ligne** (réseau supposé sur le terrain).
- **Pas de vue rue / Street View** : testé puis abandonné (Mapillary trop juste en pavillonnaire ;
  3D photoréaliste Google bloquée pour les entités françaises).
- **Carte** = MapLibre + IGN. Vue **« Toits » (ortho) par défaut**. 3D = extrusion des bâtiments (hauteurs IGN).

## Direction artistique (IMPORTANT)
Design premium **« Clair & précis »** (réf. **Linear / Vercel / Emil Kowalski**).
- Police **Geist** (UI) + **Geist Mono** (chiffres, heures, stats).
- Icônes **Lucide** — **JAMAIS d'emojis** comme icônes.
- **Vaul** (bottom sheets / drawers), **Sonner** (toasts), **Motion** (animations).
- Tokens CSS (couleurs, ombres, rayons, mouvement) dans `web/src/index.css`.
- Ne jamais retomber dans le look « IA générée » (emojis, composants basiques, styles génériques).

## Architecture data (rappel)
- `points` = état **actuel** d'une maison (ce qu'on affiche sur la carte).
- `point_events` = **journal horodaté** de chaque visite → **source des statistiques**.
- `appointments` = agenda partagé (RDV). Poser/éditer un statut écrit dans **points ET point_events**.
- Un RDV marqué « Vendu » rebascule le point en `vendu`.

## État actuel
Voir **`docs/roadmap.md`**. En résumé : les 4 onglets (Accueil · Carte · Agenda · Stats) fonctionnent,
la DA premium est appliquée partout (sauf l'écran de connexion), l'app est déployée sur Render et installable.
