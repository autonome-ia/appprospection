-- =============================================================================
-- Migration 0019 — Équipe : invitations par code, désactivation, RLS par rôle
-- Chantier Équipe (09/08/2026). À exécuter APRÈS 0018 (elle utilise les
-- valeurs d'enum chef_ventes / secretaire).
-- =============================================================================
-- Décisions actées (cadrage validé par briac le 09/08) :
--   * UN code d'invitation par agence (8 caractères, alphabet sans O/0/I/1),
--     table séparée organization_invites → lisible manager + chef des ventes
--     seulement (RLS), rotation par RPC manager.
--   * Inscription : CODE OBLIGATOIRE. Plus aucune agence ne se crée à
--     l'inscription — une nouvelle agence se crée en SQL (insert dans
--     organizations ; le trigger lui fabrique son code).
--   * « Supprimer un compte » = DÉSACTIVATION (profiles.disabled_at) : le
--     compte est bloqué net (current_org_id() renvoie null → toutes les
--     policies tombent), historique et stats intacts, réactivable.
--   * chef_ventes = pouvoirs manager sur les données TERRAIN (is_supervisor),
--     jamais sur les comptes ni l'objectif hebdo (is_manager strict + trigger).
--   * secretaire = lecture partout ; écrit uniquement des contacts AU NOM
--     d'un commercial (point + journal + RDV lié) — jamais d'issue terrain.
--   * TROU FERMÉ : profiles_update_self ne restreignait aucune colonne —
--     n'importe qui pouvait s'auto-promouvoir manager via l'API REST. Un
--     trigger garde désormais role / organization_id / weekly_rdv_target /
--     disabled_at (bypass si auth.uid() est null : SQL editor, amorçage).
--   * TROU FERMÉ : appointments.commercial_id n'était pas contraint — il doit
--     désormais appartenir à l'agence.
--
-- NB inscription : une exception levée dans handle_new_user fait échouer le
-- signup avec un message générique côté Supabase (« Database error saving new
-- user ») — l'écran d'inscription appelle d'abord validate_invite(code) pour
-- afficher un vrai message et le nom de l'agence rejointe.

-- =============================================================================
-- 1. DÉSACTIVATION D'UN COMPTE
-- =============================================================================

alter table public.profiles
  add column if not exists disabled_at timestamptz;

-- =============================================================================
-- 2. HELPERS RLS (remplacent/complètent ceux de 0001)
-- =============================================================================
-- current_org_id() est LE kill-switch : un profil désactivé n'a plus d'org,
-- donc plus aucune policy ne passe, lecture comprise (sauf son propre profil,
-- cf. §6 — pour que l'app puisse afficher « compte désactivé »).

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles
  where id = auth.uid() and disabled_at is null;
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager' and disabled_at is null
  );
$$;

-- Manager OU chef des ventes : les pouvoirs « terrain ».
create or replace function public.is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager', 'chef_ventes')
      and disabled_at is null
  );
$$;

create or replace function public.is_secretaire()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'secretaire' and disabled_at is null
  );
$$;

-- « uid est un membre ACTIF de MON agence » — pour créer au nom d'un autre.
create or replace function public.is_org_member(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = uid and organization_id = public.current_org_id()
      and disabled_at is null
  );
$$;

-- =============================================================================
-- 3. GARDE-FOU SUR profiles (ferme le trou d'auto-promotion)
-- =============================================================================
-- La RLS ne sait pas restreindre des COLONNES : ce trigger le fait.
-- auth.uid() null = SQL editor / service_role → tout est permis (amorçage
-- Mister Toiture, promotions initiales des comptes de test).

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Changement d''agence réservé à l''administration';
  end if;

  if new.role is distinct from old.role
     or new.weekly_rdv_target is distinct from old.weekly_rdv_target
     or new.disabled_at is distinct from old.disabled_at then
    if not public.is_manager() then
      raise exception 'Modification réservée au manager';
    end if;
    if old.id = auth.uid()
       and (new.role is distinct from old.role
            or new.disabled_at is distinct from old.disabled_at) then
      raise exception 'Un manager ne change pas son propre rôle et ne se désactive pas lui-même';
    end if;
  end if;

  -- Ne jamais rétrograder ni désactiver le DERNIER manager actif de l'agence.
  if old.role = 'manager' and old.disabled_at is null
     and (new.role <> 'manager' or new.disabled_at is not null) then
    if not exists (
      select 1 from public.profiles p
      where p.organization_id = old.organization_id
        and p.role = 'manager' and p.disabled_at is null
        and p.id <> old.id
    ) then
      raise exception 'Impossible : dernier manager actif de l''agence';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- =============================================================================
-- 4. CODE D'INVITATION PAR AGENCE
-- =============================================================================

-- 8 caractères, alphabet lisible à voix haute (sans O/0/I/1) : 32^8 ≈ 10^12.
create or replace function public.gen_invite_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

create table if not exists public.organization_invites (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  code             text not null unique default public.gen_invite_code(),
  updated_at       timestamptz not null default now()
);

alter table public.organization_invites enable row level security;

-- Le code n'est lisible que par le manager et le chef des ventes (l'UI le
-- montre dans l'écran Équipe). Aucune écriture client : trigger + RPC.
drop policy if exists invites_select_supervisor on public.organization_invites;
create policy invites_select_supervisor on public.organization_invites
  for select using (
    organization_id = public.current_org_id() and public.is_supervisor()
  );

-- Toute nouvelle agence (créée en SQL) reçoit son code automatiquement.
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organization_invites (organization_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_org();

-- Backfill : les agences existantes reçoivent leur code.
insert into public.organization_invites (organization_id)
select id from public.organizations
on conflict do nothing;

-- Rotation du code (fuite) — manager uniquement.
create or replace function public.regen_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if not public.is_manager() then
    raise exception 'Réservé au manager';
  end if;
  for i in 1..5 loop
    begin
      update public.organization_invites
        set code = public.gen_invite_code(), updated_at = now()
        where organization_id = public.current_org_id()
        returning code into new_code;
      return new_code;
    exception when unique_violation then
      -- collision astronomique : on retente
    end;
  end loop;
  raise exception 'Génération du code impossible';
end;
$$;

-- Vérification AVANT inscription (appelable anonyme) : renvoie le nom de
-- l'agence si le code existe, sinon null. Sert aussi de repli : tant que
-- cette migration n'est pas passée, la RPC n'existe pas → l'écran
-- d'inscription affiche une erreur claire, aucune inscription possible dans
-- la mauvaise agence.
create or replace function public.validate_invite(invite_code text)
returns text language sql stable security definer set search_path = public as $$
  select o.name
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.code = upper(trim(invite_code));
$$;

grant execute on function public.validate_invite(text) to anon, authenticated;

-- =============================================================================
-- 5. INSCRIPTION PAR CODE (remplace la création d'agence de 0001)
-- =============================================================================
-- Tout nouvel inscrit arrive COMMERCIAL dans l'agence du code ; le manager
-- attribue ensuite les rôles via l'écran Équipe.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code_input text := upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  org_id     uuid;
begin
  if code_input = '' then
    raise exception 'Code d''invitation requis';
  end if;

  select organization_id into org_id
  from public.organization_invites
  where code = code_input;

  if org_id is null then
    raise exception 'Code d''invitation invalide';
  end if;

  insert into public.profiles (id, organization_id, full_name, role)
  values (
    new.id,
    org_id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'commercial'
  );

  return new;
end;
$$;

-- =============================================================================
-- 6. RLS — MATRICE PAR RÔLE
-- =============================================================================

-- 6.1 profiles : un compte désactivé doit encore lire SON profil (l'app
--     affiche « compte désactivé » au lieu de tourner dans le vide).
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- 6.2 points : pose par soi ; superviseur et secrétaire posent AU NOM d'un
--     membre de l'agence (contact téléphonique → le point appartient au
--     commercial choisi, sinon sa carte privée ne le verrait jamais).
drop policy if exists points_insert_org on public.points;
create policy points_insert_org on public.points
  for insert with check (
    organization_id = public.current_org_id()
    and (
      created_by = auth.uid()
      or ((public.is_supervisor() or public.is_secretaire())
          and public.is_org_member(created_by))
    )
  );

drop policy if exists points_update_owner_or_manager on public.points;
create policy points_update_owner_or_manager on public.points
  for update using (
    organization_id = public.current_org_id()
    and (created_by = auth.uid() or public.is_supervisor())
  )
  with check (organization_id = public.current_org_id());

drop policy if exists points_delete_owner_or_manager on public.points;
create policy points_delete_owner_or_manager on public.points
  for delete using (
    organization_id = public.current_org_id()
    and (created_by = auth.uid() or public.is_supervisor())
  );

-- 6.3 point_events : journal — mêmes règles d'attribution que les points
--     (l'événement du contact saisi par la secrétaire porte le nom du
--     commercial). Suppression : superviseur (était manager).
drop policy if exists events_insert_self on public.point_events;
create policy events_insert_self on public.point_events
  for insert with check (
    organization_id = public.current_org_id()
    and (
      author_id = auth.uid()
      or ((public.is_supervisor() or public.is_secretaire())
          and public.is_org_member(author_id))
    )
  );

drop policy if exists events_delete_manager on public.point_events;
drop policy if exists events_delete_supervisor on public.point_events;
create policy events_delete_supervisor on public.point_events
  for delete using (
    organization_id = public.current_org_id() and public.is_supervisor()
  );

-- 6.4 point_notes : l'insert reste « auteur = soi » pour tous (0004, une note
--     signée secrétaire est une vraie note de secrétaire) ; suppression
--     élargie au superviseur.
drop policy if exists point_notes_delete_author_or_manager on public.point_notes;
drop policy if exists point_notes_delete_author_or_supervisor on public.point_notes;
create policy point_notes_delete_author_or_supervisor on public.point_notes
  for delete using (
    organization_id = public.current_org_id()
    and (author_id = auth.uid() or public.is_supervisor())
  );

-- 6.5 appointments : le titulaire doit appartenir à l'agence (trou fermé).
--     Un commercial crée pour lui-même ; superviseur et secrétaire créent au
--     nom d'un membre (la secrétaire : des RDV seulement, pas de tâches).
--     La secrétaire ne peut jamais produire un RDV au statut terrain
--     (Vendu / En attente / Refus) : WITH CHECK — et de toute façon l'issue
--     écrit aussi dans points/point_events où elle n'a pas ces droits.
drop policy if exists appts_insert_org on public.appointments;
create policy appts_insert_org on public.appointments
  for insert with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
    and (
      commercial_id = auth.uid()
      or ((public.is_supervisor() or public.is_secretaire())
          and public.is_org_member(commercial_id))
    )
    and (not public.is_secretaire() or kind = 'rdv')
  );

drop policy if exists appts_update_owner_or_manager on public.appointments;
create policy appts_update_owner_or_manager on public.appointments
  for update using (
    organization_id = public.current_org_id()
    and (commercial_id = auth.uid() or created_by = auth.uid() or public.is_supervisor())
  )
  with check (
    organization_id = public.current_org_id()
    and (not public.is_secretaire() or status in ('a_venir', 'annule'))
  );

drop policy if exists appts_delete_owner_or_manager on public.appointments;
create policy appts_delete_owner_or_manager on public.appointments
  for delete using (
    organization_id = public.current_org_id()
    and (commercial_id = auth.uid() or created_by = auth.uid() or public.is_supervisor())
  );

-- =============================================================================
-- FIN — migration 0019
-- =============================================================================
-- Pour créer une nouvelle agence (amorçage, futur client) :
--   insert into public.organizations (name) values ('Nom de l''agence');
--   select o.name, i.code from public.organizations o
--     join public.organization_invites i on i.organization_id = o.id;
