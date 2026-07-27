# Refonte du « Guide de l'app » — plan de contenu v2 (chantier 27/07)

> Livrable de l'étape 2 du chantier Guides (sous-agent de conception éditoriale,
> claims techniques vérifiés dans le code). À VALIDER PAR BRIAC avant l'étape 3
> (implémentation). L'audit de l'existant qui a nourri ce plan est en fin de doc.

## Parti pris éditorial

Le guide s'adresse à un commercial qui découvre l'app **le matin de sa première
tournée**. On ne documente pas l'app, on enseigne **la boucle terrain** dans
l'ordre où il la vivra : *je pose un point → je relance les absents → je
transforme en RDV → j'argumente avec le toit mesuré*. D'où **4 guides courts
(11 étapes au total)** au lieu de 3 × 3 : la relance sort du guide « pose »
(c'est LA boucle du porte-à-porte et elle mérite ses 2 étapes), et chaque étape
porte **une seule idée, prouvée par l'image**. Règle d'or issue de l'audit :
**le texte est écrit d'abord, la capture est spécifiée pour le démontrer
littéralement** — si l'écran ne peut pas montrer la phrase, on change la phrase.
Pas de guide Stats ni Accueil : les Stats sont l'outil du manager, et l'Accueil
s'apprend de lui-même (il apparaît de toute façon dans le guide Relances, là où
il a un rôle actif).

## Guide 1 — `pose` · « Poser un point » · icône `Crosshair`

| n° | Texte (une phrase) | Spec de capture | Faisabilité |
|---|---|---|---|
| 1 | Tout part du bouton « + » en bas de la carte : touchez-le pour poser votre premier point. | Carte hors mode visée, zoom ~16,5 sur un quartier pavillonnaire dense avec 4-6 points de statuts variés, recherche **vide**, aucun filtre ni sheet. Focalisation : le FAB « + » (halo orange si décision n° 2). Recadrage : bande basse (filtres + FAB + onglets). Sert de vignette du guide. | Auto |
| 2 | Amenez la maison sous le viseur, choisissez le statut, puis « Poser ici ». | Mode visée, réticule orange **exactement sur le toit d'un pavillon** (adresse figée dans le script, zoom suffisant pour que « Poser ici » soit actif), chips avec « Absent » actif, bandeau de visée lisible, recherche vide. Recadrage : du bandeau à « Poser ici ». | Auto |
| 3 | Après la pose, la fiche s'ouvre : notez le nom, le téléphone, un mot — toute l'équipe le voit en temps réel. | Fiche d'un point **« À revoir »/« RDV pris »/« Vendu »** (la section Client n'existe pas sur « Absent ») avec nom, téléphone et note renseignés (données de démo plausibles). Sheet scrollée pour cadrer **Client + notes**, en-tête carte (et pans parasites) hors cadre. | Auto (point préparé par briac — voir Données) |

Le geste « appui long + glisser » (ex-pose-3) **sort du guide** — décision n° 1.

## Guide 2 — `relance` · « Relancer une porte » · icône `BellRing`

| n° | Texte | Spec de capture | Faisabilité |
|---|---|---|---|
| 1 | Sur un point « À revoir », datez la relance dans « Revoir le » — une semaine plus tard est proposée d'office. | Fiche d'un point « À revoir », champ « Revoir le » **rempli** (J+7), section Client visible, clavier fermé, aucun anneau de focus résiduel. Vignette du guide. | Auto |
| 2 | Le jour venu, la porte vous attend sur l'Accueil, dans « À relancer » — plus rien ne se perd. | Accueil : section « À relancer · N » avec 1-2 lignes, carte « Aujourd'hui » avec chiffres **non nuls**, en-tête = compte de démo au nom propre (pas d'email, rôle commercial). Recadrage : d'« Aujourd'hui » à « À relancer » (couper « Guide de l'app » — pas de mise en abyme). Nécessite une relance échue le jour de la moisson. | Auto (relance datée par briac la veille) |

## Guide 3 — `rdv` · « Prendre un RDV » · icône `CalendarCheck`

| n° | Texte | Spec de capture | Faisabilité |
|---|---|---|---|
| 1 | Posez un point « RDV pris » : le formulaire s'ouvre tout seul, adresse, nom et téléphone déjà remplis. | Formulaire « Nouveau rendez-vous » ouvert **depuis un point** (carte derrière, pas l'agenda). Chemin lecture seule : fiche d'un point « RDV pris » sans RDV à venir → bouton « Planifier » (`PointDetailSheet.tsx:498`) : pré-rempli sans rien écrire. Aucun champ en focus (blur), on n'enregistre jamais. Vignette du guide. | Auto |
| 2 | L'agenda est partagé : une couleur par commercial — la chip « Mes RDV » n'affiche que les vôtres. | Grille du mois avec 5-8 RDV sur ≥ 3 semaines, pilules d'**au moins 2 couleurs réellement différentes** (RDV posés depuis 2 comptes ; colonne `color` des profils si collision de hachage), **toutes les pilules avec un nom de client** (jamais d'adresse tronquée), chip « Mes RDV » visible non active. | Auto (RDV semés par briac depuis 2 comptes) |
| 3 | Le jour J, l'issue se donne en un tap depuis le planning du jour — « Vendu » repasse la maison en vert sur la carte. | Sheet du jour avec **un RDV « à venir » daté du jour de la moisson** → la rangée d'issues (« Vendu · Effectué · Manqué · Annulé ») **visible** ; heure Geist Mono sur une seule ligne (bug « 11:0/0 » à corriger AVANT la moisson) ; pied « + RDV ce jour » visible. On ne tape aucune issue. | Auto (RDV du jour créé par briac la veille) |

## Guide 4 — `maison` · « Mesurer un toit » · icône `Box`

| n° | Texte | Spec de capture | Faisabilité |
|---|---|---|---|
| 1 | Touchez n'importe quelle maison, même sans point : sa fiche s'ouvre — année, matériau, et le toit déjà mesuré au laser. | Fiche maison (avant prospection) d'une maison **sans point**, adresse figée, mesure LiDAR revenue, badges garnis. Sheet cadrée sur **adresse + badges + « Toiture mesurée · N m² »** ; le bloc « Poser un point » et ses chips **hors cadre**. Vignette du guide. | Auto |
| 2 | Dépliez « Toiture mesurée » : la maquette 3D tourne au doigt, et un tap sur un pan l'ajoute ou le retire du total. | Module déplié, segment « 3D », depuis la fiche d'un **point existant** (pas de bouton « Poser · … » qui recouvre la légende) sur une maison à 3-4 pans ; **un pan exclu** (grisé) pour montrer l'effet du tap — l'exclusion est un état local (`RoofModule.tsx:35`), rien n'est écrit en base ; total Σ et légende entièrement visibles. | Auto |
| 3 | Le segment « Rapport » assemble surfaces et plan coté en une image : partagez-la, l'argumentaire est posé sur la table. | Overlay « Rapport de toiture » : « Imprimer / PDF » + « Partager », total m² en évidence, plan coté A/B, **début du tableau des pans dans le cadre**. La ligne « Établi le … par … » doit afficher un **nom propre**, jamais un email (le rapport imprime `profile.full_name`, `RoofReport.tsx:73` — renommer le profil du compte de capture). | Auto |

## Captures — consignes transversales (anti-artefacts)

**Préparation des données (briac, ~15 min, la veille de la moisson — mutations
humaines, jamais le script)** :
1. Compte de capture dédié : `full_name` propre (ex. « Yann Kerbrat »), rôle commercial.
2. Un point « À revoir » complet (nom, téléphone, note, relance datée du jour de la moisson) ; un point « RDV pris » **sans** RDV planifié (débloque le chemin « Planifier »).
3. 5-8 RDV sur le mois courant depuis **2 comptes**, tous avec `client_name` fictif plausible ; dont **1 « à venir » daté du jour de la moisson**.
4. Le matin de la moisson : 3-4 poses réelles depuis le compte guide (chiffres « Aujourd'hui » non nuls).

**Règles de prise de vue (`shoot.mjs`)** :
- Recherche **vidée** et clavier fermé avant chaque capture carte ; `blur()` systématique (aucun anneau orange résiduel).
- Adresses/zones **figées dans le script** (une constante par capture) : rejouable à chaque évolution d'UI.
- Cohérence chiffrée : jamais deux données contradictoires dans le cadre (pans du voisin vs m² de la fiche) — sinon recadrer.
- Viser un cadre proche du 4:3 de `guide-frame` (les captures pleine hauteur v1 étaient illisibles en vignette).
- **Pré-vol** : corriger le bug « 11:0/0 » (largeur de la colonne heure de la sheet du jour) avant la moisson ; vérifier une fois que le tap-pan 3D n'écrit rien en base.
- **Contrôle final** : rejouer `audit-guide.mjs` (capture + texte ensemble dans la sheet) et vérifier chaque paire avant commit.

## Décisions — TRANCHÉES par briac le 27/07 (les 4 recommandations suivies)

1. **Drag retiré des guides** — plus aucune capture manuelle, tout le pipeline est rejouable en auto.
2. **Halo orange sur les petites cibles** (« + », « Revoir le », chip « Mes RDV ») — implémenté par **injection dans la page au moment du shoot** (outline sur l'élément réel, suit l'élément — plus robuste que le compositing à coordonnées fixes envisagé), anneau sobre, jamais de flèches ni de texte incrusté.
3. **4 guides courts** (pose 3 · relance 2 · rdv 3 · maison 3 = 11 étapes).
4. **Jeu de données de démo semé la veille par briac** (liste § Préparation ci-dessus).

---

## Annexe — audit de l'existant (27/07, captures dans `screenshoots/guide-audit/`)

Méthode : `tools/screenshots/audit-guide.mjs` (nouveau, lecture seule) ouvre
chaque tuto sur l'Accueil et capture chaque étape telle que rendue (image +
texte ensemble), puis chaque `web/public/guide/*.webp` a été inspectée en
pleine résolution.

| Capture | Décalage constaté |
|---|---|
| pose-1 | Texte « Appuyez sur + » mais le + n'apparaît nulle part (mode visée déjà ouvert) ; réticule sur une **pelouse**, pas une maison ; le bouton s'appelle « Poser ici » (texte : « Poser ») ; adresse tapée dans la recherche (artefact de script). |
| pose-2 | Texte « client, téléphone… datez la relance » mais fiche **« Absent » sans champ client/téléphone ni relance** ; pans du voisin (61/17/55/45 m²) contredisent le « 70 m² » de la fiche. |
| pose-3 | **Absente** (placeholder « Capture à venir ») — drag = mutation, hors script. |
| rdv-1 | Texte « RDV pris ouvre le formulaire… adresse toute seule » mais formulaire ouvert **depuis l'agenda**, adresse tapée à la main, focus orange sur le champ Note. |
| rdv-2 | Texte « une couleur par commercial » mais **toutes les pilules bleues** (Jean, Briac, Matthi…, Alexis…) ; une pilule affiche une adresse (« 29 Ru… ») ; 2 premières semaines vides. |
| rdv-3 | Texte « marquez l'issue en un tap » mais RDV **déjà soldé** (badge « Vendu », aucun bouton d'issue) ; heure cassée sur 2 lignes (« 11:0/0 ») = bug UI réel à corriger. |
| maison-1 | Texte « année, matériau, DPE » mais **aucun badge visible** (fiche repliée, dominée par la carte) ; la fiche montre surtout « POSER UN POINT » (sujet du tuto 1). |
| maison-2 | 3D correcte mais « Poser · Absent » **recouvre la légende** des pans ; aucun pan exclu (le geste enseigné n'est pas montré) ; recherche polluée. |
| maison-3 | La meilleure — bémols : **email personnel visible** (« Établi le … par briac.roudaut@… ») ; tableau des pans coupé. |

Enseignement : les captures v1 sont des écrans moissonnés tels quels ; la v2
part du texte et spécifie l'état exact de l'écran avant capture.
