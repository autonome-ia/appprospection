-- =============================================================================
-- AppProspection — Schéma de base de données (Supabase / PostgreSQL)
-- Migration initiale : 0001_init
-- =============================================================================
-- Principes :
--   * Multi-tenant : chaque donnée métier porte un organization_id, cloisonné
--     strictement par Row Level Security (RLS).
--   * Deux niveaux pour la carte :
--       - `points`        = état ACTUEL d'une maison (1 marqueur sur la carte)
--       - `point_events`  = JOURNAL horodaté de chaque visite (source des stats)
--   * `appointments`      = agenda partagé (RDV créés au statut "rdv_pris").
-- Périmètre : MVP. Hors périmètre ici (v2+) : chat, carnet de contacts/CRM,
--   objectifs de RDV paramétrables, mesure de toiture.
-- =============================================================================

-- Extensions --------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "postgis";     -- géographie / requêtes spatiales

-- =============================================================================
-- 1. TYPES (enums métier)
-- =============================================================================

-- Rôles utilisateur
create type public.user_role as enum ('commercial', 'manager');

-- Statuts d'un point de prospection (liste figée — SPEC §5)
create type public.point_status as enum (
  'absent',     -- personne / pas d'ouverture
  'a_revoir',   -- repasser plus tard
  'impossible', -- inutile d'y retourner (pas cible ou inaccessible)
  'rdv_pris',   -- rendez-vous obtenu  -> crée un appointment
  'vendu'       -- vente conclue
);

-- Cycle de vie d'un RDV dans l'agenda
create type public.appointment_status as enum (
  'a_venir',   -- planifié, pas encore eu lieu
  'effectue',  -- le RDV a eu lieu
  'vendu',     -- le RDV a débouché sur une vente
  'manque',    -- le client n'était pas là / RDV non honoré
  'annule'     -- annulé
);

-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- 2.1 Organisations (agences) -------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- 2.2 Profils (extension de auth.users de Supabase) ---------------------------
-- Chaque utilisateur authentifié possède 1 profil rattaché à 1 organisation.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  full_name        text,
  role             public.user_role not null default 'commercial',
  color            text,                    -- couleur agenda (hex), 1 par commercial
  created_at       timestamptz not null default now()
);
create index profiles_organization_id_idx on public.profiles (organization_id);

-- 2.3 Points (état actuel d'une maison sur la carte) --------------------------
create table public.points (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  status           public.point_status not null,
  address          text,                    -- adresse géocodée (BAN)
  lat              double precision not null,
  lng              double precision not null,
  -- Colonne géographique dérivée -> requêtes spatiales efficaces (viewport, distance)
  location         geography(Point, 4326)
                     generated always as (
                       (st_setsrid(st_makepoint(lng, lat), 4326))::geography
                     ) stored,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index points_organization_id_idx on public.points (organization_id);
create index points_location_gix        on public.points using gist (location);
create index points_status_idx          on public.points (organization_id, status);

-- 2.4 Journal des visites (source des statistiques) ---------------------------
-- Une ligne par action d'un commercial sur une maison. On n'écrase jamais :
-- l'historique complet reste disponible pour les stats jour/semaine/mois.
create table public.point_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  point_id         uuid not null references public.points (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  status           public.point_status not null,  -- statut posé lors de cette visite
  note             text,
  occurred_at      timestamptz not null default now()
);
create index point_events_org_time_idx on public.point_events (organization_id, occurred_at);
create index point_events_point_idx    on public.point_events (point_id);
create index point_events_author_idx   on public.point_events (author_id, occurred_at);

-- 2.5 Agenda partagé (RDV) ----------------------------------------------------
create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  point_id         uuid references public.points (id) on delete set null,
  commercial_id    uuid references public.profiles (id) on delete set null, -- titulaire du RDV
  created_by       uuid references public.profiles (id) on delete set null,
  scheduled_at     timestamptz not null,
  address          text,
  client_name      text,
  client_phone     text,
  status           public.appointment_status not null default 'a_venir',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index appointments_org_time_idx   on public.appointments (organization_id, scheduled_at);
create index appointments_commercial_idx on public.appointments (commercial_id, scheduled_at);

-- =============================================================================
-- 3. TRIGGERS UTILITAIRES
-- =============================================================================

-- 3.1 Mise à jour automatique de updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger points_set_updated_at
  before update on public.points
  for each row execute function public.set_updated_at();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- 3.2 Provisionnement automatique à l'inscription --------------------------
-- MVP : à la création d'un compte, on crée une organisation et un profil
-- (rôle manager = propriétaire de son agence). Sera remplacé par un vrai flux
-- d'invitation quand plusieurs commerciaux rejoindront une même agence.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(new.raw_user_meta_data ->> 'organization_name', 'Mon agence'))
  returning id into new_org_id;

  insert into public.profiles (id, organization_id, full_name, role)
  values (
    new.id,
    new_org_id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'manager'
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 4. FONCTIONS D'AIDE POUR LES POLITIQUES RLS
-- =============================================================================
-- SECURITY DEFINER pour lire `profiles` sans dépendre de sa propre RLS.

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================
-- Règle générale : on ne voit et n'écrit QUE dans sa propre organisation.
-- Les données (carte, journal, agenda) sont partagées au sein de l'équipe.

alter table public.organizations  enable row level security;
alter table public.profiles        enable row level security;
alter table public.points          enable row level security;
alter table public.point_events    enable row level security;
alter table public.appointments    enable row level security;

-- 5.1 organizations : on voit uniquement la sienne
create policy org_select_own on public.organizations
  for select using (id = public.current_org_id());

-- 5.2 profiles : voir toute l'équipe ; ne modifier que son propre profil
create policy profiles_select_org on public.profiles
  for select using (organization_id = public.current_org_id());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and organization_id = public.current_org_id());

-- (Création des profils : via flux d'invitation / admin — voir §7 du doc.)

-- 5.3 points : lecture équipe ; création dans son org ; édition auteur ou manager
create policy points_select_org on public.points
  for select using (organization_id = public.current_org_id());

create policy points_insert_org on public.points
  for insert with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
  );

create policy points_update_owner_or_manager on public.points
  for update using (
    organization_id = public.current_org_id()
    and (created_by = auth.uid() or public.is_manager())
  )
  with check (organization_id = public.current_org_id());

create policy points_delete_owner_or_manager on public.points
  for delete using (
    organization_id = public.current_org_id()
    and (created_by = auth.uid() or public.is_manager())
  );

-- 5.4 point_events : journal en lecture équipe ; on n'insère que ses propres actions.
--     Pas d'UPDATE (un journal ne se réécrit pas). Suppression réservée au manager.
create policy events_select_org on public.point_events
  for select using (organization_id = public.current_org_id());

create policy events_insert_self on public.point_events
  for insert with check (
    organization_id = public.current_org_id()
    and author_id = auth.uid()
  );

create policy events_delete_manager on public.point_events
  for delete using (
    organization_id = public.current_org_id() and public.is_manager()
  );

-- 5.5 appointments : agenda partagé ; création dans son org ; édition titulaire/manager
create policy appts_select_org on public.appointments
  for select using (organization_id = public.current_org_id());

create policy appts_insert_org on public.appointments
  for insert with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
  );

create policy appts_update_owner_or_manager on public.appointments
  for update using (
    organization_id = public.current_org_id()
    and (commercial_id = auth.uid() or created_by = auth.uid() or public.is_manager())
  )
  with check (organization_id = public.current_org_id());

create policy appts_delete_owner_or_manager on public.appointments
  for delete using (
    organization_id = public.current_org_id()
    and (commercial_id = auth.uid() or created_by = auth.uid() or public.is_manager())
  );

-- =============================================================================
-- 6. TEMPS RÉEL (Supabase Realtime)
-- =============================================================================
-- Diffuse les changements aux clients (carte/agenda partagés en direct).
alter publication supabase_realtime add table public.points;
alter publication supabase_realtime add table public.point_events;
alter publication supabase_realtime add table public.appointments;

-- =============================================================================
-- FIN — migration 0001_init
-- =============================================================================
