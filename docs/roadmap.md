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
- [x] **Effet 3D waouh** — éclairage des bâtiments, surbrillance (bleu) de la maison sélectionnée (ciel/brouillard retirés, invisibles). ~~Bâtiments sombres~~ → **bâtiments clairs** (réf. Apple Plans, cohérent DA) depuis le lot visuel de juillet 2026.
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
- [ ] ⬜ **Lot 3 (suite, à choisir)** : filtres carte (statut/commercial).

## Design — DA « Clair & précis » (Linear/Vercel/Emil Kowalski)
- [x] Système de design (tokens, police Geist, icônes Lucide, Sonner, Vaul, Motion)
- [x] Barre de navigation + écran Accueil
- [x] Carte (barre d'outils, recherche, chips, drawers Vaul, toasts)
- [x] Agenda (vue calendrier mois + planning du jour)
- [x] Stats (segmented animé, tunnel, classement)
- [ ] ⬜ Écran de connexion (encore ancien style) + finitions (contrôles carte)

## Déploiement ✅
- [x] Render (Static Site via `render.yaml`), repo GitHub `autonome-ia/appprospection`, HTTPS + PWA installable. Redéploiement auto à chaque `git push`.

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
