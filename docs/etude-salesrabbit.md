# Étude concurrentielle — SalesRabbit (juillet 2026)

> Analyse de https://salesrabbit.com (13 pages produit, dont /roofing-sales-software/)
> pour en tirer des pistes d'amélioration d'AppProspection.
> Réalisée par sous-agent le 17/07/2026. Synthèse : voir la fin du document.

## Positionnement SalesRabbit

« The only all-in-one platform for field sales management. » Plateforme cœur
(plans Lite gratuit / Team / Pro / Enterprise) + add-ons facturés à part
(DataGrid AI $19/mois, Weather $19/mois, Digital Contracts $13/mois,
Movers $13/mois) + un CRM toiture séparé (RoofLink, $120/user/mois).

**Enseignement stratégique** : SalesRabbit monétise par empilement d'add-ons
data (météo, movers, scoring) sur un canvassing devenu commodité. Notre
défendabilité en France = la même mécanique avec les **données publiques
françaises** (IGN, cadastre, DPE ADEME, DVF, BAN, Météo-France) qu'aucun
acteur US n'intégrera.

## Inventaire des fonctionnalités

### 1. Canvassing / carte (le cœur, équivalent de notre app)
- **Track leads on a map** : pin + statut pré-défini ou **personnalisé**, vue carte ET liste.
- **Filter leads by status** : filtrage des pins par statut sur la carte.
- **Notes + custom fields + pièces jointes** (photos du toit attachées au lead, plan Pro).
- **Territory & Area Management** : le manager **dessine des zones** et les assigne
  (couleur/rep, sans chevauchement), progression de couverture en temps réel.
  LA brique structurante du door-to-door qui nous manque.
- **Rep Location Tracking** : position GPS temps réel + historique (⚠️ RGPD en France).
- **Route planning** : itinéraire multi-arrêts optimisé (même en plan gratuit).
- **Customer Locator** : clients existants sur la carte → vendre autour des chantiers.
- **Map overlays** (parcelles, météo), **Sketch Board** (croquis), import/export CSV,
  **Sales Materials** (docs de vente), **Get Reminders** (relances automatiques).
- Apps natives iOS/Android. Argument affiché : « 2 % des portes froides donnent une vente ».

### 2. DataGrid AI (add-on data)
- **Homeowner data** : qui habite chaque maison avant de sonner.
- **Buyer Propensity Score** : score ML de propension d'achat affiché sur la carte.
- **Business Search** : annuaire Google Places intégré (B2B).

### 3. Weather / Storm (add-on — spécificité roofing US)
- Couches carte grêle/vent/ouragans, historique 2 ans, alertes tempête temps réel.
- **Rapports Verisk par adresse** : preuve météo opposable aux assureurs.
- Tout le modèle « storm restoration » US (le toit payé par l'assurance).

### 4. Mover Leads (add-on)
- Transactions immobilières quasi temps réel → pins automatiques. Sans équivalent
  légal/technique en France (DVF ≈ 6 mois de décalage, RGPD).

### 5. Agenda
- Calendrier d'équipe (≈ le nôtre) + **sync Google Calendar/Outlook**, heures par rep,
  **round robin** setter/closer (modèle grosses équipes US).

### 6. Digital Contracts (add-on)
- Form builder + **e-signature mobile** sur le pas de porte, pré-rempli depuis le lead.

### 7. Amplify — Analytics + Gamification
- Dashboards, leaderboards, **TV displays**, **social feed** des ventes.
- Gamification très poussée : XP/niveaux/prestige, compétitions (blitz, tournois,
  roue de la fortune), battles 1v1, centaines de badges, **rewards store** (cash).

### 8. RoofLink (CRM toiture séparé)
- **Mesure de toit sur imagerie aérienne** → calcul matériaux automatique.
- Devis Good-Better-Best (6 options, marges), **inspections photo → PDF assurance**,
  commande matériaux 1 clic, paiements Stripe/QuickBooks/financement.

### 9. Transverse
- Chat interne, 30+ intégrations (Salesforce, HubSpot, AccuLynx, JobNimbus,
  DocuSign, Zapier…), API publique, SSO, permissions fines, custom branding.
- **SalesRabbit Lite** gratuit solo = funnel d'acquisition (leads purgés à 90 j).

## Comparatif

### Déjà équivalent (ou mieux) chez nous
| SalesRabbit | Nous |
|---|---|
| Track leads + statuts | Carte IGN + réticule + 5 statuts + clustering. Vue « Toits » ortho **meilleure** que leur fond pour juger un toit |
| Notes sur lead | Journal horodaté avec auteur (empilé) — plutôt mieux |
| Appointment management | Agenda partagé, issues, lien carte, RDV→statut |
| Dashboards/funnel | Tunnel + classement + objectif hebdo (`point_events`) |
| Carte temps réel, multi-tenant, adresse | Supabase Realtime, RLS, BAN |

### Ce qui nous manque (ordre d'importance terrain)
1. Territoires dessinés/assignés ; 2. Filtres carte (statut/commercial) ;
3. Rappels/relances datées ; 4. Photos sur la fiche maison ; 5. Vue liste + import/export ;
6. Équipe/invitations + rôles (roadmap) ; 7. Leaderboard vivant/feed ; 8. « Qui habite ici » ;
9. Sync agenda Google/ICS ; 10. E-signature/devis terrain, mesure de toit ;
11. Rep tracking (⚠️ RGPD/droit du travail).

### Hors sujet pour une petite équipe française
Weather Verisk (pas de modèle assurance-grêle FR), Mover Leads (DVF trop tardif,
RGPD), propensity score ML, intégrations CRM US/SSO/API, round robin, rewards
store cash, ERP chantier RoofLink (commande matériaux/production).

## Pistes priorisées (équipe ~5 commerciaux toiture, France)

### Quick wins (jours)
1. **Date de relance sur « à revoir » + rappels** — champ « revoir le… », bloc
   « à relancer aujourd'hui » sur l'Accueil, pastille carte. Les ventes dorment là.
2. **Filtres carte** par statut et par commercial (chips).
3. **Feed d'activité + leaderboard vivant** (Realtime sur `point_events`, DA sobre).
4. **Vue « autour des chantiers »** : filtre « vendu » + rayon → prospecter les voisins
   d'un chantier (l'argument n°1 du couvreur).

### Chantiers moyens (semaines)
5. **Territoires** : polygones dessinés (Terra Draw) + assignation + % de couverture
   (events dans le polygone). Adaptation FR : contours communes/IRIS (Admin Express IGN).
6. **Photos sur la fiche maison** (Supabase Storage, vignettes dans le journal).
7. **Équipe & invitations + rôles** (déjà en roadmap).
8. **Couche cadastre/parcelles IGN** (limites de propriété en pavillonnaire).
9. **Export/import CSV** (commissions, reporting).
10. **Sync agenda Google / export ICS** par commercial.

### Long terme (SaaS)
11. Statuts personnalisables par organisation (mappés sur des catégories canoniques
    pour ne pas casser les stats).
12. **Mesure de toit sur ortho IGN** (tracer le pan → surface turf.js → fourchette
    de prix). Différenciateur FR fort, MVP faisable.
13. **Contexte maison via données publiques FR** : année de construction (fichiers
    fonciers/BD TOPO), **DPE ADEME** (API publique — F/G = argument isolation),
    dernière mutation **DVF**. RGPD-compatible (pas de nominatif).
14. **Alerte post-tempête** : vigilance Météo-France (vent/grêle) → « prospectez le 56 ».
15. Gamification légère (streaks, badges sobres — DA Linear).
16. **E-signature bon pour accord** + formulaire de rétractation 14 j digitalisé
    (obligation du démarchage à domicile → argument de conformité).
17. **Tier gratuit solo** comme stratégie d'acquisition SaaS (modèle Lite).
