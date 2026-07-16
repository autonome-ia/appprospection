# Prompts réutilisables — AppProspection

Prompts à copier-coller au démarrage d'une nouvelle conversation.
⚠️ Toujours lancer la session **dans le dossier du projet** (`C:\Users\briac\AppProspection`)
pour que `CLAUDE.md` se charge automatiquement.

---

## Démarrage générique d'une session

```
Lis CLAUDE.md et docs/roadmap.md. On continue le projet AppProspection.
Aujourd'hui je veux travailler sur : [décrire le chantier].
```

---

## Audit de l'onglet Carte (rendu "pro" + recommandations)

```
Lis d'abord CLAUDE.md et docs/roadmap.md pour le contexte du projet AppProspection.

Objectif de cette session : AUDITER l'onglet CARTE et savoir si son rendu est
assez "pro", puis obtenir des recommandations concrètes d'amélioration.

1. Repère les fichiers de l'onglet carte :
   - web/src/components/MapView.tsx (cœur : couches, interactions, 3D, ortho)
   - web/src/config/map.ts (fond IGN, ortho)
   - web/src/config/markers.ts (marqueurs par statut)
   - web/src/components/StatusPicker.tsx, AddressSearch.tsx, PointDetailSheet.tsx
   - web/src/App.css (styles carte : .map-*, .chip, .address-*, .drawer-*)
   - web/src/index.css (tokens de la DA)

2. Lance un sous-agent (general-purpose) pour un AUDIT OBJECTIF de l'onglet carte.
   Donne-lui ces fichiers à lire et demande-lui d'évaluer, pour une app de
   prospection porte-à-porte en toiture (mobile-first, usage terrain à une main,
   en plein soleil, DA "Clair & précis" façon Linear/Vercel/Emil Kowalski) :
   - Qualité perçue / niveau "pro" du rendu vs des apps carto premium.
   - Design des marqueurs, lisibilité des statuts, clustering, halo de sélection.
   - Ergonomie : pose d'un point (nb de gestes), barre d'outils, recherche,
     panneau détail (drawer), gestion à une main, lisibilité au soleil.
   - Cohérence avec la DA (tokens, Geist, Lucide, pas d'emoji, ombres, rayons).
   - Vue Toits (ortho + noms de rues), vue 3D : pertinence et rendu.
   - Performance (milliers de points), pièges MapLibre.
   Il doit livrer : (a) un verdict "assez pro ou pas", (b) les 5-8 problèmes/
   faiblesses par ordre d'impact, (c) des recommandations CONCRÈTES et actionnables
   (quoi changer, où), en distinguant quick wins vs chantiers.

3. Pendant ce temps, lance l'app (cd web && npm run dev) et regarde le rendu réel.
   Demande-moi des captures d'écran de l'onglet carte (vue Toits, vue 3D, un point
   sélectionné, le clustering) pour un avis visuel — le code ne suffit pas à juger l'esthétique.

4. Synthétise l'audit + tes observations en un plan d'action priorisé, et propose-moi
   par quoi commencer. Ne code rien avant que je valide les priorités.
```

---

## Clôturer une session proprement

```
Mets à jour docs/roadmap.md (coche ce qui est fait, note ce qui reste) et
CLAUDE.md si une décision structurante a changé. Puis commit et push.
```
