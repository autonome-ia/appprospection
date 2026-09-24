# Audit « écart Apple » (24/09/2026, chantier design)

> Phase 1 du plan `docs/plan-chantier-design.md`. 4 auditeurs (Carte + fiches · Agenda + Contacts ·
> Accueil + Stats + Connexion · socle transverse), référentiel = skills `.claude/skills/`, DA de
> CLAUDE.md prioritaire. Captures de référence : `screenshoots/design/avant-{clair,sombre}/`
> (banc agence de démo, `REF=avant [THEME=dark] node tools/screenshots/shoot.mjs`).

## Verdict
Base propre (échelle typo 100 % respectée, sombre cohérent, métier solide) : niveau « bonne app
métier ». Ce qui la fait paraître vibecodée :
1. **Rien ne bouge** : Motion utilisé dans 2 composants, aucun retour à l'appui sur la majorité des
   boutons, sheets et barres qui apparaissent/disparaissent sèchement, aucun `prefers-reduced-motion`.
2. **L'orange sert de donnée** (tunnel, graphe, objectif, Σ m², bloc RDV) alors que le bouton
   principal de la fiche est gris : la hiérarchie est inversée.
3. **Des chiffres qui se contredisent** (16 vs 14 portes, 1 vs 3 RDV du jour) et un « ↓ 50 % »
   rouge qui se lit comme une chute.
4. **Socle sans échelle** : 34 valeurs d'espacement, 16 rayons, 12 ombres, 15 z-index, 54 couleurs
   en dur, 6 échelles de pression différentes, squelette de drawer recopié 9 fois.
5. **Petits accrocs mobiles** : flash gris iOS à chaque tap, pas de `:focus-visible`, theme-color
   blanc sur fond #f6f6f5, pas d'écran de démarrage iOS.

## Bugs visuels avérés
- « Refus » quasi invisible en sombre (couleurs d'issue en hex inline qui contournent les tokens
  `--st-*`) : `domain/appointments.ts:39`, `AgendaScreen.tsx:246`, `PendingOutcomes.tsx:124`,
  `RdvSection.tsx:174`.
- Carte : recherche collée au bouton de position, « + » par-dessus l'attribution IGN, chips de
  filtre coupées net, pastilles m² empilées.
- Accueil et Stats rejouent squelette + cascade à chaque retour d'onglet (écrans démontés).
- Stats : changer de période garde les anciens chiffres sous le nouveau libellé pendant le fetch.
- `stats-2.png` = `stats-1.png` (la sonde ne défile pas : classement non capturé).

## Lot 1 : socle (invisible un par un, décisif ensemble)
1. Base mobile-native : `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`,
   `user-select`/`-webkit-touch-callout` sur boutons et nav, `:focus-visible` global, theme-color
   clair + sombre (meta media) et manifest aligné sur `--bg`.
2. Tokens de mouvement (`--ease-out/-in-out/-drawer`, `--dur-press 120 · fast 160 · base 220 ·
   slow 320`, `--press-scale .97 / .98`) + miroir `lib/motion.ts` (ressorts snappy {0.3, 0},
   smooth {0.4, 0.1}, release {0.5, 0.15}, celebrate {0.6, 0.35}) + `MotionConfig reducedMotion="user"`
   + bloc CSS reduced-motion.
3. `.pressable` généralisé (icon-btn, text-btn, chip, seg, rangées, nav, issues).
4. Code mort (~120 lignes `.sheet*`, `.signout-btn`) + token `--on-ink`.
5. Découpage mécanique de App.css en `styles/` (classes inchangées, ordre de cascade conservé,
   validé par captures), puis tokenisation espacements/rayons/z-index/couleurs.
6. Primitives : `<Sheet>` (verrouille les correctifs iOS des 9 drawers), `<Segmented>` (indicateur
   à ressort partout), `<Button>`, `<IconButton>` (44 px), `<Chip>`, `<ListRow>`, `<EmptyState>`,
   `<Skeleton>`.

## Lot 2 : corrections visibles (S, gros effet)
- Tunnel/graphe/objectif sans orange (couleurs sémantiques ou encre), connecteur neutre au lieu du
  « ↓ 50 % » rouge, « 14 portes utiles / 16 ».
- Fiche point : bloc RDV et adresse en encre, l'accent réservé à l'action ; bouton principal jamais
  à la couleur du statut ; heure de RDV seule en mono.
- Couleurs d'issue via tokens (bug sombre) ; teal orphelin `#12b3a6` retiré.
- Carte : écarts et rayons des contrôles flottants, attribution repliée, fondu au bord des chips.
- Accueil : en-tête allégé (ligne marque supprimée, une seule cible profil), rythme 24/8 px,
  « Ma journée · 3 ».
- Agenda : semaines vides compactes, civilité retirée des pilules, titre de mois sur une ligne,
  issues en 3 colonnes + « Annulé » en texte, cercle « fait » façon Rappels.
- Stats : état « chargement » (fondu .45) au changement de période, graphe mois lisible au doigt.
- Connexion : champs groupés style iOS (placeholders et bouton intacts), spinner, secousse à l'erreur,
  tutoiement partout.
- Stagger/squelettes joués une seule fois par session (cache stale-while-revalidate).

## Lot 3 : parcours (décisions briac requises)
- **Pose en 1 tap** (tap chip = point posé, toast « Annuler ») : Absent 3 → 2 taps.
- **Fiche qui passe à la maison suivante** sans se fermer (-1 tap par porte) ; délai de tap 300 → 180 ms
  avec onde immédiate.
- **Formulaire RDV ouvert immédiatement** après « RDV pris » (optimiste, plus de carte vide).
- **Recherche d'adresse → fiche maison directe.**
- **RDV depuis l'agenda** : champ unique « Client ou adresse » qui lie ou crée le point (aujourd'hui
  le RDV n'a pas de maison et sort du tunnel) ; « + » unique RDV/Tâche sur le mois.
- **Issue de RDV annulable** 5 s (toast) ; « À planifier » pour un RDV pris sans date dans Contacts.
- Dates relatives et formateur unique (« Aujourd'hui · 17:30 », « Demain »).

## Lot 4 : moments « wow »
- Coup de tampon à la pose (glyphe qui vole vers la maison + onde couleur statut).
- Réticule vivant (adresse visée en direct, contour du bâtiment).
- Balayage LiDAR (pans révélés en cascade, Σ m² qui compte).
- Chiffres qui roulent (`@number-flow/react`) sur Accueil et Stats ; tunnel qui se dessine.
- Objectif hebdo atteint (bascule vert, reflet, coche dessinée, une fois par semaine).
- Pile du matin (popup en cartes, « Journée soldée »).
- Mois au doigt dans l'agenda (glissement 1:1, élan, élastique).
- « Vendu » qui se ressent (remplissage, coche, halo).
- Démarrage : marque = icône = écran de démarrage iOS, sans spinner.
- Récap de la semaine partageable (image papier via `lib/report-image.ts`).

## Évolutions de DA à trancher sur planches (`da-shots.mjs`)
- Matière translucide des contrôles flottants de la carte (blur 20 px, désactivée sous
  `prefers-reduced-transparency`).
- Couleurs du tunnel : sémantiques des statuts ou encre.
- Contraste : `--ink-3` #8b8b93 échoue AA en clair (3,1 à 3,4) → #6f6f77 ; `--accent-text` #c94100
  pour l'orange en texte. Touche le clair.
- Barre d'état `black-translucent` (carte bord à bord façon Plans).
- Contacts en liste groupée à filets, sections par échéance.

## Points déjà tranchés par le passé (à re-confirmer, pas à appliquer d'office)
- Pose 1 tap : laissée ouverte en juillet (véto « ambiguïté » du juré designer).
- Chips de date dans le formulaire RDV : RETIRÉES par briac le 25/07.
