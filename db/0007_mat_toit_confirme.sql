-- =============================================================================
-- AppProspection — migration 0007 : matériau de toiture confirmé sur le terrain
-- =============================================================================
-- La donnée fiscale (mat_toit, 5 catégories) sert d'a priori ; le commercial —
-- un professionnel de la toiture — peut la remplacer par le matériau exact
-- constaté sur place. Libellé libre choisi dans une liste métier.
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points add column if not exists mat_toit_confirme text;

-- =============================================================================
-- FIN — migration 0007
-- =============================================================================
