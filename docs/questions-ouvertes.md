# Questions ouvertes — à poser à l'expert métier

> Préparé pour la session de clarification (soir du 2026-07-16).
> Objectif : figer les points bloquants avant/pendant le MVP. D'autres questions viendront pendant le code.
> Priorité : 🔴 bloquant MVP · 🟠 important · 🟡 à cadrer plus tard.

---

## A. Statuts & carte

1. ✅ **TRANCHÉ (2026-07-16, Hypothèse A)** : **5 statuts** — Absent, À revoir, **Impossible** (fusion de « hors cible » + « impossible » = inutile d'y retourner), RDV pris, Vendu. Voir `SPEC.md` §5. À reconfirmer avec l'ami : est-il OK avec la fusion, ou veut-il distinguer « pas cible » vs « inaccessible » ?
2. 🟠 **Un point = une maison ?** Que se passe-t-il si on repasse sur une maison déjà pointée : on écrase le statut, on garde un historique, on empile plusieurs visites ?
3. 🟠 **Distinction visuelle sur la carte** : les points sont colorés **par statut**, **par commercial**, ou les deux ? Comment tu veux les distinguer d'un coup d'œil ?
4. 🟠 **Info attachée à un point** : juste le statut, ou aussi nom/tél du prospect, une note, une date de « à repasser » ?
5. 🟡 **Vue liste** : quels filtres/tri utiles (par statut, par commercial, par quartier, par date) ?

## B. Agenda

6. 🟠 Quand un « RDV pris » crée un événement agenda, quelles infos faut-il saisir sur le moment (date, heure, adresse auto, nom du client) ?
7. 🟠 Peut-on **modifier / déplacer / annuler** un RDV dans l'agenda ? Marquer « RDV effectué » vs « RDV manqué » ?
8. 🟡 Vues souhaitées : jour, semaine, mois ? Notifications/rappels avant un RDV ?
9. 🟡 « Même style que Groupcall » — tu peux me montrer une capture ? Qu'est-ce qui te plaît précisément dedans ?

## C. Statistiques

10. 🟠 **« RDV effectué »** : comment sait-on qu'un RDV a eu lieu ? Le commercial le coche manuellement ? Ça sort d'où ?
11. 🟠 **Objectif de RDV** : fixé par qui (manager), sur quelle période (jour/semaine/mois), par commercial ou par équipe ?
12. 🟡 Le manager doit-il pouvoir **exporter** les stats (Excel/PDF) ?

## D. Rôles, comptes & commercialisation

13. 🟠 **Le manager prospecte-t-il aussi** (pose des points) ou uniquement supervision ?
14. 🟠 **Taille d'équipe** cible au lancement (combien de commerciaux chez lui) ?
15. ✅ **TRANCHÉ (2026-07-16)** : outil **interne d'abord** (une seule agence), objectif de le vendre à d'autres agences **si ça marche dans son équipe**. → Archi conçue multi-tenant, mais pas d'inscription publique ni facturation au MVP.
16. 🟡 Qui peut **inviter / créer** les comptes commerciaux (le manager seul) ?

## E. Chat

17. 🟠 Périmètre du chat : **annonces manager → équipe** uniquement, ou **messagerie complète** (commerciaux entre eux, messages privés) ? (tu hésitais dans le doc)

## F. Terrain & technique (impact fort sur l'archi)

18. ✅ **TRANCHÉ (2026-07-16, à reconfirmer avec l'ami)** : on **suppose qu'il y a du réseau** sur le terrain pour l'instant → **pas de mode hors-ligne au MVP**. À revalider avec l'ami : ses commerciaux ont-ils vraiment toujours de la 4G en prospection ? (si non, mode hors-ligne à ajouter en v2).
19. ✅ **TRANCHÉ (2026-07-16)** : app native sur les stores **pas nécessaire** au départ → on part sur une **web app / PWA** (choix techno en cours de discussion dev). À demander à l'ami plus tard : quels téléphones utilise son équipe (iPhone / Android / mix) ?
20. ✅ **TRANCHÉ (2026-07-16)** : mesure de toiture **hors MVP** (gros chantier, nice to have). Reportée en v2+.
21. 🟡 **Précision de géolocalisation** attendue : au niveau de la maison, ou de la rue suffit ?

## G. Données & légal

22. 🟠 **RGPD** : on va stocker des adresses de particuliers + un statut commercial. As-tu une contrainte/politique côté entreprise ? Combien de temps garde-t-on ces données ?
23. 🟡 Que se passe-t-il quand un commercial **quitte l'entreprise** : ses points/RDV restent à l'agence ?

## H. Priorités MVP (arbitrage)

24. 🔴 On te propose un **premier MVP** = carte partagée + points + agenda auto + stats de base (voir `SPEC.md` §8). **Mesure de toit, CRM, chat, hors-ligne** viendraient après. Es-tu OK pour démarrer comme ça, ou un de ces éléments est indispensable dès le jour 1 ?
25. 🟠 Si tu ne devais garder **qu'une seule** fonctionnalité pour convaincre ton équipe de l'utiliser, ce serait laquelle ?
