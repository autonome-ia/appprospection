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
- [x] **Effet 3D waouh** — ciel + brouillard atmosphérique, éclairage directionnel des bâtiments, surbrillance (bleu) de la maison sous le point sélectionné
- [ ] ⬜ **Vue Toits hybride** — ortho-photo + noms de rues par-dessus, contours des bâtiments

## Design — DA « Clair & précis » (Linear/Vercel/Emil Kowalski)
- [x] Système de design (tokens, police Geist, icônes Lucide, Sonner, Vaul, Motion)
- [x] Barre de navigation + écran Accueil
- [x] Carte (barre d'outils, recherche, chips, drawers Vaul, toasts)
- [x] Agenda (vue calendrier mois + planning du jour)
- [x] Stats (segmented animé, tunnel, classement)
- [ ] ⬜ Écran de connexion (encore ancien style) + finitions (contrôles carte)

## Ensuite (ordre décidé)
- [ ] 🔵 **Micro-ajustements** après le retour de l'ami (statuts, flux RDV, définitions stats)
- [ ] ⬜ **Équipe (invitations)** — le manager invite ses commerciaux dans son agence (aujourd'hui chaque inscription = nouvelle agence). *Dépend de l'ami (Q13-16).*
- [ ] ⬜ **Déploiement** (Vercel/Netlify) pour un usage terrain réel

## Idées / plus tard (hors MVP)
- Vue liste des points (filtres)
- Carnet de contacts / mini-CRM (clients à rappeler, R2)
- Chat / annonces manager
- Mode hors-ligne
- Mesure de toiture
- Multi-agences self-service + facturation
