# Schéma de base de données — AppProspection (MVP)

> Cible : **Supabase / PostgreSQL**. SQL exécutable : `../db/schema.sql` (migration `0001_init`).
> Multi-tenant dès le départ, cloisonné par **Row Level Security (RLS)**.

## Vue d'ensemble (modèle relationnel)

```
organizations 1 ──< profiles            (une agence a plusieurs utilisateurs)
organizations 1 ──< points              (les maisons pointées sur la carte)
organizations 1 ──< point_events        (le journal des visites)
organizations 1 ──< appointments        (l'agenda partagé)

profiles      1 ──< points (created_by)
profiles      1 ──< point_events (author_id)
profiles      1 ──< appointments (commercial_id / created_by)

points        1 ──< point_events         (une maison, plusieurs visites)
points        1 ──< appointments         (une maison peut générer un RDV)
```

## Les tables

| Table | Rôle | Points clés |
|---|---|---|
| **organizations** | Une agence = un « tenant ». | Isolation totale entre agences. |
| **profiles** | Prolonge `auth.users` de Supabase. | `role` (commercial/manager), `organization_id`, `color` (couleur agenda). |
| **points** | **État actuel** d'une maison sur la carte (1 marqueur). | `status` courant, `lat`/`lng` + colonne géo `location` (PostGIS) pour les requêtes carte efficaces. |
| **point_events** | **Journal horodaté** de chaque visite/action. | Source des **statistiques** dans le temps. On n'écrase jamais. |
| **appointments** | **Agenda partagé** (RDV). | Créé quand un point passe en `rdv_pris`. Cycle de vie : à venir → effectué / vendu / manqué / annulé. |

## Décision de conception importante : `points` vs `point_events`

Le besoin métier demande **deux choses en apparence contradictoires** :
1. une **carte propre** = un seul marqueur par maison, avec son statut *actuel* ;
2. des **statistiques dans le temps** = « combien de RDV pris **lundi**, combien de ventes **cette semaine**, par commercial ».

Si on se contentait d'écraser le statut d'un point à chaque visite, on perdrait l'historique → stats impossibles. La solution :

- **`points`** porte l'état courant (ce qu'on affiche sur la carte).
- **`point_events`** enregistre **chaque** action (une ligne par visite). Toutes les stats se calculent en agrégeant cette table (`count` par statut, par `author_id`, par jour/semaine/mois).

Flux applicatif : quand un commercial pose/modifie un statut, l'app fait **deux écritures** — elle met à jour `points.status` **et** insère une ligne dans `point_events`. (On pourra plus tard automatiser la 2ᵉ via un trigger, mais le faire côté app reste explicite et simple pour le MVP.)

## Sécurité multi-tenant (RLS)

- Chaque table métier est protégée par RLS : un utilisateur **ne voit et n'écrit que dans son organisation** (`organization_id = current_org_id()`).
- Deux fonctions d'aide : `current_org_id()` (l'org de l'utilisateur courant) et `is_manager()` (booléen rôle).
- Règles clés :
  - **Lecture** : partagée à toute l'équipe de l'org (carte, journal, agenda communs). ✔ conforme au besoin « la carte de tout le monde dispo pour l'équipe ».
  - **Écriture** : un commercial crée ses propres points/événements/RDV ; il peut modifier les siens ; le **manager** peut tout modifier dans son org.
  - **`point_events`** ne peut pas être modifié (c'est un journal) ; seul le manager peut en supprimer.

## Temps réel

Les tables `points`, `point_events` et `appointments` sont ajoutées à la publication `supabase_realtime` → la carte et l'agenda se mettent à jour en direct chez tous les membres de l'équipe.

## Comment les statistiques se calculent (rappel besoin)

Toutes dérivées de `point_events` (+ `appointments` pour le cycle RDV) :
- **nb d'absents / nb de points** → `count(status='absent') / count(*)` sur la période.
- **nb de RDV pris** → `count(status='rdv_pris')`.
- **nb de RDV effectués** → `count(appointments.status in ('effectue','vendu'))`.
- **nb de ventes** → `count(status='vendu')` (ou `appointments.status='vendu'`).
- **par jour / semaine / mois** → regroupement sur `occurred_at` / `scheduled_at`.
- **classement des vendeurs** → agrégation par `author_id`.
- Ces vues pourront être matérialisées ou exposées via des **vues SQL / RPC Supabase** au moment de coder l'écran Stats.

## Points laissés ouverts (à trancher, sans bloquer le schéma)

1. **Onboarding / création des comptes** (lié à Q13–Q16). Le schéma suppose qu'un profil est créé et rattaché à une org via un **flux d'invitation** (le manager invite ses commerciaux). À implémenter au moment de l'auth (table `invitations` ou création admin). Pour le MVP interne, on peut amorcer manuellement : créer l'organisation + les profils.
2. **Unicité d'une maison** (Q2). Aujourd'hui rien n'empêche deux points sur la même maison. Selon la réponse de l'ami (écraser vs historique vs doublons), on pourra ajouter une contrainte d'unicité (par adresse ou par proximité géographique) — trivial à ajouter ensuite.
3. **RDV « effectué »** (Q10). Le passage `a_venir → effectue/manque` sera déclenché manuellement par le commercial dans l'agenda. Champ déjà prévu (`appointments.status`).
4. **Objectifs de RDV** (Q11). Hors schéma MVP. Ajoutera une table `rdv_targets` (par commercial/équipe, par période) quand le besoin sera précisé.
5. **Création auto du RDV** au statut `rdv_pris` : faite **côté app** au MVP (il faut de toute façon saisir la date/heure). Un trigger pourra l'assister plus tard.

## Prochaine étape

Échafaudage du projet (PWA React + client Supabase + MapLibre) et branchement de ce schéma. On pourra exécuter `db/schema.sql` dans l'éditeur SQL de Supabase pour créer la base.
