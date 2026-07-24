# Audit UX/UI — AppProspection

> Synthèse finale de l'audit ergonomie & architecture d'information (juillet 2026).
> Sources : 6 auditeurs (parcours-tournee, parcours-rdv, parcours-argumentaire, parcours-manager,
> archi-info, coherence-ui) arbitrés par 3 jurés (lentilles terrain / manager / designer).
> Les doublons inter-auditeurs ont été fusionnés ; chaque item cite sa ou ses sources.
> Périmètre exclu (rappel) : écran de connexion, hors-ligne, statuts, vue rue/3D carte, bugs techniques.

---

## 1. Synthèse

L'app est fonctionnelle et la DA « Clair & précis » est bien posée, mais l'information n'est pas
au bon endroit pour l'acte répété 60-80 fois par jour. Trois axes majeurs :

1. **La boucle de pose est taxée par le spectaculaire.** Dans les deux fiches les plus utilisées,
   la 3D/plan/rapport (l'arme du closing, utile 1 fois) écrase le fréquent (statut, note, Enregistrer,
   utile à chaque porte) : fiche auto-ouverte après chaque pose, CTA sous le pli, scroll à travers la maquette.
2. **La chaîne RDV/relance fuit en silence.** Un point « RDV pris » est muet sur son RDV (ni date,
   ni téléphone), un RDV peut ne jamais exister dans l'agenda, un « À revoir » sans date disparaît
   des relances : ce sont des ventes perdues, pas du confort.
3. **Les chiffres du manager peuvent être faux ou illisibles**, et le système manque de cohérence
   (barres d'objectif hors période, taux « honorés » > 100 %, deux codages couleur dans l'agenda,
   tooltips `title` morts sur iPhone, dialogues système hors DA).

Consensus du jury : cette app gagnera en **enlevant et repliant**, pas en empilant.

---

## 2. Lot A — Quick wins (impact fort/moyen · effort faible · consensus jury)

Ordonnés par impact décroissant.

### A1. Ne plus ouvrir la fiche après chaque pose `[parcours-tournee]`
- **Problème** : après « Poser le point », la PointDetailSheet s'ouvre systématiquement (MapView.tsx, poseAt) — 3 taps pour un « Absent » au lieu de 2, ×40-60 par tournée.
- **Reco** : supprimer l'ouverture auto ; le toast Sonner « Point posé » (avec « Annuler ») sert de filet, y ajouter une action « + Note ». Garder l'auto-ouverture uniquement pour « RDV pris » (formulaire RDV).
- **Écran(s)** : Carte, fiche point.

### A2. Fiche maison : « Poser le point » remonté au-dessus du bloc 3D + libellé dynamique `[coherence-ui + parcours-tournee]`
- **Problème** : le StatusPicker et le CTA sont rendus APRÈS Roof3D/RoofDiagram/RoofReport (capture « new rosa floch.jpeg » : chips hors champ) ; et le bouton dit « Poser le point » sans refléter le statut choisi — risque de poser le statut resté actif de la maison précédente.
- **Reco** : remonter picker + CTA juste sous les HouseBadges ; libellé « Poser · À revoir » teinté du statut. (La variante « chip = pose immédiate » est renvoyée en Points à trancher, véto designer.)
- **Écran(s)** : Fiche maison (HousePreviewSheet).

### A3. Footer sticky « Enregistrer » ; « Supprimer » déclassé `[parcours-tournee + coherence-ui + parcours-argumentaire]`
- **Problème** : .drawer-actions vit en fin de scroll du drawer-body ; dès que 3D/plan sont dépliés, « Enregistrer » part hors écran (résiduel iOS « bas de fiche inatteignable ») — et « Supprimer » (destructif) partage la rangée à égalité visuelle avec l'action de tous les jours.
- **Reco** : rendre .drawer-actions sticky (bottom: 0, fond --surface + hairline) dans les deux fiches ; « Enregistrer » seul en pleine largeur ; « Supprimer le point » relégué en text-btn danger (ou icône Trash2 dans le header), deux-taps conservé.
- **Écran(s)** : Fiche point, fiche maison.

### A4. « À revoir » : presets de date de relance + J+7 par défaut `[parcours-tournee]`
- **Problème** : fetchRelances filtre `revisit_at is not null` — un « À revoir » sans date (le cas par défaut) ne remonte JAMAIS dans « À relancer » ; et la saisie passe par la roue iOS.
- **Reco** : chips 1-tap « Demain · +3 j · Samedi · +2 sem » sous le champ, et pré-remplir J+7 dès que le statut « À revoir » est choisi (modifiable, effaçable).
- **Écran(s)** : Fiche point, fiche post-pose (via toast « + Note »).

### A5. Pré-remplir le nom du client dans le formulaire RDV `[parcours-rdv]`
- **Problème** : MapView passe pointId/coords/pointNote à AppointmentForm mais pas client_name — le champ Client est toujours vide à la création depuis la carte, alors que la synchro existe dans l'autre sens.
- **Reco** : passer `clientName={rdvPoint.client_name}` et initialiser le state quand `existing` est absent (même mécanique que le pré-remplissage d'adresse).
- **Écran(s)** : Carte → AppointmentForm.

### A6. Rendre la carte RDV du planning tappable vers la fiche client `[parcours-rdv]`
- **Problème** : AppointmentCard n'ouvre jamais ClientSheet, qui contient pourtant toute la préparation (badges, 3D, plan, rapport) — le même RDV existe à deux endroits avec des capacités différentes, sans lien.
- **Reco** : tap sur l'en-tête/nom → ClientSheet(appt) (état clientAppt déjà présent dans AgendaScreen) + chevron discret pour l'affordance.
- **Écran(s)** : Agenda (planning du jour).

### A7. Provenance des badges maison visible et tappable `[parcours-argumentaire + archi-info + parcours-tournee — fusion de 3 constats]`
- **Problème** : toute la pédagogie (laser vs estimation, année suspecte, verdicts LiDAR, chutes) vit dans des attributs `title` — inexistants sur iPhone, l'appareil cible. Le commercial ne peut ni vérifier ni montrer la provenance d'un chiffre.
- **Reco** : provenance dans le texte des 2 badges clés (« 222 m² · laser », « ~204 m² · estimé », « ~2007 · cadastre ») + tap sur un badge → toast/popover reprenant le texte du `title`. Icône Lucide (Scan/Ruler) sur is-measured.
- **Écran(s)** : HouseBadges (toutes fiches), Roof3D.

### A8. Bloc matériaux 3D : renommer, titrer, remonter `[parcours-argumentaire]`
- **Problème** : l'avant/après matériau (l'outil le plus vendeur) est en bas de légende, sans titre, avec un premier onglet cryptique « Couleurs ».
- **Reco** : eyebrow « Votre toit en… », renommer « Couleurs » → « Mesure », remonter le groupe juste sous le canvas.
- **Écran(s)** : Roof3D.

### A9. Barres d'objectif du classement limitées à la Semaine `[parcours-manager]`
- **Problème** : chaque ligne du classement compare les RDV de la période affichée à un objectif HEBDO — trompeur en Jour (tout le monde à 10 %) comme en Mois (tout le monde le pulvérise).
- **Reco** : n'afficher `rank-obj` que si `period === 'semaine'` (même condition que la carte objectif) ; en Jour/Mois, métrique adaptée (« X portes aujourd'hui » / « X RDV ce mois ») en Geist Mono.
- **Écran(s)** : Stats (classement).

### A10. Afficher les portes toquées dans le classement et les KPI `[parcours-manager]`
- **Problème** : « qui toque ? » est invisible : un commercial à 0 porte est indiscernable d'un commercial à 80 portes sans RDV.
- **Reco** : ligne classement « 82 portes · 5 RDV · conv. 2,1 % » ; en vue Équipe, KPI « Portes » (avec delta) à la place de « Conversion » (déjà en pied de tunnel).
- **Écran(s)** : Stats (KPI + classement).

### A11. Issues de RDV masquées avant le jour J + prénom au lieu de l'email `[parcours-rdv + coherence-ui]`
- **Problème** : les 4 boutons Vendu/Effectué/Manqué/Annulé s'affichent sur tout RDV « à venir », même à J-15 — un tap de scroll raté écrit des stats fausses ; et l'identité du commercial tombe en email brut quand full_name est vide.
- **Reco** : n'afficher .appt-outcomes que si `scheduled_at ≤ fin de journée` ; ailleurs, issues via la fiche (cf. B11). Afficher prénom + initiale (réutiliser initials()), jamais l'email.
- **Écran(s)** : Agenda (AppointmentCard).

### A12. Réordonner le formulaire de la fiche point selon la fréquence d'usage `[parcours-tournee + archi-info]`
- **Problème** : « Toiture constatée » (saisie 1 fois par maison) et « Client » (sans objet pour un « Absent ») s'intercalent entre le statut et les Notes (saisies à chaque visite).
- **Reco** : Notes (journal + textarea) remontées juste sous les chips de statut ; « Client » affiché seulement pour à_revoir/rdv_pris/vendu ; « Toiture constatée » déplacée dans le bloc toiture (sa famille sémantique, sous HouseBadges).
- **Écran(s)** : Fiche point.

### A13. Différencier « Absent » et « Impossible » par la forme `[parcours-tournee]`
- **Problème** : deux disques gris quasi identiques à l'échelle quartier (capture « screen quartier ») — les deux statuts aux conséquences opposées se confondent en plein soleil.
- **Reco** : « Absent » en disque fond blanc + anneau et tiret gris ; « Impossible » en disque sombre actuel. Hiérarchie : blanc = à retenter, sombre = éliminé, couleurs = opportunités.
- **Écran(s)** : Carte (markers.ts).

### A14. Bouton Filtres en zone pouce, avec badge d'état `[parcours-tournee]`
- **Problème** : le toggle est en haut à droite (zone inaccessible au pouce) alors que ses chips apparaissent en bas à gauche.
- **Reco** : déplacer le bouton en bas à droite, empilé au-dessus du FAB « + » ; badge chiffré quand des filtres sont actifs (état déjà calculé).
- **Écran(s)** : Carte.

### A15. Chips de date 1-tap dans le formulaire RDV `[parcours-rdv]`
- **Problème** : le créneau horaire est optimisé mais la date reste un input natif (roue iOS) devant le prospect.
- **Reco** : rangée « Demain · Après-demain · Samedi · + » au-dessus du champ (style .chip existant), le « + » ouvrant l'input natif.
- **Écran(s)** : AppointmentForm.

### A16. Bouton « Aujourd'hui » dans la navigation du calendrier `[parcours-rdv]`
- **Problème** : seuls les chevrons mois ± existent ; revenir au jour courant coûte 3-4 taps devant le prospect.
- **Reco** : bouton texte « Aujourd'hui » dans cal-nav, visible quand mois ≠ courant ou jour ≠ today.
- **Écran(s)** : Agenda.

### A17. Adresse du RDV lisible, bouton « Itinéraire » explicite `[parcours-rdv + archi-info]`
- **Problème** : l'adresse entière est un lien Waze sans aucune affordance — Waze se lance quand on veut juste lire, et la fonction n'est jamais découverte par les autres.
- **Reco** : adresse non cliquable + bouton « Itinéraire » (icône Navigation, wazeUrl existant) à côté d'« Appeler » dans appt-foot.
- **Écran(s)** : Agenda (AppointmentCard).

### A18. Vue Clients : recherche + séparation des homonymes `[parcours-rdv]`
- **Problème** : pas de champ de recherche, et regroupement par nom seul — deux « Le Gall » distincts fusionnent en une ligne.
- **Reco** : recherche locale (nom + adresse) en tête de vue ; regroupement par nom + adresse.
- **Écran(s)** : Agenda (vue Clients).

### A19. Tilde « ~ » réservé aux années réellement douteuses `[parcours-argumentaire]`
- **Problème** : `~{annee}` est rendu systématiquement, même pour une année BDNB fiable — l'accroche « votre maison de 1989 » est affaiblie.
- **Reco** : « 1989 » sans tilde quand l'année vient de la BDNB hors SUSPECT_YEARS ; « ~ » seulement pour SUSPECT_YEARS et le repli BD TOPO.
- **Écran(s)** : HouseBadges.

### A20. Ordre des badges aligné sur l'argumentaire `[parcours-argumentaire]`
- **Problème** : le DPE (accroche n°1) arrive en dernier, derrière murs/étages/logements.
- **Reco** : année · DPE · matériau · surface, puis badges secondaires en fin de ligne en is-muted. Simple réordonnancement JSX.
- **Écran(s)** : HouseBadges.

### A21. Lettres A/B/C et couleurs de pans partagées entre 3D, plan et rapport `[parcours-argumentaire]`
- **Problème** : le plan lettre les pans, la 3D non ; et la couleur est attribuée par index dans deux listes filtrées différemment — un pan peut changer de couleur entre 3D et plan.
- **Reco** : panLetters() + map couleur unique calculés une fois dans la sheet parente, passés aux trois composants ; lettre affichée dans les chips 3D (« A · 60 m² · 34° »).
- **Écran(s)** : Roof3D, RoofDiagram, RoofReport.

### A22. « Gouttières » au lieu d'« Égouts » dans la légende 3D `[parcours-argumentaire]`
- **Problème** : « Égouts 24 m » est lu par le prospect pendant la démo (le rapport a déjà corrigé en « Égouts (gouttières) »).
- **Reco** : remplacer dans edgesLine (Roof3D.tsx) ; conserver la forme technique dans le rapport écrit. Une ligne.
- **Écran(s)** : Roof3D.

### A23. Identité sur le rapport client `[parcours-argumentaire]`
- **Problème** : le rapport est anonyme — ni agence, ni commercial, ni date, alors que les références (Roofr/EagleView) sont brandées et que les données existent déjà.
- **Reco** : ligne « Établi le {date} par {author_name} · {organization.name} » dans roof-report-head, reprise dans le texte de partage.
- **Écran(s)** : RoofReport.

### A24. Sortir le manager du classement `[parcours-manager]`
- **Problème** : `ranked` trie tous les profils — le manager apparaît à 0 vente et fausse « Ma position : 3 sur 6 ».
- **Reco** : `profiles.filter(p => p.role === 'commercial')` pour le classement et le dénominateur ; ses events restent comptés dans les agrégats équipe.
- **Écran(s)** : Stats.

### A25. Rendre le drill-down du classement découvrable `[parcours-manager]`
- **Problème** : les lignes sont des `<button>` sans aucune affordance tactile (cursor:pointer seulement) — la vue par commercial peut ne jamais être découverte.
- **Reco** : ChevronRight (15 px, --ink-3) + état :active (--surface-2) ; déplacer le crayon d'objectif dans la vue drill-down pour lever l'ambiguïté.
- **Écran(s)** : Stats (classement).

### A26. Étiquettes de jours sous le graphe « Portes par jour » `[parcours-manager + archi-info]`
- **Problème** : barres anonymes (jour uniquement en `title`, mort au tactile) ; impossible de distinguer mercredi de samedi.
- **Reco** : initiales L M M J V S D (Semaine) / numéros 1·8·15·22·29 (Mois) en Geist Mono 10 px --ink-3 ; barre du jour courant en --accent. Le jury designer préfère les initiales seules (pas de valeurs au-dessus des barres).
- **Écran(s)** : Stats (graphe).

### A27. Supprimer la note de développeur « À ajuster selon le métier » `[parcours-manager + archi-info + coherence-ui]`
- **Problème** : un TODO interne est affiché en pied des Stats pour tous — il sape la confiance dans les chiffres au moment des présentations.
- **Reco** : supprimer la phrase ; définition du « contact » derrière une icône Info à côté de l'étape « Contacts » du tunnel ; trancher la définition avec le chef des ventes (cf. §5).
- **Écran(s)** : Stats.

### A28. Objectif équipe agrégé en vue Équipe `[parcours-manager]`
- **Problème** : la carte objectif n'existe qu'en drill-down — le manager additionne de tête les X/Y du classement.
- **Reco** : en Équipe + Semaine, afficher la même obj-card avec Σ rdv_pris / Σ weekly_rdv_target au-dessus du tunnel — une condition à élargir.
- **Écran(s)** : Stats.

### A29. Feed d'activité cliquable vers la carte `[parcours-manager]`
- **Problème** : les lignes du feed sont mortes (is-static) alors que les relances juste au-dessus ouvrent la carte ; fetchRecentActivity ne remonte ni id ni lng/lat.
- **Reco** : ajouter `point:points(id, lng, lat)` au select et brancher `onShowOnMap` — même pattern que les relances.
- **Écran(s)** : Accueil.

### A30. Fiche point : afficher la dernière visite, pas la création `[archi-info]`
- **Problème** : l'en-tête montre la date de POSE sans libellé — trompeur pour décider « je retente ou pas ? » sur un point revisité.
- **Reco** : « Vu le {visited_at} » (+ auteur du dernier passage) dans drawer-meta ; la création part dans le journal (« Point posé le … »).
- **Écran(s)** : Fiche point.

### A31. Pastilles m² par pan : agréger au dézoom `[coherence-ui]`
- **Problème** : les pastilles à taille fixe s'empilent en tas illisible dès qu'on dézoome (capture « new rosa floch.jpeg ») et masquent le toit.
- **Reco** : sous zoom ~17,5, une seule pastille Σ au centroïde (style .roof3d-total) ; détail par pan au-delà (zoomend déjà disponible).
- **Écran(s)** : Carte.

### A32. Remplacer window.confirm / window.prompt par les patterns DA `[coherence-ui + parcours-manager]`
- **Problème** : suppression de RDV via window.confirm et objectif hebdo via window.prompt — boîtes système hors DA, clavier non forcé, saisie invalide ignorée en silence.
- **Reco** : suppression → pattern deux-taps « Confirmer ? » (déjà utilisé par la fiche point) ; objectif → stepper inline (− / valeur mono / +) au tap du crayon. *Note : le juré terrain conteste la priorité de cet item (cf. §5).*
- **Écran(s)** : Agenda, Stats.

### A33. Accueil : refetch au réveil + erreurs visibles `[parcours-manager]`
- **Problème** : relances et feed chargés une seule fois au montage ; au retour de veille iOS les données restent figées, et un échec réseau fait disparaître les sections sans message.
- **Reco** : reprendre le pattern visibilitychange de StatsScreen + ligne « Impossible de charger — Réessayer » (load-error existant). *Réserve designer : registre à la frontière du périmètre technique.*
- **Écran(s)** : Accueil.

### A34. Mode visée : zoomer avant d'ouvrir le réticule `[parcours-tournee]`
- **Problème** : le FAB « + » s'active à tout zoom, l'erreur « Rapprochez-vous » ne tombe qu'après avoir visé — travail perdu.
- **Reco** : sous le zoom 15, easeTo (zoom 16-17) avant d'ouvrir le réticule ; griser « Poser ici » avec « Zoomez pour viser » tant que zoom < 15. *(Impact faible — queue de lot, rétrogradé par le juré manager.)*
- **Écran(s)** : Carte.

---

## 3. Lot B — Chantiers moyens (effort moyen)

### B1. Bloc « Rendez-vous » dans la fiche point `[parcours-tournee + parcours-rdv + archi-info + coherence-ui — fusion de 4 constats + « trou silencieux »]`
- **Problème** : la fiche d'un point « RDV pris » n'affiche ni date, ni heure, ni téléphone, ni lien vers le RDV (getPointDetail ne joint jamais `appointments`) ; et un point peut rester bleu « RDV pris » sans AUCUN RDV en agenda si le formulaire a été balayé à la pose — personne ne le voit, personne ne se présente.
- **Reco** : requête `appointments` par point_id dans getPointDetail. Si RDV lié : bloc en tête de fiche « Sam. 26 juil. · 16:00 » (Geist Mono) + bouton Appeler (tel:) + « Voir dans l'agenda ». Si point rdv_pris SANS RDV : bandeau « Aucun RDV planifié » + bouton « Planifier » ouvrant AppointmentForm prérempli. Bonus : text-btn « + RDV » à côté du label Client pour prendre un RDV sans passer par le détour statut→Enregistrer.
- **Écran(s)** : Fiche point.

### B2. Module « Toit mesuré » : disclosure replié + segmented 3D · Plan · Rapport `[coherence-ui + archi-info + parcours-argumentaire — le chantier qui règle 6 constats]`
- **Problème** : 3D + plan + rapport sont trois boutons/blocs empilés, toujours dépliés dans la fiche point, intercalés entre le statut et les notes ; le parcours preuve → chiffrage → closing se fait en fouillant, et le fréquent passe sous le pli.
- **Reco** : UN module « Toiture mesurée · N m² » : disclosure (chevron) fermé par défaut dans la fiche point, ouvert dans HousePreviewSheet et ClientSheet (les moments d'argumentaire) ; à l'intérieur, segmented control 3D · Plan · Rapport (style roof3d-mats existant), une seule position, bascule 1 tap. Ajouter Plan/Rapport dans la légende du plein écran 3D.
- **Écran(s)** : Fiche point, fiche maison, fiche client.

### B3. La sélection de pans (Σ) alimente plan et rapport `[parcours-argumentaire]`
- **Problème** : l'état `excluded` vit dans Roof3D et meurt avec lui — le rapport affiche 204 m² quand on vient de cocher 175 m² avec le client. Incohérence au moment exact de la confiance.
- **Reco** : remonter `excluded` dans la sheet parente, le passer à RoofReport : ligne « Surface retenue avec vous : Σ 175 m² », tableau de chutes basé sur la sélection, pans exclus grisés.
- **Écran(s)** : Roof3D → RoofReport.

### B4. Refonte de l'en-tête de l'Accueil : la journée, pas le profil `[parcours-manager + archi-info + coherence-ui — fusion des 3 constats Accueil]`
- **Problème** : la zone premium affiche le nom de l'utilisateur deux fois (bonjour + user-card) et un bouton « Se déconnecter » de premier niveau ; ni RDV du jour, ni portes, ni objectif — le contenu utile commence sous le pli.
- **Reco** : une seule ligne d'en-tête (avatar + « Bonjour Briac » + rôle en sous-texte) ; déconnexion + profil derrière un tap sur l'avatar (sheet Vaul) ; carte « Aujourd'hui » (mes portes / mes RDV du jour via fetchStats('jour'), barre obj-bar hebdo ; pour le manager : portes équipe du jour) ; section « Mes RDV aujourd'hui » (heure mono, client, adresse, tap → ClientSheet/carte) puis « À relancer » ; états vides explicites (« Aucun RDV aujourd'hui — N maisons à relancer »).
- **Écran(s)** : Accueil.

### B5. Filtres « Qui » sur la carte + pont Stats → Carte `[parcours-tournee + parcours-manager]`
- **Problème** : la carte partagée mêle les points de toute l'équipe sans filtre par commercial (manque n°2 de l'étude SalesRabbit) — on re-sonne aux portes du collègue ; et le drill-down Stats répond à « combien » mais jamais à « où ».
- **Reco** : rangée « Qui » dans la barre de filtres — chip « Mes points » (created_by = user) + chips par commercial (initiales) ; bouton « Voir ses points sur la carte » dans le drill-down Stats qui bascule sur l'onglet Carte avec le filtre pré-appliqué.
- **Écran(s)** : Carte, Stats.

### B6. Chip « À relancer » sur la carte `[parcours-tournee]`
- **Problème** : rien sur la carte n'exploite revisit_at — les relances dues sont invisibles à l'endroit exact où l'on en a besoin (dans le quartier).
- **Reco** : chip « À relancer » dans la barre de filtres (revisit_at ≤ aujourd'hui). *La pastille de marqueur « -due » proposée en plus a reçu un véto designer (bruit à 32 px) — renvoyée en §5.*
- **Écran(s)** : Carte.

### B7. Agenda : segment « Moi / Équipe » + couleur par commercial dans la grille `[parcours-rdv + archi-info + coherence-ui — fusion]`
- **Problème** : l'agenda charge tous les RDV de l'organisation sans filtre ; et deux codages couleur se contredisent (grille mois = statut du RDV, cartes = couleur du commercial) — ni le commercial ni le manager ne peuvent lire « à qui est quoi ».
- **Reco** : segment « Moi / Équipe » au-dessus du calendrier (défaut Moi pour un commercial, Équipe pour un manager — à valider, cf. §5), filtrant en amont de byDay/clients ; dans la grille mois, colorer les étiquettes par commercial (colorForCommercial déjà importé), le statut rendu par l'opacité (passé 45 %, annulé barré) ; micro-légende pastille + prénom sous la grille.
- **Écran(s)** : Agenda.

### B8. Stats : naviguer vers les périodes passées `[parcours-manager]`
- **Problème** : Jour/Semaine/Mois ne pointent que sur la période EN COURS — le bilan du lundi matin (semaine écoulée) est impossible.
- **Reco** : chevrons ‹ › (cibles 44 px) autour du libellé stats-range, offset passé à periodRange ; previousNow()/fetchStatsRange() existent déjà. Le delta compare à la période précédant celle affichée.
- **Écran(s)** : Stats.

### B9. Tunnel : « RDV honorés » sur une cohorte cohérente `[parcours-manager]`
- **Problème** : rdv_pris vient des point_events de la période mais rdv_effectues des appointments par scheduled_at — le taux peut dépasser 100 % et fausser le « point de blocage ».
- **Reco** : calculer « honorés » sur la cohorte agenda de la période (effectués ÷ planifiés de la période), sous-libellé « agenda de la période », et l'exclure de la détection du point de blocage. **À valider avec le chef des ventes** (cf. §5).
- **Écran(s)** : Stats (tunnel).

### B10. Téléphone client sur le point `[archi-info]`
- **Problème** : client_phone n'existe que sur appointments — le « rappelez-moi, voilà mon 06 » du statut à_revoir n'a pas de place et finit (ou pas) dans une note libre.
- **Reco** : colonne client_phone sur points (migration) + champ « Téléphone » sous « Client » dans la fiche point, rendu en lien tel: (icône Phone) dans l'en-tête et dans les lignes « À relancer » de l'Accueil ; synchronisé avec le RDV comme client_name l'est déjà.
- **Écran(s)** : Fiche point, Accueil, AppointmentForm.

### B11. ClientSheet : actions en tête, issues du jour, historique complet `[parcours-rdv + archi-info — fusion]`
- **Problème** : Appeler/Modifier/Carte sont relégués sous 3D + plan + rapport (plusieurs écrans de scroll) ; aucune issue (Vendu/Effectué/Manqué) n'est accessible depuis la fiche ; et la fiche n'affiche qu'un RDV « représentatif » et la dernière note — l'historique client est amputé.
- **Reco** : rangée d'actions sous client-info (Appeler · Itinéraire · Modifier + issues pour un RDV du jour, via setAppointmentOutcome/.appt-outcomes) ; section « Historique » : RDV du groupe (date + issue colorée) + journal de notes du point (fetchPointNotes + .note-history existants) ; la maison/3D/rapport en dessous (repliés, cf. B2).
- **Écran(s)** : Fiche client.

### B12. Adresse du RDV via l'autocomplétion BAN `[parcours-rdv + archi-info]`
- **Problème** : input texte libre dans AppointmentForm — un RDV créé depuis l'agenda n'a ni coordonnées ni point : pas de bouton « Carte », Waze géocode une adresse potentiellement fautive.
- **Reco** : brancher AddressSearch (BAN) sur le champ adresse ; stocker le label normalisé + lng/lat à la sélection ; proposer de lier/poser le point correspondant.
- **Écran(s)** : AppointmentForm.

### B13. Badge matériau tappable pour confirmer la toiture `[parcours-argumentaire]`
- **Problème** : le badge « Ardoise (probable) » est en haut de fiche, le select qui le confirme 4 blocs plus bas — la boucle constat → correction ne se fait pas, et suggestedWastePct (chutes) reste calculé sur la donnée fiscale.
- **Reco** : tap sur le badge matériau → menu CONFIRMED_MAT_OPTIONS (ou scroll+focus du select existant) ; badge en is-confirmed après confirmation.
- **Écran(s)** : Fiche point (HouseBadges).

### B14. Squelettes de chargement (Stats en priorité) `[coherence-ui]`
- **Problème** : tant que data === null, KPI/tunnel/classement affichent de FAUX zéros (plusieurs secondes en « Mois ») ; aucun écran n'a d'état squelette.
- **Reco** : blocs squelette (--surface-2, animation badge-pulse existante) à la place des chiffres tant que les données ne sont pas là ; même pattern pour les home-rows de l'Accueil. *Réserve du juré terrain (polish) — maintenu sur l'argument manager : commenter des chiffres faux en réunion.*
- **Écran(s)** : Stats, Accueil.

---

## 4. Lot C — Gros chantiers (effort fort)

### C1. Agenda : le planning du jour d'abord, le mois replié `[parcours-rdv]`
- **Problème** : la vue par défaut ouvre sur la grille mois (étiquettes 9 px, illisibles dehors) ; le premier RDV du jour n'arrive qu'après ~400 px de calendrier. Le besoin du matin est « mes RDV d'aujourd'hui, dans l'ordre ».
- **Reco** : replier le mois par défaut en bandeau semaine ; un tap sur le nom du mois déplie la grille complète (utile au manager — vue mois conservée, référence actée).
- **Maquette textuelle** :

  ```
  AVANT                              APRÈS
  ┌──────────────────────┐           ┌──────────────────────┐
  │ [Agenda|Clients] +RDV│           │ [Agenda|Clients] +RDV│
  │ ‹  Juillet 2026  ›   │           │ ‹ Juillet ▾ › [Auj.] │
  │ L M M J V S D        │           │ L  M  M  J  V  S  D  │  ← bandeau 7 cellules,
  │ [grille 6 semaines,  │           │ 20 21 22 23 24 25 26 │    pastilles de compte
  │  étiquettes 9px      │           │ ·  ··    ·  ●        │
  │  × 4 par cellule]    │           ├──────────────────────┤
  ├──────────────────────┤           │ AUJOURD'HUI · 3 RDV  │
  │ (scroller pour       │           │ 10:00  M. Martin   › │
  │  atteindre le jour)  │           │ 14:30  Mme Pichon  › │
  │ ...planning du jour  │           │ 16:00  M. Le Gall  › │
  └──────────────────────┘           └──────────────────────┘
                                     (tap « Juillet ▾ » → grille mois complète)
  ```
- **Écran(s)** : Agenda.

### C2. Rapport client partageable en document sur la PWA iOS `[parcours-argumentaire]`
- **Problème** : en standalone iOS (le cas nominal), window.print() est neutralisé et « Partager » n'envoie que 4-5 lignes de texte — le « document remis au prospect » n'existe pas sur le téléphone du commercial, face à des concurrents qui laissent un PDF EagleView.
- **Reco** : rendre le DOM du rapport en image/PDF côté client (SVG du plan + tableaux → canvas → `navigator.share({ files })`, iOS 15+) ; le texte actuel devient le message d'accompagnement.
- **Maquette textuelle** :

  ```
  AVANT (partage)                    APRÈS (partage)
  ┌──────────────────────┐           ┌──────────────────────┐
  │ SMS : « Toit 204 m², │           │ 📄 rapport-toiture-  │
  │ pente 34°, faîtage   │           │    12-rue-argoat.pdf │
  │ 12 m … » (5 lignes)  │           │  ├ En-tête brandé    │
  └──────────────────────┘           │  │ (agence·commercial│
                                     │  │  ·date — cf. A23) │
                                     │  ├ Plan coté (SVG)   │
                                     │  ├ Tableau des pans  │
                                     │  │ (sélection Σ, B3) │
                                     │  └ Arêtes + chutes   │
                                     │ + message texte      │
                                     └──────────────────────┘
  ```
- **Écran(s)** : RoofReport.

---

## 5. Architecture d'information — inventaire

| Info | Où elle est | Où elle devrait être | Verdict | Source |
|---|---|---|---|---|
| Date/heure + téléphone du RDV lié | Onglet Agenda uniquement | Fiche point (bloc RDV en tête) ET Agenda | dupliquer | archi-info, parcours-tournee/rdv |
| Téléphone client | `appointments` seulement | Champ dédié sur le point + lien tel: fiche point et relances Accueil | dupliquer | archi-info |
| RDV du jour | Agenda seulement | Accueil (section « Aujourd'hui ») + Agenda | dupliquer | coherence-ui |
| Journal de notes du point | Fiche point | Fiche point + ClientSheet (historique) | dupliquer | archi-info |
| Historique des RDV d'un client | Nulle part (1 seul RDV affiché) | ClientSheet, section « Historique » | dupliquer | archi-info |
| Date de création du point | En-tête fiche point (sans libellé) | Journal (1re entrée) ; en-tête = dernière visite (`visited_at`) | déplacer | archi-info |
| Provenance mesure laser / estimation / année | Tooltips `title` (morts sur iOS) | Texte du badge + popover au tap | déplacer | parcours-argumentaire, archi-info |
| Carte profil (nom ×2 + rôle) | Accueil, zone premium | Ligne d'en-tête unique / sheet profil | supprimer (fusionner) | archi-info, parcours-manager |
| « Se déconnecter » | Accueil, 1er niveau | Derrière l'avatar (sheet profil) | déplacer | archi-info, coherence-ui |
| « Toiture constatée » | Entre Client et Notes (fiche point) | Bloc toiture, sous HouseBadges | déplacer | parcours-tournee, archi-info |
| Champ « Client (nom) » | Toutes les visites | Statuts à_revoir / rdv_pris / vendu seulement | garder (conditionner) | archi-info |
| 3D / plan / rapport | Dépliés au milieu des fiches | Module « Toit mesuré » replié + segmented | déplacer | coherence-ui, parcours-argumentaire |
| Σ sélection de pans | Local à Roof3D | Partagé : 3D + plan + rapport | dupliquer | parcours-argumentaire |
| Couleur des étiquettes du mois (agenda) | Statut du RDV | Couleur du commercial (statut → opacité) | déplacer | coherence-ui, archi-info |
| Propriétaire du RDV | Petit nom en pied de carte (parfois email brut) | Prénom+initiale sur la carte + couleur dans la grille | dupliquer | parcours-rdv, coherence-ui |
| Boutons d'issue (Vendu/Manqué…) | Tous les RDV « à venir » | RDV du jour/passés + ClientSheet | déplacer | parcours-rdv, coherence-ui |
| Adresse du RDV (lien Waze caché) | Adresse cliquable sans affordance | Adresse en texte + bouton « Itinéraire » | déplacer | parcours-rdv, archi-info |
| Barre d'objectif hebdo | Classement, toutes périodes | Semaine uniquement | garder (conditionner) | parcours-manager |
| Portes toquées | Tunnel du focus courant seulement | Ligne de classement + KPI équipe | dupliquer | parcours-manager |
| Manager dans le classement | Classé avec les commerciaux | Agrégats équipe seulement | supprimer (du classement) | parcours-manager |
| Note « À ajuster selon le métier » | Pied des Stats, en prod | docs/questions-ouvertes.md + Info sur le tunnel | supprimer | parcours-manager, archi-info, coherence-ui |
| Jours du graphe d'activité | `title` (hover souris) | Étiquettes sous les barres | déplacer | parcours-manager, archi-info |
| Relances dues (revisit_at) | Accueil uniquement | Accueil + chip de filtre carte | dupliquer | parcours-tournee |
| Crayon d'objectif hebdo | Ligne de classement | Vue drill-down du commercial | déplacer | parcours-manager |

---

## 6. Points à trancher

Désaccords entre jurés et questions à poser au chef des ventes.

1. **Chip de statut = pose immédiate ?** Le juré terrain veut 1 tap (tap chip = point posé, toast en filet) ; le juré designer y oppose un véto d'ambiguïté (le même composant sélectionnerait dans la barre de visée et agirait dans la sheet). Consensus minimal retenu en A2 : libellé dynamique « Poser · À revoir ». → Demander au chef des ventes si la pose 1-tap vaut le risque de statut posé par erreur.
2. **Pastille « relance due » sur les marqueurs ?** Terrain pour (visible en marchant), designer contre (2e pastille sémantique sur 32 px = bruit). Retenu : chip de filtre seule (B6). → Trancher sur le terrain après livraison de la chip.
3. **Remplacement des dialogues système (A32)** : top 10 designer (« ce qui sépare Linear d'un prototype »), véto terrain (« le prompt moche fonctionne en 3 s, aucune vente en jeu »). Maintenu en queue de Lot A sur l'argument image (PWA « native » devant l'équipe) — à déprioriser si le temps manque.
4. **Défaut « Moi / Équipe »** (agenda B7, et filtres carte B5) : Moi pour un commercial, Équipe pour un manager — hypothèse à valider avec le chef des ventes (un manager-prospecteur voudra peut-être « Moi » aussi).
5. **Définition du « contact »** (tunnel Stats) : à revoir / RDV pris / vendu ? Question déjà listée dans docs/questions-ouvertes.md — à trancher AVANT de retirer la note (A27), pour que la définition affichée soit assumée.
6. **Cohorte « RDV honorés »** (B9) : le calcul proposé (effectués ÷ planifiés de la période) change la sémantique du tunnel — validation métier requise.
7. **Manager prospecteur** : exclu du classement (A24) mais compté dans les agrégats équipe — la SPEC laisse la question ouverte, confirmer avec le chef des ventes.
8. **Rafraîchissement de l'Accueil (A33)** : le designer le classe « registre technique, frontière du périmètre bugs » ; maintenu car l'effet (feed figé, sections absentes) est un problème de confiance utilisateur.

### Manques relevés par le jury (hors constats — à instruire comme questions ouvertes)

- **Terrain** : mode « rafale » de pose (dernier statut armé, tap = point — le tap-to-drop de SalesRabbit) ; suivi GPS/recentrage en marche ; coût de redémarrage de la PWA entre deux portes ; passe « lisibilité plein soleil » globale ; note vocale (dictée) sur la textarea.
- **Manager** : montant des ventes (CA, panier moyen — le classement ne classe pas ce qui compte) ; alerte « X RDV à solder » (passés restés « à venir ») ; traçabilité des issues (qui a marqué Vendu/Manqué, quand) ; présence terrain temps réel (« dernière activité il y a 2 h ») ; affectation de secteurs ; export/partage du bilan hebdo.
- **Designer** : gabarit commun aux 4 sheets Vaul (anatomy partagée AVANT d'exécuter le Lot A, sinon chaque correctif re-divergera) ; règle de microcopy (« POSER UN POINT » / « Poser le point » / « Poser ici ») ; audit des cibles tactiles 44 pt ; composant empty-state unique ; légende de la convention « chip barrée = pan exclu ».

---

## 7. Constats écartés (véto argumenté de 2 jurés ou plus)

| Constat | Raison de l'écartement |
|---|---|
| App.css : ~120 lignes de composants legacy hors tokens `[coherence-ui]` | Terrain : « hygiène de code, zéro seconde gagnée à la porte » ; Manager : « dette interne invisible de l'utilisateur, pas un constat d'ergonomie ». Reclassé en tâche d'hygiène technique hors audit UX (le nettoyage reste souhaitable lors d'un passage CSS). |
| Deltas KPI hors Geist Mono (sous-partie de « note dev + chiffres hors mono ») `[coherence-ui]` | Terrain et Manager : cosmétique. La partie « note de développeur » du même constat survit, fusionnée en A27. |

*Note de fusion : ~15 constats supplémentaires étaient des doublons inter-lentilles (RDV invisible dans la fiche point ×4, tooltips `title` ×3, Accueil ×3, note dev ×3, lien Waze ×2, BAN ×2, graphe muet ×2, CTA sous le pli / Enregistrer-Supprimer ×4). Ils n'ont pas été écartés : ils sont fusionnés dans A3, A7, A11, A17, A26, A27, B1, B2, B4, B7, B11 et B12, avec toutes leurs sources citées.*
