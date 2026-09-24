# Chantier DESIGN « next level » (ouvert le 24/09/2026)

> Contexte : l'app a été présentée par Alexis au directeur régional de Mister Toiture. Il adore,
> le concept est validé. Objectif de briac : une qualité « digne d'Apple » avec de belles animations,
> une UI parfaite et un effet wow, sans rendu « vibecodé ».

## Décisions de cadrage (briac, 24/09)
- **La DA « Encre & signal » peut ÉVOLUER** : des touches plus iOS sont possibles (matières
  translucides, flou derrière les barres, rayons et relief revus). Chaque évolution est arbitrée
  sur planches comparées (`da-shots.mjs`), jamais imposée par un skill. Invariants tant que briac
  ne les rouvre pas : un seul accent orange réservé aux actions, couleurs sémantiques des statuts,
  Geist, pas d'emojis, le clair par défaut ne bouge qu'au travers d'une décision explicite.
- **Parcours retouchables** : on garde les 4 onglets et la logique métier. On a le droit de
  réorganiser les fiches, de réduire les taps et de fusionner des écrans. Pas de refonte de la
  navigation.
- **Pas d'échéance** : on vise la qualité.
- **Skills** : Emil Kowalski (`apple-design`, `emil-design-eng`, `mobile-native`,
  `review-animations`) et Jakub Krehel (`make-interfaces-feel-better`), installés dans
  `.claude/skills/` (versions figées, voir `PROVENANCE.md`). Le plugin `frontend-design` est
  désactivé pour ce projet (`.claude/settings.json`) : il pousse à « choisir des polices
  inattendues », à l'opposé d'une DA établie.
- Écartés après inspection : ui-ux-pro-max (génère un système de design, on en a un), taste-skill
  (landing pages), les skills « Apple HIG » natifs (SwiftUI, trop lourds), interface-design
  (redondant). Impeccable : possible en passe ponctuelle sur une branche jetable (binaire + hooks).

## Garde-fous
- La DA de CLAUDE.md et les correctifs du chantier scroll sheets iOS (`repositionInputs={false}`,
  `flex-shrink:0`, recollage au blur) priment sur toute règle de skill.
- En sombre, le relief passe par les bordures (règle Jakub « ombres plutôt que bordures » ne
  s'applique qu'au clair).
- Écran de connexion : placeholders « Email » / « Mot de passe » et bouton « Se connecter »
  intouchables (sondes Playwright).
- Pas de tirets longs dans l'UI.

## Phases
Ordre retenu : **fondations d'abord, puis écran par écran**, en traitant UX, UI et animations
ensemble sur chaque écran (pas « design puis UI puis UX » : la DA existe déjà et polir un écran
dont le parcours va changer serait du travail jeté).

0. **Outillage** : skills installés ✅. Captures « avant » de tous les écrans, clair et sombre,
   sur le banc de l'agence de démo (référence pour les comparaisons).
1. **Audit « écart Apple »** : critique de chaque écran avec les skills, priorisée ; comptage des
   taps sur les 3 parcours clés (poser un point, prendre un RDV, lire ses stats). Repartir du
   reliquat de `docs/audit-ux-ui.md`, ne pas le refaire.
2. **Fondations** : tokens de mouvement (ressorts, durées, courbes), normalisation espacements /
   rayons / ombres, primitives partagées (bouton avec retour à l'appui, ligne de liste, en-tête de
   sheet, segmenté, états vides, squelettes). Découpage de `App.css` (3 540 lignes). Motion n'est
   utilisé que dans 2 composants aujourd'hui.
3. **Écran par écran, par fréquence d'usage** : Carte + fiches (60 à 80 fois par jour), puis
   Agenda, Accueil, Stats.
4. **Moments « wow »** : connexion et premier lancement, transitions d'onglets, célébration d'une
   vente, chiffres des stats animés, rapport client, icône et écran de démarrage.
5. **Recette** : 60 fps sur un iPhone moyen, `prefers-reduced-motion`, accessibilité, test terrain
   par Alexis.

## Journal
- 24/09 : cadrage, recherche et inspection des skills, installation (phase 0).
