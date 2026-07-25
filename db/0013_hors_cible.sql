-- Migration 0013 — nouveau statut « Hors cible » (décision chef des ventes,
-- 25/07/2026) : porte toquée mais pas notre cible (locataires, collectif…).
-- S'ajoute au type enum partagé par points.status et point_events.status.
--
-- NOTE : « Impossible » devient « Refus » à l'AFFICHAGE uniquement — la
-- valeur SQL `impossible` ne change pas (historique intact, zéro risque).
--
-- À exécuter dans le SQL Editor Supabase. ALTER TYPE ... ADD VALUE doit être
-- lancé SEUL (hors transaction avec d'autres ordres).

alter type public.point_status add value if not exists 'hors_cible';
