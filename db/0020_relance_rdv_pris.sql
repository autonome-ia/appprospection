-- 0020 — Relance d'un « RDV pris » (retour Alexis 12/08/2026, validé briac).
--
-- L'issue « En attente » ne bascule PLUS le point en « À revoir » : le point
-- garde son statut (un « RDV pris » reste bleu tant que le procès commercial
-- est ouvert), seule la relance J+7 est posée — et plus rien n'est journalisé
-- (un RDV honoré n'est pas une porte toquée : les portes mesurent la
-- prospection pure). Côté code : setAppointmentOutcome, fetchRelances,
-- fetchRevisits, filtre « À relancer » de la carte, fiche du point.
--
-- Cette migration répare l'EXISTANT : les points passés en « À revoir » par
-- un ancien « En attente » (repérables à leur RDV lié en statut 'effectue')
-- redeviennent « RDV pris », relance conservée. Le journal (point_events)
-- n'est PAS réécrit : les stats passées restent ce qu'elles étaient.
--
-- À exécuter dans l'éditeur SQL Supabase (prod ET agence de démo).

update public.points p
set status = 'rdv_pris'
where p.status = 'a_revoir'
  and exists (
    select 1
    from public.appointments a
    where a.point_id = p.id
      and a.status = 'effectue'
  );
