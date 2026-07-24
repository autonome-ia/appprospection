-- Date de la DERNIÈRE VISITE commerciale d'un point (pose ou changement de
-- statut). `updated_at` ne convient pas : il est bumpé par les écritures
-- techniques (cache enrichissement/LiDAR) — un point visité il y a 2 mois
-- dont on ouvre la fiche passerait pour « récent ». Sert au filtre carte
-- « ancienneté » (ex. les Absent de plus d'un mois, à revoir en priorité).
-- Backfill = date du dernier événement de visite (point_events).
-- ⚠ À exécuter dans Supabase AVANT de déployer (colonne dans le SELECT global).
alter table public.points
  add column if not exists visited_at timestamptz not null default now();

update public.points p
  set visited_at = coalesce(
    (select max(e.created_at) from public.point_events e where e.point_id = p.id),
    p.created_at);
