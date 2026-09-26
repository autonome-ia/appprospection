-- =============================================================================
-- 0033 : ORIGINE ET ÉVÉNEMENT DANS LE TABLEAU DE L'AGENCE (26/09/2026, décision briac)
--
-- Les Stats de la PROSPECTION comptent désormais les ventes depuis Numbers
-- (parts : une vente à deux = 0,5 chacun), mais seulement celles d'origine
-- « Prospection » (ou pas encore renseignée : un « Vendu » à compléter) —
-- le tunnel reste celui du porte-à-porte, les leads entrants et anciens
-- clients vivent dans Numbers. Chaque commercial doit donc connaître
-- l'ORIGINE des ventes de ses collègues : on l'ajoute à la vue sales_board.
-- Pas une donnée sensible (ni client, ni adresse, ni note, ni taux : D9 tient).
-- event_id aussi : les « Vendu » du journal SANS vente Numbers liée (historique
-- d'avant Numbers, jamais importé) continuent de compter 1 pour leur auteur ;
-- ceux qui ont une vente liée comptent par la vente (parts) — ni trou, ni doublon.
--
-- create or replace view n'accepte qu'un ajout de colonne EN FIN de liste.
-- Rejouable. À exécuter dans le SQL Editor AVANT la mise en prod du code
-- (sans elle, les Stats gardent le comptage par le journal de la carte).
-- =============================================================================

create or replace view public.sales_board as
  select s.id, s.organization_id, s.sold_on, s.prestation, s.amount_ht,
         s.payment, s.financed_ht, s.seller1_id, s.seller2_id, s.status,
         s.created_at, s.origin, s.event_id
  from public.sales s
  where s.organization_id = public.current_org_id() and public.numbers_on();

revoke all on public.sales_board from anon;
grant select on public.sales_board to authenticated;

-- Contrôle : la colonne origin est là.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'sales_board' and column_name in ('origin', 'event_id');
