-- =============================================================================
-- Migration 0002 — Agenda & Statistiques
-- À exécuter dans l'éditeur SQL Supabase APRÈS 0001 (schema.sql).
-- =============================================================================

-- Objectif hebdomadaire de RDV par commercial (fixé par le manager).
alter table public.profiles
  add column if not exists weekly_rdv_target integer not null default 10;

-- Le manager peut modifier les profils de son organisation (ex : objectifs).
-- (Politique additionnelle : elle s'ajoute à profiles_update_self en logique OR.)
drop policy if exists profiles_update_manager on public.profiles;
create policy profiles_update_manager on public.profiles
  for update using (
    organization_id = public.current_org_id() and public.is_manager()
  )
  with check (organization_id = public.current_org_id());

-- (Les tables appointments / point_events et le temps réel existent déjà en 0001.)
