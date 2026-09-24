-- 0025 — Photo de profil et logo d'agence (chantier design, 24/09/2026,
-- demande briac).
--
-- · Chaque membre peut mettre SA photo (Profil & réglages). Personne ne
--   change celle d'un autre, manager compris (décision briac).
-- · Seul le MANAGER change le logo de l'agence (écran Équipe), comme
--   l'objectif hebdo.
-- · Images dans le bucket Storage PUBLIC « media » : l'app les affiche par
--   URL directe (pas de jeton à renouveler). Chemins fixes et opaques :
--     avatars/<uuid du profil>.jpg      logos/<uuid de l'agence>.png
--   (JPEG pour les photos : Safari iOS n'encode pas le WebP ; PNG pour le
--   logo : il garde sa transparence.) L'URL stockée porte un ?v=<horodatage>
--   pour contourner les caches à chaque remplacement. Images recadrées et
--   réduites côté client (~256 px, quelques dizaines de Ko).
--
-- À exécuter dans l'éditeur SQL Supabase (prod ; démo optionnelle). Le code
-- se replie proprement tant que les colonnes n'existent pas (initiales et
-- monogramme partout, boutons de changement masqués).

-- 1. Colonnes ---------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;
alter table public.organizations
  add column if not exists logo_url text;

-- 2. Garde-fou : la photo d'un profil ne se change QUE par son titulaire.
--    (profiles_update_manager laisse le manager modifier les autres lignes :
--    nom, objectif, rôle… mais pas leur photo.)
create or replace function public.profiles_avatar_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.avatar_url is distinct from old.avatar_url
     and old.id <> auth.uid() then
    raise exception 'Chacun ne change que sa propre photo';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_avatar_guard on public.profiles;
create trigger profiles_avatar_guard
  before update on public.profiles
  for each row execute function public.profiles_avatar_guard();

-- 3. Logo : le manager met à jour SON agence — et seulement la colonne logo.
drop policy if exists org_update_logo_manager on public.organizations;
create policy org_update_logo_manager on public.organizations
  for update using (id = public.current_org_id() and public.is_manager())
  with check (id = public.current_org_id() and public.is_manager());

create or replace function public.organizations_logo_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (to_jsonb(new) - 'logo_url') is distinct from (to_jsonb(old) - 'logo_url') then
    raise exception 'Seul le logo de l''agence est modifiable depuis l''app';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_logo_guard on public.organizations;
create trigger organizations_logo_guard
  before update on public.organizations
  for each row execute function public.organizations_logo_guard();

-- 4. Stockage ----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Écriture : sa propre photo ; le logo de son agence si manager. La lecture
-- publique passe par l'URL publique du bucket ; la policy SELECT ci-dessous
-- sert à l'upsert (remplacement) côté client.
drop policy if exists media_select_own on storage.objects;
create policy media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or (name = 'logos/' || public.current_org_id()::text || '.png' and public.is_manager())
    )
  );

drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or (name = 'logos/' || public.current_org_id()::text || '.png' and public.is_manager())
    )
  );

drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or (name = 'logos/' || public.current_org_id()::text || '.png' and public.is_manager())
    )
  )
  with check (
    bucket_id = 'media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or (name = 'logos/' || public.current_org_id()::text || '.png' and public.is_manager())
    )
  );

drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or (name = 'logos/' || public.current_org_id()::text || '.png' and public.is_manager())
    )
  );

-- Contrôle.
select column_name, table_name from information_schema.columns
where (table_name = 'profiles' and column_name = 'avatar_url')
   or (table_name = 'organizations' and column_name = 'logo_url');
select id, public, file_size_limit from storage.buckets where id = 'media';
