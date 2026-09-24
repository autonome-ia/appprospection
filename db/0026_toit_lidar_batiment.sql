-- 0026 — Mesure LiDAR mise en cache PAR BÂTIMENT (24/09/2026, demande briac :
-- « la mesure prend 30-60 s, avant c'était ~10 s »).
--
-- Avant : seule la mesure d'un POINT posé était gardée (colonnes toit_lidar_*
-- de `points`). Une maison CONSULTÉE sans point (fiche maison) était
-- re-mesurée à chaque tap, pour chacun, en rappelant le serveur COPC de l'IGN
-- (lent depuis le 18/09). Désormais toute mesure est rangée ici, par
-- bâtiment : le 2e tap sur la même maison, par n'importe quel membre de
-- l'agence, s'affiche en ~0,2 s, sans aucun appel à l'IGN.
--
-- · Clé = identifiant BD TOPO du bâtiment (`cleabs`), suffixé « #<id RNB> »
--   quand un polygone fusionné (bande de maisons) est découpé par le RNB.
-- · Boîte englobante + emprise (lon/lat) : l'app retrouve la maison tapée
--   SANS requête IGN (tap dans l'emprise). Tap hors emprise (jardin, ≤ 10 m)
--   → l'app interroge l'IGN pour le bâtiment, puis ce cache par clé.
-- · Cloisonné PAR AGENCE (RLS) : une agence ne voit pas les rues prospectées
--   par une autre (SaaS). Écriture par RPC uniquement, avec la même garde de
--   version que cache_point_lidar (0011) : un client pas encore mis à jour
--   n'écrase jamais une mesure plus récente.
-- · Jamais de verdict `error` (panne réseau) ni `no_data` « hors couverture »
--   (zone pas encore survolée) : ceux-là doivent être re-tentés.
--
-- À exécuter dans l'éditeur SQL Supabase. Le code se replie proprement tant
-- que la table n'existe pas (mesure comme avant, sans cache par bâtiment).

create table if not exists public.roof_measures (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  building_key    text not null,
  version         smallint not null,
  min_lng         double precision not null,
  min_lat         double precision not null,
  max_lng         double precision not null,
  max_lat         double precision not null,
  emprise         jsonb not null,
  result          jsonb not null,
  measured_at     timestamptz not null default now(),
  primary key (organization_id, building_key)
);

-- Recherche « quel bâtiment contient ce tap » : filtre agence + latitude.
create index if not exists roof_measures_bbox_idx
  on public.roof_measures (organization_id, min_lat, max_lat);

alter table public.roof_measures enable row level security;

drop policy if exists roof_measures_select on public.roof_measures;
create policy roof_measures_select on public.roof_measures
  for select using (organization_id = public.current_org_id());
-- Pas de policy insert/update/delete : écriture via le RPC ci-dessous.

create or replace function public.cache_building_lidar(
  p_key      text,
  p_version  smallint,
  p_min_lng  double precision,
  p_min_lat  double precision,
  p_max_lng  double precision,
  p_max_lat  double precision,
  p_emprise  jsonb,
  p_result   jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.roof_measures as r
    (organization_id, building_key, version, min_lng, min_lat, max_lng, max_lat, emprise, result, measured_at)
  select public.current_org_id(), p_key, p_version, p_min_lng, p_min_lat, p_max_lng, p_max_lat,
         p_emprise, p_result, now()
  where public.current_org_id() is not null
    and length(p_key) between 1 and 200
    and p_result->>'toit_lidar_statut' in ('ok', 'faible_confiance', 'grand_batiment', 'no_data')
    and coalesce(p_result->'toit_lidar_diag'->>'motif', '') <> 'hors_couverture'
  on conflict (organization_id, building_key) do update set
    version     = excluded.version,
    min_lng     = excluded.min_lng,
    min_lat     = excluded.min_lat,
    max_lng     = excluded.max_lng,
    max_lat     = excluded.max_lat,
    emprise     = excluded.emprise,
    result      = excluded.result,
    measured_at = excluded.measured_at
  where r.version <= excluded.version;
$$;

revoke execute on function public.cache_building_lidar(text, smallint, double precision, double precision, double precision, double precision, jsonb, jsonb)
  from public, anon;
grant execute on function public.cache_building_lidar(text, smallint, double precision, double precision, double precision, double precision, jsonb, jsonb)
  to authenticated;
