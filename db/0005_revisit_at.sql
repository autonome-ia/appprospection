-- =============================================================================
-- AppProspection — migration 0005 : date de relance sur un point
-- =============================================================================
-- Un « à revoir » sans date de relance est un lead perdu : le commercial fixe
-- « revoir le … » sur la fiche, l'Accueil liste les points à relancer.
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points add column if not exists revisit_at date;

create index if not exists points_revisit_idx
  on public.points (organization_id, revisit_at)
  where revisit_at is not null;

-- =============================================================================
-- FIN — migration 0005
-- =============================================================================
