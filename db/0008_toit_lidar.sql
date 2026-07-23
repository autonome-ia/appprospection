-- =============================================================================
-- AppProspection — migration 0008 : surface de toiture mesurée (LiDAR HD IGN)
-- =============================================================================
-- Mesure calculée dans le navigateur depuis le nuage de points LiDAR HD
-- (open data IGN, streaming COPC) puis mise en cache définitif sur le point.
-- Réf. docs/sop-mesure-toiture-lidar.md (phases 0/1 + gates G1 passés).
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points
  add column if not exists toit_lidar_m2 real,            -- surface totale mesurée (tous pans)
  add column if not exists toit_lidar_principal_m2 real,  -- toit principal seul (donnée couvreur)
  add column if not exists toit_lidar_pans jsonb,         -- [{type, pente_deg, azimut_deg, m2}]
  add column if not exists toit_lidar_statut text,        -- ok | faible_confiance | grand_batiment | no_data | error
  add column if not exists toit_lidar_millesime text,     -- date d'acquisition du survol LiDAR (fraîcheur)
  add column if not exists toit_lidar_version smallint;   -- version de l'algo : un recalibrage
                                                          -- (post-Gate G0) incrémente la version
                                                          -- et re-mesure paresseusement les points

-- =============================================================================
-- FIN — migration 0008
-- =============================================================================
