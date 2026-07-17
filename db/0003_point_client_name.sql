-- =============================================================================
-- AppProspection — migration 0003 : nom du client sur un point
-- =============================================================================
-- Le commercial doit pouvoir attacher un nom de client à une maison (point),
-- pas seulement à un RDV : « à revoir — M. Martin », « vendu — Mme Le Goff ».
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points add column if not exists client_name text;

-- =============================================================================
-- FIN — migration 0003
-- =============================================================================
