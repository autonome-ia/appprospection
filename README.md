# AppProspection

Application de cartographie de prospection en porte-à-porte pour équipes commerciales.

**Contexte** : outil destiné aux commerciaux d'une entreprise de rénovation de toiture. Chaque commercial visualise une carte type Google Maps et pose un point sur chaque maison visitée (toqué, RDV pris, vendu, refus...). Objectif : cartographie temps réel des maisons et quartiers prospectés, visible d'un coup d'œil par toute l'équipe.

## Organisation du dépôt

| Dossier / fichier | Rôle |
|---|---|
| `docs/besoin-metier-brut.md` | Document rédigé par l'expert métier (chef des ventes). **Source non modifiée.** |
| `docs/SPEC.md` | Spécification produit que nous construisons ensemble à partir du besoin métier. **C'est le document de référence pour le développement.** |
| `docs/questions-ouvertes.md` | Points flous / décisions à valider avec l'expert métier. |
| `docs/etude-cartographie.md` | Étude comparative des fonds de carte (choix : MapLibre + IGN + BAN). |
| `docs/schema-bdd.md` | Explication du schéma de base de données. |
| `db/schema.sql` | Migration SQL Supabase (à exécuter dans l'éditeur SQL Supabase). |
| `web/` | Application (PWA React + TypeScript + Vite + MapLibre + Supabase). |

## Lancer l'application (dev)

```bash
cd web
npm install
npm run dev
```

L'app tourne en **« mode local »** (points en mémoire) tant que `web/.env` n'est pas configuré.
Le fond de carte IGN fonctionne **sans clé API**. Pour relier la base : copier `web/.env.example`
en `web/.env` et renseigner les identifiants Supabase, puis exécuter `db/schema.sql` dans Supabase.

## Statut

- [x] Dossier projet créé
- [x] Réception & transcription du document de besoin métier (`Script logiciel .pdf`, 5 pages)
- [x] Rédaction de la spec produit v0.1 (`docs/SPEC.md`)
- [x] Questions de clarification préparées (`docs/questions-ouvertes.md`)
- [x] Étude comparative des fonds de carte (`docs/etude-cartographie.md`)
- [x] Choix techniques : PWA + Supabase + MapLibre/IGN/BAN (voir `docs/SPEC.md` §7)
- [ ] Session de clarification avec l'expert métier (soir du 2026-07-16)
- [x] Schéma de base de données (`db/schema.sql` + `docs/schema-bdd.md`)
- [x] Échafaudage du projet (PWA React + Supabase + MapLibre) — carte IGN fonctionnelle
- [x] Connexion Supabase : auth (email/mot de passe), persistance des points + journal, temps réel
- [ ] **À faire côté Supabase** : exécuter `db/schema.sql` + désactiver la confirmation d'email
- [ ] Développement du MVP (agenda, stats, détail d'un point)
