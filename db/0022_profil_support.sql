-- 0022 — profil SUPPORT (12/08/2026, demande briac).
--
-- Un compte marqué `is_support` (dev/test — briac) devient INVISIBLE pour le
-- reste de l'équipe : ses événements et RDV sortent de TOUS les agrégats de
-- stats, ses points de la carte des superviseurs, ses RDV/tâches de l'agenda
-- partagé, ses relances/contacts des listes des autres. Lui continue de tout
-- voir (il teste). Indépendant de l'objectif hebdo 0 (qui ne gère que
-- classement + objectif équipe) : un commercial à 0 ne disparaît pas.
--
-- Volontairement SANS UI : le drapeau se pose ici, en SQL — pas de case à
-- cocher qu'un manager activerait par erreur.
--
-- À exécuter dans l'éditeur SQL Supabase (prod ; démo optionnelle — le code
-- se replie proprement tant que la colonne n'existe pas).

alter table public.profiles
  add column if not exists is_support boolean not null default false;

update public.profiles
set is_support = true
where id = (select id from auth.users where email = 'briac.roudaut@sciencespo.fr');

-- Contrôle : une seule ligne attendue (briac).
select p.full_name, u.email, p.is_support
from public.profiles p
join auth.users u on u.id = p.id
where p.is_support;
