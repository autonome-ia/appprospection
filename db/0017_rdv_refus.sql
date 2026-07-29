-- Migration 0017 — issue de RDV « Refus » (29/07/2026, refonte du parcours
-- d'issues avec briac) : le RDV a eu lieu et c'est non — la maison passe en
-- « Refus » sur la carte, symétrique de « Vendu » → « Client ».
-- Au passage : « Manqué » disparaît des BOUTONS (client absent = annulé, on
-- replanifie dans les deux cas) mais la valeur reste pour l'historique, et
-- « Effectué » devient « En attente » à l'affichage (libellé seul).
--
-- À exécuter dans le SQL Editor Supabase. ALTER TYPE ... ADD VALUE doit être
-- lancé SEUL (hors transaction avec d'autres ordres).

alter type public.appointment_status add value if not exists 'refus';
