-- =============================================================================
-- AppProspection — migration 0006 : fiche maison enrichie (open data)
-- =============================================================================
-- Données récupérées automatiquement à la pose d'un point (cache définitif) :
--   * BD TOPO IGN  : matériau de toiture (code fiscal dmatto) + altitudes toit
--                    -> surface de toit estimée (calcul client)
--   * BDNB (CSTB)  : année de construction + classe DPE
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points
  add column if not exists annee_construction smallint,
  add column if not exists mat_toit text,           -- code dmatto 2 caractères (ex. "20" = ardoise)
  add column if not exists toit_surface_m2 real,    -- estimation (emprise / cos(pente))
  add column if not exists dpe_classe text,         -- A..G
  add column if not exists enriched_at timestamptz; -- tentative d'enrichissement faite

-- =============================================================================
-- FIN — migration 0006
-- =============================================================================
