-- Agence de test JETABLE pour le banc RLS (tools/rls-test/rls-test.mjs).
-- À exécuter dans le SQL Editor Supabase APRÈS db/0018 et db/0019.
-- Le trigger on_organization_created fabrique le code d'invitation ;
-- la 2e requête l'affiche — c'est lui qu'on passe à « rls-test.mjs signup ».

insert into public.organizations (name)
values ('RLS Test — jetable')
on conflict do nothing;

select o.name, i.code
from public.organizations o
join public.organization_invites i on i.organization_id = o.id
where o.name = 'RLS Test — jetable';
