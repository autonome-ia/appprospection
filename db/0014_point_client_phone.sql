-- =============================================================================
-- AppProspection — migration 0014 : téléphone du client sur un point
-- =============================================================================
-- Le « rappelez-moi, voilà mon 06 » d'un statut « à revoir » n'avait pas de
-- place et finissait (ou pas) dans une note libre : client_phone n'existait
-- que sur les RDV (appointments). Champ « Téléphone » dans la fiche point,
-- lien tel: dans l'en-tête et les relances de l'Accueil, synchronisé avec le
-- RDV comme client_name l'est déjà (audit UX B10).
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

alter table public.points add column if not exists client_phone text;

-- =============================================================================
-- FIN — migration 0014
-- =============================================================================
