-- Attributs BD TOPO complémentaires de la fiche maison (usage, logements,
-- étages, année d'apparition, état, construction légère, matériau des murs,
-- précision planimétrique) — déjà présents dans les réponses WFS, désormais
-- parsés (web/src/data/enrich.ts) et cachés comme le reste de la fiche.
-- ⚠ À exécuter dans Supabase AVANT de déployer : la colonne est dans le
-- SELECT global des points (data/points.ts), sans elle la carte ne charge plus.
alter table public.points
  add column if not exists maison_extra jsonb;
