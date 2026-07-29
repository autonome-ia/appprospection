-- Migration 0016 — tâches d'agenda (demande de l'ami chef des ventes,
-- 29/07/2026) : entrées libres du planning — « aller chercher l'acompte »,
-- « récupérer le panneau publicitaire » — datées, avec adresse/client/note,
-- SANS point sur la carte (point_id, déjà nullable, reste vide).
--
-- Même table que les RDV : toute la mécanique de l'agenda (mois, temps réel,
-- « Mes RDV », édition, couleur = commercial) est partagée. La colonne
-- `kind` distingue les deux ; les tâches sont EXCLUES des stats (tunnel
-- « RDV effectués », compteurs de l'Accueil) côté client.
--
-- text + check plutôt qu'un enum : pas de contrainte ALTER TYPE hors
-- transaction, et deux valeurs suffisent.
--
-- À exécuter dans le SQL Editor Supabase.

alter table public.appointments
  add column if not exists kind text not null default 'rdv'
  check (kind in ('rdv', 'tache'));
