-- =============================================================================
-- 0032 : NUMBERS EN TEMPS RÉEL POUR TOUTE L'AGENCE (26/09/2026, demande briac)
--
-- Problème : le temps réel « postgres_changes » sur `sales` respecte la RLS.
-- Un commercial ne lit pas les ventes complètes de ses collègues (D9) : il ne
-- recevait donc AUCUN événement quand elles changeaient, et le tableau de
-- l'agence ne se mettait à jour qu'au retour dans l'app.
--
-- Solution : un SIGNAL par agence, SANS DONNÉE. À chaque écriture sur
-- `sales`, la base diffuse « sales_changed » sur le canal privé
-- `numbers:<organization_id>` ; chaque app recharge alors ses vues avec ses
-- propres droits (la vue sales_board pour l'équipe). Rien ne fuit : le
-- message ne contient que le type d'opération.
--
-- Canal PRIVÉ : seuls les membres Numbers de l'agence peuvent l'écouter
-- (policy sur realtime.messages). Une panne de Realtime ne bloque JAMAIS
-- une vente (exception avalée dans le trigger).
-- Rejouable. À exécuter dans le SQL Editor.
-- =============================================================================

create or replace function public.sales_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('op', tg_op),
      'sales_changed',
      'numbers:' || coalesce(new.organization_id, old.organization_id)::text,
      true
    );
  exception when others then
    -- Temps réel indisponible : la vente passe quand même.
    null;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sales_broadcast on public.sales;
create trigger sales_broadcast
  after insert or update or delete on public.sales
  for each row execute function public.sales_broadcast();

-- Lecture du canal privé : membres Numbers de SON agence uniquement.
drop policy if exists numbers_channel_read on realtime.messages;
create policy numbers_channel_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'numbers:' || public.current_org_id()::text
    and public.numbers_on()
  );

-- Contrôle : le trigger existe.
select tgname from pg_trigger where tgname = 'sales_broadcast';
