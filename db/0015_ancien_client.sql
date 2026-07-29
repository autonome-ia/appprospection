-- Migration 0015 — nouveau statut « Ancien client » (demande de l'ami chef
-- des ventes, 29/07/2026) : maison où l'entreprise a déjà vendu AVANT la
-- prospection en cours — référence de rue (« vos voisins nous ont fait
-- confiance »), à ne pas re-démarcher comme un inconnu.
-- S'ajoute au type enum partagé par points.status et point_events.status.
--
-- Stats : une pose « ancien_client » compte une porte (comme hors_cible)
-- mais JAMAIS une vente (seul le statut vendu en compte une) — le tunnel
-- n'est pas faussé. Voir questions-ouvertes.md Q27/Q28 pour le reste.
--
-- À exécuter dans le SQL Editor Supabase. ALTER TYPE ... ADD VALUE doit être
-- lancé SEUL (hors transaction avec d'autres ordres).

alter type public.point_status add value if not exists 'ancien_client';
