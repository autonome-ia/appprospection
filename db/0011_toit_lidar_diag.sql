-- =============================================================================
-- AppProspection — migration 0011 : diagnostic de la mesure LiDAR
-- =============================================================================
-- Un `no_data` muet mélangeait des réalités très différentes (zone pas encore
-- survolée, canopée totale, maison plus récente que le survol…). La mesure
-- stocke désormais un petit jsonb de diagnostic : motif du verdict, part de
-- végétation haute sur l'emprise, secours classe 67, classification de la
-- dalle (IGN_AUTO_V5…) et date d'édition — la fiche explique au commercial
-- POURQUOI il n'y a pas de mesure, et si une re-mesure vaudra le coup.
-- ⚠ À exécuter dans Supabase AVANT de déployer (colonne dans le SELECT global).

alter table public.points
  add column if not exists toit_lidar_diag jsonb;

-- Le RPC de cache (0009) gagne le paramètre p_diag. L'ancienne signature est
-- supprimée (sinon PostgREST hésite entre les deux surcharges) ; le défaut
-- null garde les clients pas encore à jour fonctionnels.
drop function if exists public.cache_point_lidar(uuid, real, real, jsonb, text, text, smallint);

create or replace function public.cache_point_lidar(
  p_point_id     uuid,
  p_m2           real,
  p_principal_m2 real,
  p_pans         jsonb,
  p_statut       text,
  p_millesime    text,
  p_version      smallint,
  p_diag         jsonb default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.points set
    toit_lidar_m2           = p_m2,
    toit_lidar_principal_m2 = p_principal_m2,
    toit_lidar_pans         = p_pans,
    toit_lidar_statut       = p_statut,
    toit_lidar_millesime    = p_millesime,
    toit_lidar_version      = p_version,
    toit_lidar_diag         = p_diag
  where id = p_point_id
    and organization_id = public.current_org_id()
    and coalesce(toit_lidar_version, 0) <= p_version
    and p_statut in ('ok', 'faible_confiance', 'grand_batiment', 'no_data', 'error');
$$;

revoke execute on function public.cache_point_lidar(uuid, real, real, jsonb, text, text, smallint, jsonb)
  from public, anon;
grant execute on function public.cache_point_lidar(uuid, real, real, jsonb, text, text, smallint, jsonb)
  to authenticated;

-- =============================================================================
-- FIN — migration 0011
-- =============================================================================
