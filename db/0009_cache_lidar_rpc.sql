-- =============================================================================
-- AppProspection — migration 0009 : cache LiDAR partagé (RPC security definer)
-- =============================================================================
-- La policy points_update_owner_or_manager empêche un commercial de persister
-- le backfill LiDAR sur le point d'un collègue : l'UPDATE touchait 0 ligne,
-- en silence, et la mesure (2-3 Mo de téléchargement + calcul) était refaite
-- à CHAQUE ouverture de la fiche, à chaque session, par chaque non-propriétaire.
--
-- Cette fonction n'écrit QUE les colonnes de cache toit_lidar_* (un calcul
-- déterministe et versionné, aucune donnée métier), pour n'importe quel point
-- de l'organisation de l'appelant — sans élargir la policy d'update générale.
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).
-- (Tant qu'elle n'est pas exécutée, l'app se replie sur l'update direct :
-- comportement d'avant, fonctionnel pour ses propres points.)

create or replace function public.cache_point_lidar(
  p_point_id     uuid,
  p_m2           real,
  p_principal_m2 real,
  p_pans         jsonb,
  p_statut       text,
  p_millesime    text,
  p_version      smallint
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
    toit_lidar_version      = p_version
  where id = p_point_id
    and organization_id = public.current_org_id()
    -- un client à jour ne doit pas être écrasé par un client resté sur une
    -- version antérieure de l'algo
    and coalesce(toit_lidar_version, 0) <= p_version
    and p_statut in ('ok', 'faible_confiance', 'grand_batiment', 'no_data', 'error');
$$;

revoke execute on function public.cache_point_lidar(uuid, real, real, jsonb, text, text, smallint)
  from public, anon;
grant execute on function public.cache_point_lidar(uuid, real, real, jsonb, text, text, smallint)
  to authenticated;

-- =============================================================================
-- FIN — migration 0009
-- =============================================================================
