-- 0021 — réparation de données : la vente au titulaire (12/08/2026).
--
-- Bug corrigé côté client le même jour : solder un RDV (« Vendu »/« Refus »)
-- ou basculer le point d'un collègue journalisait l'événement au nom de QUI
-- TAPAIT — la vente d'Alexandre, soldée par Alexis, comptait pour Alexis.
-- Désormais l'événement porte le titulaire du RDV (issue) ou le propriétaire
-- du point (bascule manuelle). Ce script répare l'HISTORIQUE.
--
-- À exécuter dans l'éditeur SQL Supabase (prod). Étape 1 = contrôle visuel,
-- étape 2 = réattribution. Ne touche que les ventes dont l'auteur n'est pas
-- le propriétaire du point (la nouvelle règle, appliquée au passé).

-- 1) CONTRÔLE : lister les ventes mal attribuées avant de corriger.
select e.id, e.occurred_at,
       ea.full_name as comptee_pour, pa.full_name as proprietaire_du_point,
       p.client_name, p.address
from public.point_events e
join public.points   p  on p.id = e.point_id
join public.profiles ea on ea.id = e.author_id
join public.profiles pa on pa.id = p.created_by
where e.status = 'vendu'
  and p.created_by is not null
  and e.author_id <> p.created_by
order by e.occurred_at desc;

-- 2) RÉATTRIBUTION : chaque vente rejoint le propriétaire du point.
update public.point_events e
set author_id = p.created_by
from public.points p
where p.id = e.point_id
  and e.status = 'vendu'
  and p.created_by is not null
  and e.author_id <> p.created_by;
