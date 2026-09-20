-- 0023 — manager visible ou non dans les stats de l'équipe (20/09/2026,
-- demande briac après échange avec le manager de Brest).
--
-- Par défaut, un MANAGER n'apparaît pas dans l'onglet Stats des chefs des
-- ventes et des commerciaux (ni ligne de classement, ni drill-down) — mais
-- son activité COMPTE toujours dans les totaux de l'équipe (tunnel, portes,
-- objectif équipe). Chaque manager peut cocher « M'afficher dans les stats
-- de l'équipe » dans l'écran Équipe (Accueil → Profil & réglages → Équipe) :
-- futur SaaS multi-agences, certains managers voudront figurer au classement.
-- Le manager, lui, voit toujours toute l'équipe, lui compris.
--
-- Colonne libre (non gardée par profiles_guard) : chacun édite la sienne via
-- profiles_update_self ; sans effet pour un non-manager (l'app ne lit le
-- drapeau que pour le rôle manager).
--
-- À exécuter dans l'éditeur SQL Supabase (prod ; démo optionnelle — le code
-- se replie proprement tant que la colonne n'existe pas : tous masqués).

alter table public.profiles
  add column if not exists stats_visible boolean not null default false;

-- Contrôle.
select full_name, role, stats_visible from public.profiles where role = 'manager';
