# Plan du chantier NUMBERS (25/09/2026)

> Deuxième espace de l'app : après la **prospection** (carte, agenda, stats de terrain),
> **Numbers** pilote l'**argent** : ventes, CA, commissions, objectifs de CA.
> Besoin : Alexis (manager, Mister Toiture Brest). Cadrage : briac, 25/09/2026.
> Branche **`design`** (site β, briac seul) ; `main` seulement sur feu vert de briac.

## 0. Décisions de cadrage (ne pas re-débattre)

| # | Sujet | Décision |
|---|---|---|
| D1 | Forme | **Une seule app, deux espaces.** Un switch sur l'Accueil fait passer de Prospection à Numbers ; la barre d'onglets change. **Même DA « Encre & signal »**, mêmes composants (`<Sheet>`, `<Segmented>`, `<FormGroup>`, `Num`), mêmes tokens, mode sombre compris. |
| D2 | Prestation | **Une vente = une prestation** : toiture, façade, isolation, traitement du bois, gouttière, énergie. |
| D3 | Saisie | Le formulaire s'ouvre **juste après « Vendu »** (issue de RDV ou bascule « RDV pris » → « Client »), et depuis **« + Vente »** dans Numbers (lead entrant, ancien client…). L'**origine** (prospection, lead entrant, ancien client) est **choisie par le commercial**, jamais pré-remplie. |
| D4 | Vente à deux | **2 vendeurs maximum, 50/50.** Chacun a la moitié du CA, la moitié de la vente dans ses compteurs (0,5 toiture) et sa commission sur **sa moitié**. Côté agence, la vente compte **une fois** (1 toiture, pas 2). |
| D5 | Montants | **Tout en HT** (montant, montant financé, commissions). |
| D6 | Annulation | Une vente a un statut : **active / annulée** (rétractation 14 jours, financement refusé). Annulée = sortie du CA, des commissions et des compteurs. **Le point de la carte change** (voir D16). Qui peut annuler : les vendeurs de la vente et le manager. |
| D7 | Taux | Taux par défaut **de l'agence et par prestation** (toiture/façade/isolation/traitement du bois 13 %, gouttière 8 %, énergie 5 %), que le manager peut **surcharger par commercial et par prestation**. **Chaque vente garde le taux du jour où elle est faite** : changer un taux ne réécrit pas le passé. |
| D8 | Modification | Un commercial modifie **ses** ventes (les deux vendeurs d'une vente à deux le peuvent). Le **tableau de l'agence** n'est que la somme de toutes les ventes : il se met à jour seul, sans être modifiable en tant que tel. Le **manager** modifie tout. Le **chef des ventes** lit tout, et ne modifie que si le manager lui en donne le droit (case dans l'écran Équipe). |
| D9 | Visibilité | Commercial : ses ventes en entier (cahier perso), et le **tableau de l'agence** (vendeurs, prestation, montant, paiement) + le classement de CA. Il **ne voit pas** les commissions des autres, ni le cahier global (client, adresse, note des ventes des autres). Manager et chef des ventes : tout. **Secrétaire : aucun accès à Numbers.** |
| D10 | Périodes | Tableaux et stats en **semaine · mois · trimestre · année**. Les **objectifs de CA sont mensuels**, par commercial, fixés par le manager ; l'objectif de l'agence = **somme** des objectifs des commerciaux. |
| D11 | « À compléter » | Si le commercial ferme le formulaire, la vente **existe quand même**, marquée « à compléter », avec un rappel dans Numbers : on ne bloque jamais le terrain. Les ventes déjà enregistrées dans l'app avant Numbers (sans montant) apparaissent aussi « à compléter ». Pas d'import. |
| D12 | Option payante | Numbers est une **option par agence** (`organizations.numbers_enabled`, posée **en SQL uniquement**, comme `is_support`). Sans elle : pas de switch, pas de formulaire après « Vendu », et la base refuse tout accès. Pendant la conception : **activée sur l'agence de démo seulement**. |
| D13 | Rôles | Le manager et le chef des ventes qui vendent ont **leur propre espace** (mon CA, ma commission) en plus de la vue agence. |
| D14 | Onglets | **Accueil · Ventes · Tableaux · Stats** (4, comme la prospection). Si Tableaux et Stats font doublon une fois codés, on fusionne. |

### Réponses du 25/09 (questions de clôture)

- **D15 : traitement du bois = 13 %** par défaut (modifiable, comme les autres).
- **D16 : une vente annulée n'existe plus NULLE PART** (briac : « une vente, c'est une vraie vente
  qui est allée jusqu'au bout »). À l'annulation, en une transaction (trigger) :
  - le point passe en **« Refus »** (`impossible`) ;
  - l'événement `vendu` du journal lié à la vente est **réécrit en `impossible`** : la porte reste
    comptée (elle a été toquée), la vente sort du tunnel et des Stats de prospection. **Aucun
    nouvel événement** (sinon la porte compterait deux fois) ;
  - le RDV lié en « Vendu » passe en **« Refus »** : il reste un RDV tenu (« RDV effectués »),
    plus une vente.
  Réactiver une vente (manager seul) refait le chemin inverse.
- **D17 : objectif de CA mensuel fixe** par commercial (le même chaque mois), comme l'objectif
  hebdo de RDV.

### Tour UI/UX du 26/09 (3 audits : pilotage manager, commercial terrain, DA)

- **D18 : prestations en ENCRE** : toiture en encre pleine, les autres en gris ; barre de répartition + liste chiffrée à la place des anneaux (les couleurs rappelaient les statuts de la carte).
- **D19 : le 3e onglet devient « Équipe »** (manager, chef des ventes : un tableau par vendeur, vue paie) **ou « Commissions »** (commercial : ses ventes, sa part, sa commission + le tableau de l'agence). « Toutes les ventes » disparaît : c'est le cahier.
- **D20 : commissions « acquises / en attente »** (rétractation, financement accepté) : PLUS TARD, après avis d'Alexis.
- **D21 : un commercial ne voit pas l'objectif de ses collègues** (ni %, ni retard) : leur CA et le rang seulement.
- Pilotage : comparaison **à date** (« vs 26 août »), rythme (repère « attendu à ce jour », reste, projection), Accueil manager centré agence + « Qui décroche », Accueil commercial centré commission + rang. UI en **vouvoiement**, libellés à la 1re personne (« Ma commission »), comme le reste de l'app.

## 1. Modèle de données (migration `db/0031_numbers.sql`)

> Numérotation : la branche `site` a déjà écrit `0027` à `0030` (non exécutées).
> Numbers commence donc à **0031** pour que les deux branches fusionnent sans collision.
> Migration **additive** : aucune table existante n'est modifiée dans son comportement,
> l'app de prod (qui ne lit pas ces tables) est insensible à son exécution.

```sql
-- Option par agence (organizations_logo_guard, db/0025, bloque déjà toute
-- modification client d'une autre colonne que logo_url : SQL uniquement).
alter table organizations add column numbers_enabled boolean not null default false;

create type sale_prestation as enum
  ('toiture','facade','isolation','traitement_bois','gouttiere','energie');
create type sale_origin  as enum ('prospection','lead_entrant','ancien_client');
create type sale_payment as enum ('comptant','financement');
create type sale_status  as enum ('active','annulee');

-- Taux par défaut de l'agence (une ligne par prestation, amorcée à l'activation).
create table commission_rates (
  organization_id uuid references organizations on delete cascade,
  prestation sale_prestation,
  rate numeric(5,4) not null check (rate between 0 and 1),   -- 0.13 = 13 %
  primary key (organization_id, prestation)
);

-- Surcharges du manager, par commercial et par prestation.
create table profile_commission_rates (
  profile_id uuid references profiles on delete cascade,
  prestation sale_prestation,
  rate numeric(5,4) not null check (rate between 0 and 1),
  organization_id uuid not null,
  primary key (profile_id, prestation)
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  sold_on date not null,                         -- date de la vente (jour du RDV par défaut)
  client_name text, address text, note text,
  origin sale_origin,                            -- null = à compléter
  prestation sale_prestation,                    -- null = à compléter
  amount_ht numeric(12,2) check (amount_ht >= 0),          -- null = à compléter
  payment sale_payment,
  financed_ht numeric(12,2) check (financed_ht >= 0),
  seller1_id uuid not null references profiles,
  seller2_id uuid references profiles,           -- vente à deux (50/50), max 2 par construction
  rate1 numeric(5,4), rate2 numeric(5,4),        -- taux FIGÉS (posés par trigger, D7)
  status sale_status not null default 'active',
  cancelled_at timestamptz,
  point_id uuid references points on delete set null,
  event_id uuid unique references point_events on delete set null, -- l'événement « vendu » (D16)
  appointment_id uuid unique references appointments on delete set null, -- 1 vente par RDV
  created_by uuid, created_at timestamptz default now(),
  updated_by uuid, updated_at timestamptz default now(),
  check (seller2_id is null or seller2_id <> seller1_id),
  check (payment is distinct from 'financement' or financed_ht is not null),
  check (financed_ht is null or amount_ht is null or financed_ht <= amount_ht)
);

-- Objectif de CA mensuel et droit de modification du chef des ventes :
-- colonnes gardées par profiles_guard (manager seul), comme weekly_rdv_target.
alter table profiles
  add column monthly_ca_target numeric(12,2) not null default 0,
  add column can_edit_sales boolean not null default false;
```

**Pourquoi deux colonnes vendeurs plutôt qu'une table de liaison** : « 2 maximum » est garanti
par la structure même, la RLS reste lisible (`auth.uid() in (seller1_id, seller2_id)`) et le
50/50 se déduit (`seller2_id` renseigné = moitié chacun).

**Triggers** :
- `sales_rates` (avant insert / update de `prestation`, `seller1_id`, `seller2_id`) : pose
  `rate1`/`rate2` = surcharge du vendeur, sinon taux de l'agence. **Jamais recalculés** sur un
  autre changement : le taux du jour de la vente est figé (D7). Personne ne peut écrire
  `rate1`/`rate2` à la main, sauf le manager (correction exceptionnelle).
- `sales_guard` : `organization_id` immuable, `updated_by/updated_at` posés par la base,
  `status` → `annulee` pose `cancelled_at` ; seul le manager peut **réactiver** une vente annulée.
- `sales_cancel_sync` : à l'annulation, point → « Refus », événement `vendu` lié réécrit en
  `impossible`, RDV lié « Vendu » → « Refus » (D16), dans la même transaction ; inverse à la
  réactivation.
- RPC `ensure_vendu_sale(point, rdv)` : appelée juste après un « Vendu », retrouve l'événement
  `vendu` du point, crée la vente « à compléter » (vendeur = auteur de l'événement, date = jour
  de l'événement, client et adresse du point) ou renvoie celle qui existe déjà (anti-doublon par
  `event_id` et `appointment_id`).
- `numbers_activate(org)` (SQL, support) : active l'option, amorce les 6 taux et crée une vente
  « à compléter » pour chaque vente déjà journalisée (D11).

## 2. Sécurité en base (RLS)

Helpers (security definer, même style que db/0019) :
- `numbers_on()` : l'agence de l'utilisateur a l'option ET il n'est pas secrétaire.
- `can_edit_all_sales()` : `is_manager()` OU (chef des ventes ET `can_edit_sales`).

| Objet | Lecture | Écriture |
|---|---|---|
| `sales` (ligne complète : client, adresse, note, taux) | vendeur de la vente, ou `is_supervisor()` | insert/update : vendeur de la vente (dont lui-même en seller1 ou seller2) ou `can_edit_all_sales()` ; **delete : manager seul** (la voie normale est l'annulation) |
| vue `sales_board` (tableau de l'agence) | tout membre `numbers_on()` | aucune |
| `commission_rates` | tout membre `numbers_on()` | manager |
| `profile_commission_rates` | sa ligne, ou superviseur | manager |
| `profiles.monthly_ca_target`, `can_edit_sales` | comme le profil | manager (profiles_guard étendu) |

La vue `sales_board` expose **seulement** : id, date, vendeurs, prestation, montant HT,
paiement, montant financé, statut. Ni client, ni adresse, ni note, ni taux : c'est ce qui rend
D9 vrai **en base** (un commercial ne peut pas lire le cahier des autres, même en bricolant l'API).
Toutes les policies exigent `numbers_on()` : sans l'option, rien ne passe (D12).

> Limite assumée : le taux par défaut de l'agence étant connu, un commercial peut **estimer**
> la commission d'un collègue à partir de son CA. Les surcharges individuelles, elles, restent
> invisibles.

**Banc RLS** : `tools/rls-test/rls-test.mjs` reçoit un bloc « numbers » (commercial A ne lit pas
les ventes de B, lit `sales_board` ; secrétaire refusée partout ; chef des ventes en lecture
seule puis en écriture avec le droit ; agence sans l'option refusée ; taux non modifiables par
un commercial ; vente à trois vendeurs impossible ; annulation → point basculé).

## 3. Règles de calcul (`domain/sales.ts`, testées en vitest)

Sur les ventes **actives et complètes** de la période (les « à compléter » sont listées à part,
les annulées ne comptent nulle part) :

| Indicateur | Vendeur | Agence |
|---|---|---|
| Part d'une vente | 1 seul · 0,5 à deux | 1 |
| CA | Σ montant HT × part | Σ montant HT |
| Nombre de ventes / de toitures | Σ part | nombre |
| **TRC** | Σ financé × part ÷ Σ montant × part | Σ financé ÷ Σ montant |
| **Part toiture** | CA toiture ÷ CA total | idem |
| Commission | Σ montant HT × part × taux figé | (manager seul) Σ des commissions |
| Panier moyen | CA ÷ nombre de ventes | idem |
| Objectif | objectif mensuel × nombre de mois de la période (pas d'objectif en vue semaine) | Σ des objectifs |

Mêmes exclusions que les Stats de prospection : ventes d'un compte `is_support` hors agrégats
de l'équipe ; manager masqué du classement sauf « M'afficher » (`isManagerHiddenFor`) ;
objectif de CA à 0 = pas de barre d'objectif, mais le vendeur reste au classement dès qu'il a du CA (l'objectif de CA est nouveau : à 0 par défaut pour tout le monde).

Formats : euros entiers `12 450 €` (espace fine insécable), taux `13 %`, TRC `62 %`,
tous en `Num`/`.tnum` (Geist Mono réservé aux chiffres, doctrine typo).

## 4. Écrans

### 4.1 Le switch d'espace
- État `space: 'prospection' | 'numbers'` dans `App.tsx`, mémorisé en localStorage (confort
  par appareil, repli prospection).
- **Sur l'Accueil des deux espaces**, sous l'en-tête : un `<Segmented>` « Prospection · Numbers ».
  Absent si l'option n'est pas activée ou pour la secrétaire.
- `BottomNav` reçoit la liste d'onglets de l'espace. En Numbers, la carte **reste montée mais
  cachée** (retour instantané, rien de rechargé). Transition : fondu court (`--dur-*` existants),
  `reducedMotion` respecté.
- Le popup du matin (`PendingOutcomes`) et la célébration restent actifs dans les deux espaces.

### 4.2 Formulaire de vente (`SaleSheet`)
`<Sheet>` (gabarit iOS verrouillé) + `<FormGroup>` :
1. **Montant HT** (clavier numérique, gros champ chiffré)
2. **Prestation** : 6 choix en grille de puces (Lucide, pas d'emoji)
3. **Vendu** : `<Segmented>` Seul · À deux → sélecteur du 2e vendeur (commerciaux actifs)
4. **Paiement** : `<Segmented>` Comptant · Financement → champ « Montant financé HT »
5. **Origine** : `<Segmented>` Prospection · Lead entrant · Ancien client (aucun choix pré-coché)
6. Date (jour du RDV par défaut), client et adresse (repris du point ou du RDV), note
7. Aperçu en direct : « Ta commission : 1 618 € » (sa part, son taux)

Branchement « Vendu » (4 points d'entrée, un seul helper `openSaleAfterVendu`) : issue de RDV
dans l'Agenda, dans `RdvSection` (fiche point), dans le popup du matin, et bascule manuelle dans
`PointDetailSheet`. **La vente « à compléter » est créée en base AVANT l'ouverture du
formulaire** : fermer la sheet ne perd rien (D11). Anti-doublon : `appointment_id` unique, et
réouverture de la vente existante si le point en a déjà une du jour.

### 4.3 Onglets Numbers
- **Accueil** : switch ; carte héros « Mon CA du mois » + jauge d'objectif ; ma commission
  du mois ; bloc « À compléter » (ventes sans montant, tap = formulaire) ; mes dernières ventes.
  Manager / chef des ventes : en plus, CA de l'agence et objectif de l'agence.
- **Ventes** (cahier des ventes) : liste par date (date, client, adresse, prestation, montant,
  paiement, origine, vendeur(s), note) ; filtre « Mes ventes / Agence » pour manager et chef des
  ventes ; filtres période, prestation, origine ; bouton **« + Vente »** ; tap = détail
  modifiable (selon droits) avec « Annuler la vente » (deux taps, comme « Supprimer »).
- **Tableaux** : `<Segmented>` **Mon tableau · Agence** + période. Tableau dense (vendeur,
  prestation, montant, paiement, financé), totaux en pied. Vue mobile : lignes-cartes, pas de
  tableau horizontal qui déborde.
- **Stats** : mêmes codes visuels que les Stats de prospection (héros, ruban de chiffres,
  graphique) : CA, ventes, toitures, TRC, part toiture, panier moyen, CA par prestation,
  comptant / financement, évolution sur la période ; **classement de CA** avec progression vers
  l'objectif ; drill-down d'un commercial pour manager / chef des ventes.

### 4.4 Écran Équipe (manager)
Dans la fiche d'un membre : **objectif de CA mensuel** (stepper, comme l'objectif hebdo),
**taux de commission** par prestation (défaut de l'agence affiché, surcharge possible, retour au
défaut), et pour un chef des ventes la case **« Peut modifier les ventes »**. Un bloc « Taux de
l'agence » règle les 6 taux par défaut. Visible seulement si l'option est activée.

### 4.5 Temps réel
Abonnement Realtime sur `sales` (même modèle que `subscribeAppointments`) : une modification
du manager se voit **immédiatement** dans le tableau du vendeur (exigence Alexis). La vue
`sales_board` n'émet pas d'événement : on écoute la table, on recharge la vue.

## 5. DA : même app, même style

- Aucun nouveau jeton de couleur d'**action** : l'orange reste pour les actions et états actifs.
- Pas de couleur de marque pour les montants : **l'argent est en encre**. Vert `--st-vendu`
  seulement pour dire « vendu » (comme sur la carte), rouge/ambre seulement pour l'annulée et
  l'« à compléter ».
- Couleurs de données : **couleur = commercial** (domain/colors.ts) dans le classement et les
  tableaux, comme dans l'agenda. Répartition par prestation : nuances d'encre (toiture en encre
  pleine, le reste en gris dégressifs), pas d'arc-en-ciel.
- Styles dans `web/src/styles/numbers.css`, importé par `App.css` avant `theme-dark.css` ;
  vérification systématique du **mode sombre** (le clair ne bouge d'aucun pixel ailleurs).
- Chaînes visibles : **vouvoiement** comme le reste de l'app, libellés à la 1re personne (« Ma commission ») ; pas de tiret long.

## 6. Découpage en étapes

| Étape | Contenu | Livrable testable par briac |
|---|---|---|
| **N1** | Migration `0031` + banc RLS « numbers » ; exécution en base, option activée sur la **démo** | rapport du banc |
| **N2** | `data/sales.ts`, `domain/sales.ts` (calculs + tests vitest), périodes semaine/mois/trimestre/année | tests verts |
| **N3** | Shell : switch d'espace, `BottomNav` par espace, 4 écrans Numbers vides stylés | sur le β : le switch |
| **N4** | `SaleSheet` + branchement des 4 « Vendu » + « + Vente » | sur le β : vendre une maison de la démo |
| **N5** | Cahier des ventes : liste, filtres, détail, édition, annulation (→ point) | |
| **N6** | Tableaux (mon tableau / agence) + temps réel | modifier en manager, voir en commercial |
| **N7** | Stats Numbers + classement de CA + objectifs | |
| **N8** | Écran Équipe : objectifs de CA, taux, droit du chef des ventes | |
| **N9** | Sondes Playwright (clair + sombre, 4 rôles), passe DA, relecture | captures comparées |
| **N10** | Mise en prod sur **feu vert briac** : fusion `design` → `main`, activation Mister Toiture en SQL, taux vérifiés avec Alexis | |

Chaque étape : `npm run build` vert, commit sur `design`, push → β redéployé, test briac.

## 7. Risques et points d'attention

- **Base partagée** : le β écrit dans la base de prod. La migration est additive et l'option
  n'est activée que sur la démo : Brest ne voit rien avant N10.
- **Fusion avec `site`** : les deux branches touchent `App.tsx`, `AccueilScreen.tsx`,
  `TeamSheet.tsx` (refondu côté site, +453/-242), `session.tsx` et `profiles_guard`.
  Numéros de migration déjà séparés (0027-0030 site, 0031+ Numbers). Dans `TeamSheet`, ajouter
  des blocs plutôt que réorganiser pour limiter les conflits. À terme, `numbers_enabled` pourra
  se ranger dans le système d'offres du site (`organizations.plan`).
- **Double saisie** : « Vendu » crée la vente automatiquement ; « + Vente » sert aux ventes
  hors carte. Un « + Vente » pour une maison déjà vendue via la carte propose d'ouvrir la vente
  existante.
- **Données d'argent** : aucune règle de visibilité ne vit seulement dans l'UI (§2).
