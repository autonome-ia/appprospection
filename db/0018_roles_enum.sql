-- Migration 0018 — chantier Équipe (09/08/2026) : deux nouveaux rôles.
--   * chef_ventes : mêmes vues ET mêmes pouvoirs terrain que le manager
--     (carte équipe, stats + drill-down, édition des points/RDV des autres),
--     mais NI gestion des comptes NI édition de l'objectif hebdo.
--   * secretaire  : agendas de toute l'équipe en LECTURE ; seule action =
--     ajouter des contacts (au nom d'un commercial) dans l'onglet Contacts.
-- Les pouvoirs réels sont câblés en RLS dans la 0019 — ce fichier ne fait
-- qu'étendre l'enum.
--
-- À exécuter dans le SQL Editor Supabase, SEUL (modèle 0013/0015/0017 :
-- ALTER TYPE ... ADD VALUE hors transaction avec tout usage de la valeur).
-- Exécuter 0019 APRÈS (elle utilise ces valeurs).

alter type public.user_role add value if not exists 'chef_ventes';
alter type public.user_role add value if not exists 'secretaire';
