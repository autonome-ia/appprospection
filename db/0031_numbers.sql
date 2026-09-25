-- =============================================================================
-- 0031 : NUMBERS (ventes, CA, commissions, objectifs de CA)
-- Chantier Numbers, étape N1 (docs/plan-numbers.md §1-2), 25/09/2026.
--
-- Numérotation : 0027 à 0030 sont écrites sur la branche `site` (non
-- exécutées) ; Numbers part de 0031 pour que les deux branches fusionnent
-- sans collision.
--
-- Migration ADDITIVE : aucune table existante ne change de comportement.
-- L'app de prod ne lit pas ces tables ; tout est fermé tant que l'option
-- n'est pas activée sur l'agence (numbers_activate, SQL uniquement).
-- Rejouable (if not exists / create or replace).
--
-- À exécuter dans le SQL Editor, puis activer l'option sur l'agence de DÉMO
-- et sur l'agence du banc RLS (voir fin de fichier), puis :
--   node tools/rls-test/rls-test.mjs run
-- =============================================================================

-- 1. OPTION PAR AGENCE ---------------------------------------------------------
-- organizations_logo_guard (db/0025) refuse déjà toute modification client
-- d'une autre colonne que logo_url : l'option ne se pose qu'en SQL (D12).
alter table public.organizations
  add column if not exists numbers_enabled boolean not null default false;

-- 2. TYPES ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sale_prestation') then
    create type public.sale_prestation as enum
      ('toiture', 'facade', 'isolation', 'traitement_bois', 'gouttiere', 'energie');
  end if;
  if not exists (select 1 from pg_type where typname = 'sale_origin') then
    create type public.sale_origin as enum ('prospection', 'lead_entrant', 'ancien_client');
  end if;
  if not exists (select 1 from pg_type where typname = 'sale_payment') then
    create type public.sale_payment as enum ('comptant', 'financement');
  end if;
  if not exists (select 1 from pg_type where typname = 'sale_status') then
    create type public.sale_status as enum ('active', 'annulee');
  end if;
end $$;

-- 3. PROFILS : objectif de CA mensuel (D17) + droit de modification du chef
--    des ventes (D8). Gardés par profiles_numbers_guard (§6) : manager seul.
alter table public.profiles
  add column if not exists monthly_ca_target numeric(12, 2) not null default 0,
  add column if not exists can_edit_sales boolean not null default false;

-- 4. TABLES --------------------------------------------------------------------

-- Taux par défaut de l'agence, une ligne par prestation (0.13 = 13 %).
create table if not exists public.commission_rates (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  prestation      public.sale_prestation not null,
  rate            numeric(5, 4) not null check (rate between 0 and 1),
  primary key (organization_id, prestation)
);

-- Surcharges du manager, par commercial et par prestation (D7).
create table if not exists public.profile_commission_rates (
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  prestation      public.sale_prestation not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rate            numeric(5, 4) not null check (rate between 0 and 1),
  primary key (profile_id, prestation)
);

-- Les ventes. Deux colonnes vendeurs : « 2 maximum » garanti par la
-- structure, 50/50 déduit (seller2_id renseigné = moitié chacun, D4).
-- Champs métier nullables : une vente née d'un « Vendu » existe AVANT que
-- le commercial remplisse le formulaire (« à compléter », D11).
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sold_on         date not null default current_date,
  client_name     text,
  address         text,
  note            text,
  origin          public.sale_origin,
  prestation      public.sale_prestation,
  amount_ht       numeric(12, 2) check (amount_ht >= 0),
  payment         public.sale_payment,
  financed_ht     numeric(12, 2) check (financed_ht >= 0),
  seller1_id      uuid not null references public.profiles (id),
  seller2_id      uuid references public.profiles (id),
  -- Taux FIGÉS le jour de la vente (trigger sales_rates) : changer un taux
  -- ne réécrit jamais une commission acquise (D7).
  rate1           numeric(5, 4),
  rate2           numeric(5, 4),
  status          public.sale_status not null default 'active',
  cancelled_at    timestamptz,
  point_id        uuid references public.points (id) on delete set null,
  event_id        uuid unique references public.point_events (id) on delete set null,
  appointment_id  uuid unique references public.appointments (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint sales_two_sellers check (seller2_id is null or seller2_id <> seller1_id),
  constraint sales_financed_le_amount
    check (financed_ht is null or amount_ht is null or financed_ht <= amount_ht)
);
create index if not exists sales_org_date_idx on public.sales (organization_id, sold_on);
create index if not exists sales_seller1_idx on public.sales (seller1_id, sold_on);
create index if not exists sales_seller2_idx on public.sales (seller2_id, sold_on);
create index if not exists sales_point_idx on public.sales (point_id);

-- 5. HELPERS RLS (même style que db/0019) --------------------------------------

-- « J'ai accès à Numbers » : agence avec l'option, compte actif, pas secrétaire.
create or replace function public.numbers_on()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.id = auth.uid() and p.disabled_at is null
      and p.role <> 'secretaire' and o.numbers_enabled
  );
$$;

-- Modifier TOUTES les ventes : manager, ou chef des ventes autorisé (D8).
create or replace function public.can_edit_all_sales()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and disabled_at is null
      and (role = 'manager' or (role = 'chef_ventes' and can_edit_sales))
  );
$$;

-- Vendeur possible : membre actif de MON agence, pas secrétaire.
create or replace function public.is_org_seller(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = uid and organization_id = public.current_org_id()
      and disabled_at is null and role <> 'secretaire'
  );
$$;

-- Taux applicable aujourd'hui : surcharge du vendeur, sinon défaut agence.
create or replace function public.commission_rate_for(p_profile uuid, p_prestation public.sale_prestation)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rate from public.profile_commission_rates
      where profile_id = p_profile and prestation = p_prestation),
    (select c.rate from public.commission_rates c
      join public.profiles p on p.organization_id = c.organization_id
      where p.id = p_profile and c.prestation = p_prestation)
  );
$$;

-- 6. GARDE-FOUS ----------------------------------------------------------------
-- auth.uid() null = SQL Editor / service_role : tout est permis (support).

-- 6.1 Colonnes Numbers des profils : manager seul. Trigger SÉPARÉ de
--     profiles_guard (la branche site le réécrit : pas de conflit de fusion).
create or replace function public.profiles_numbers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.monthly_ca_target is distinct from old.monthly_ca_target
      or new.can_edit_sales is distinct from old.can_edit_sales)
     and not public.is_manager() then
    raise exception 'Modification réservée au manager';
  end if;
  if new.monthly_ca_target < 0 then
    raise exception 'Objectif de CA négatif';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_numbers_guard on public.profiles;
create trigger profiles_numbers_guard
  before update on public.profiles
  for each row execute function public.profiles_numbers_guard();

-- 6.2 Ventes : champs posés par la base, liens immuables, vendeurs valides,
--     réactivation réservée au manager.
create or replace function public.sales_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.organization_id := public.current_org_id();
      new.created_by := auth.uid();
      new.status := 'active';
      new.cancelled_at := null;
    end if;
    new.created_at := now();
  else
    if auth.uid() is not null then
      if new.organization_id is distinct from old.organization_id
         or new.created_by is distinct from old.created_by
         or new.created_at is distinct from old.created_at
         or new.point_id is distinct from old.point_id
         or new.event_id is distinct from old.event_id
         or (old.appointment_id is not null
             and new.appointment_id is distinct from old.appointment_id) then
        raise exception 'Champ de vente non modifiable';
      end if;
      if old.status = 'annulee' and new.status = 'active' and not public.is_manager() then
        raise exception 'Seul le manager peut réactiver une vente annulée';
      end if;
    end if;
    if new.status is distinct from old.status then
      new.cancelled_at := case when new.status = 'annulee' then now() else null end;
    end if;
  end if;

  if auth.uid() is not null then
    if not public.is_org_seller(new.seller1_id)
       or (new.seller2_id is not null and not public.is_org_seller(new.seller2_id)) then
      raise exception 'Vendeur inconnu dans l''agence';
    end if;
  end if;

  -- Un financement sans montant financé est à compléter ; un comptant n'a
  -- jamais de montant financé.
  if new.payment = 'comptant' then
    new.financed_ht := null;
  end if;

  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_guard on public.sales;
create trigger sales_guard
  before insert or update on public.sales
  for each row execute function public.sales_guard();

-- 6.3 Taux figés (D7). Posés à la création, et recalculés UNIQUEMENT quand
--     la prestation ou le vendeur concerné change (ou si le taux manque :
--     vente « à compléter » dont on renseigne enfin la prestation). Personne
--     n'écrit un taux à la main, sauf le manager (correction exceptionnelle,
--     prestation et vendeurs inchangés).
create or replace function public.sales_rates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_manual boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_manual := (auth.uid() is null or public.is_manager())
      and new.prestation is not distinct from old.prestation
      and new.seller1_id is not distinct from old.seller1_id
      and new.seller2_id is not distinct from old.seller2_id
      and (new.rate1 is distinct from old.rate1 or new.rate2 is distinct from old.rate2);
    if v_manual then
      return new;
    end if;
    -- Pas de réécriture en douce par un non-manager.
    new.rate1 := old.rate1;
    new.rate2 := old.rate2;
  end if;

  if new.prestation is null then
    new.rate1 := null;
    new.rate2 := null;
    return new;
  end if;

  if tg_op = 'INSERT' or new.prestation is distinct from old.prestation
     or new.seller1_id is distinct from old.seller1_id or new.rate1 is null then
    new.rate1 := public.commission_rate_for(new.seller1_id, new.prestation);
  end if;
  if new.seller2_id is null then
    new.rate2 := null;
  elsif tg_op = 'INSERT' or new.prestation is distinct from old.prestation
     or new.seller2_id is distinct from old.seller2_id or new.rate2 is null then
    new.rate2 := public.commission_rate_for(new.seller2_id, new.prestation);
  end if;
  return new;
end;
$$;

-- Ordre alphabétique des triggers BEFORE : sales_guard puis sales_rates.
drop trigger if exists sales_rates on public.sales;
create trigger sales_rates
  before insert or update on public.sales
  for each row execute function public.sales_rates();

-- 6.4 Annulation (D16) : une vente annulée n'existe plus NULLE PART.
--     Point → « Refus » ; l'événement « vendu » lié est réécrit en
--     « impossible » (la porte reste comptée, la vente sort du tunnel, AUCUN
--     nouvel événement : sinon la porte compterait deux fois) ; le RDV lié
--     « Vendu » → « Refus » (RDV tenu, plus une vente). Réactivation (manager)
--     = chemin inverse.
create or replace function public.sales_cancel_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'annulee' then
    if new.point_id is not null then
      update public.points
        set status = 'impossible', revisit_at = null, visited_at = now()
        where id = new.point_id and status in ('vendu', 'ancien_client');
    end if;
    if new.event_id is not null then
      update public.point_events set status = 'impossible'
        where id = new.event_id and status = 'vendu';
    end if;
    if new.appointment_id is not null then
      update public.appointments set status = 'refus'
        where id = new.appointment_id and status = 'vendu';
    end if;
  else
    if new.point_id is not null then
      update public.points
        set status = 'vendu', revisit_at = null, visited_at = now()
        where id = new.point_id and status = 'impossible';
    end if;
    if new.event_id is not null then
      update public.point_events set status = 'vendu'
        where id = new.event_id and status = 'impossible';
    end if;
    if new.appointment_id is not null then
      update public.appointments set status = 'vendu'
        where id = new.appointment_id and status = 'refus';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_cancel_sync on public.sales;
create trigger sales_cancel_sync
  after update of status on public.sales
  for each row execute function public.sales_cancel_sync();

-- 7. RLS -----------------------------------------------------------------------
alter table public.commission_rates enable row level security;
alter table public.profile_commission_rates enable row level security;
alter table public.sales enable row level security;

-- 7.1 Taux de l'agence : lus par tout membre Numbers, écrits par le manager.
drop policy if exists rates_select on public.commission_rates;
create policy rates_select on public.commission_rates
  for select using (organization_id = public.current_org_id() and public.numbers_on());

drop policy if exists rates_write_manager on public.commission_rates;
create policy rates_write_manager on public.commission_rates
  for all using (
    organization_id = public.current_org_id() and public.numbers_on() and public.is_manager()
  )
  with check (
    organization_id = public.current_org_id() and public.numbers_on() and public.is_manager()
  );

-- 7.2 Surcharges : chacun lit les siennes, le superviseur toutes (les
--     commissions des autres ne sont pas estimables sans elles).
drop policy if exists profile_rates_select on public.profile_commission_rates;
create policy profile_rates_select on public.profile_commission_rates
  for select using (
    organization_id = public.current_org_id() and public.numbers_on()
    and (profile_id = auth.uid() or public.is_supervisor())
  );

drop policy if exists profile_rates_write_manager on public.profile_commission_rates;
create policy profile_rates_write_manager on public.profile_commission_rates
  for all using (
    organization_id = public.current_org_id() and public.numbers_on() and public.is_manager()
  )
  with check (
    organization_id = public.current_org_id() and public.numbers_on() and public.is_manager()
    and public.is_org_seller(profile_id)
  );

-- 7.3 Ventes (ligne COMPLÈTE : client, adresse, note, taux) : les vendeurs
--     de la vente et les superviseurs. Le reste de l'équipe passe par la
--     vue sales_board (§8), sans ces colonnes (D9).
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select using (
    organization_id = public.current_org_id() and public.numbers_on()
    and (auth.uid() in (seller1_id, seller2_id) or public.is_supervisor())
  );

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
  for insert with check (
    organization_id = public.current_org_id() and public.numbers_on()
    and (auth.uid() in (seller1_id, seller2_id) or public.can_edit_all_sales())
  );

-- Un vendeur modifie SA vente et doit en rester vendeur (il ne peut pas la
-- « donner » en entier à un autre) ; manager / chef autorisé : tout.
drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales
  for update using (
    organization_id = public.current_org_id() and public.numbers_on()
    and (auth.uid() in (seller1_id, seller2_id) or public.can_edit_all_sales())
  )
  with check (
    organization_id = public.current_org_id() and public.numbers_on()
    and (auth.uid() in (seller1_id, seller2_id) or public.can_edit_all_sales())
  );

-- La voie normale est l'annulation ; la suppression est un geste de manager.
drop policy if exists sales_delete_manager on public.sales;
create policy sales_delete_manager on public.sales
  for delete using (
    organization_id = public.current_org_id() and public.numbers_on() and public.is_manager()
  );

-- 8. VUE « TABLEAU DE L'AGENCE » ------------------------------------------------
-- Droits du propriétaire (pas security_invoker) : elle contourne la RLS de
-- sales, d'où le filtre explicite agence + option. Ni client, ni adresse,
-- ni note, ni taux : c'est ce qui rend D9 vrai EN BASE.
create or replace view public.sales_board as
  select s.id, s.organization_id, s.sold_on, s.prestation, s.amount_ht,
         s.payment, s.financed_ht, s.seller1_id, s.seller2_id, s.status,
         s.created_at
  from public.sales s
  where s.organization_id = public.current_org_id() and public.numbers_on();

revoke all on public.sales_board from anon;
grant select on public.sales_board to authenticated;

-- 9. RPC : LA VENTE NÉE D'UN « VENDU » -----------------------------------------
-- Appelée par l'app juste après un « Vendu » (issue de RDV ou bascule
-- manuelle) : retrouve l'événement « vendu » du point et crée la vente « à
-- compléter » (vendeur = auteur de l'événement, c.-à-d. le titulaire du RDV
-- ou le propriétaire du point — même attribution que db/0021 ; date = jour
-- de l'événement ; client et adresse du point) — ou renvoie la vente qui
-- existe déjà (anti-doublon : double tap, popup + agenda…).
create or replace function public.ensure_vendu_sale(p_point uuid, p_appointment uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.current_org_id();
  v_point   public.points;
  v_event   public.point_events;
  v_appt    public.appointments;
  v_seller  uuid;
  v_sale    uuid;
begin
  if not public.numbers_on() then
    return null; -- option absente : rien à faire (l'app ne l'appelle pas)
  end if;

  select * into v_point from public.points where id = p_point and organization_id = v_org;
  if not found then
    raise exception 'Point introuvable';
  end if;

  if p_appointment is not null then
    select * into v_appt from public.appointments
      where id = p_appointment and organization_id = v_org;
    select id into v_sale from public.sales where appointment_id = p_appointment;
    if v_sale is not null then
      return v_sale;
    end if;
  end if;

  select * into v_event from public.point_events
    where point_id = p_point and organization_id = v_org and status = 'vendu'
    order by occurred_at desc limit 1;

  if v_event.id is not null then
    select id into v_sale from public.sales where event_id = v_event.id;
    if v_sale is not null then
      if p_appointment is not null then
        update public.sales set appointment_id = p_appointment
          where id = v_sale and appointment_id is null;
      end if;
      return v_sale;
    end if;
  end if;

  v_seller := coalesce(v_event.author_id, v_appt.commercial_id, v_point.created_by);
  if v_seller is null or not public.is_org_seller(v_seller) then
    raise exception 'Vendeur introuvable pour cette vente';
  end if;
  -- Le geste « Vendu » est celui du vendeur ou d'un superviseur (qui solde
  -- le RDV d'un commercial) : personne d'autre ne crée de vente au nom d'un
  -- collègue par cette porte.
  if v_seller <> auth.uid() and not public.is_supervisor() then
    raise exception 'Vente d''un autre commercial';
  end if;

  insert into public.sales (
    organization_id, sold_on, client_name, address, seller1_id,
    point_id, event_id, appointment_id
  ) values (
    v_org,
    coalesce((v_event.occurred_at at time zone 'Europe/Paris')::date,
             (now() at time zone 'Europe/Paris')::date),
    coalesce(v_appt.client_name, v_point.client_name),
    coalesce(v_appt.address, v_point.address),
    v_seller, p_point, v_event.id, p_appointment
  )
  returning id into v_sale;
  return v_sale;
end;
$$;

revoke all on function public.ensure_vendu_sale(uuid, uuid) from anon;
grant execute on function public.ensure_vendu_sale(uuid, uuid) to authenticated;

-- 10. ACTIVATION (support, SQL uniquement) -------------------------------------
-- Active l'option, amorce les 6 taux par défaut (D7, D15) et crée une vente
-- « à compléter » pour chaque vente déjà journalisée (D11). Rejouable.
create or replace function public.numbers_activate(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ev   record;
  v_appt uuid;
  v_n    integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Activation réservée au support (SQL Editor)';
  end if;

  update public.organizations set numbers_enabled = true where id = p_org;

  insert into public.commission_rates (organization_id, prestation, rate) values
    (p_org, 'toiture', 0.13), (p_org, 'facade', 0.13), (p_org, 'isolation', 0.13),
    (p_org, 'traitement_bois', 0.13), (p_org, 'gouttiere', 0.08), (p_org, 'energie', 0.05)
  on conflict do nothing;

  for v_ev in
    select e.id, e.point_id, e.author_id, e.occurred_at, p.client_name, p.address
    from public.point_events e
    join public.points p on p.id = e.point_id
    join public.profiles pr on pr.id = e.author_id
    where e.organization_id = p_org and e.status = 'vendu'
      and pr.role <> 'secretaire'
      and not exists (select 1 from public.sales s where s.event_id = e.id)
    order by e.occurred_at
  loop
    -- Le RDV « Vendu » du même point, s'il n'est lié à aucune vente.
    select a.id into v_appt from public.appointments a
      where a.point_id = v_ev.point_id and a.status = 'vendu'
        and not exists (select 1 from public.sales s where s.appointment_id = a.id)
      order by abs(extract(epoch from a.scheduled_at - v_ev.occurred_at))
      limit 1;

    insert into public.sales (
      organization_id, sold_on, client_name, address, seller1_id,
      point_id, event_id, appointment_id
    ) values (
      p_org, (v_ev.occurred_at at time zone 'Europe/Paris')::date,
      v_ev.client_name, v_ev.address, v_ev.author_id,
      v_ev.point_id, v_ev.id, v_appt
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.numbers_activate(uuid) from anon, authenticated;

-- 11. TEMPS RÉEL : une correction du manager se voit tout de suite chez le
--     vendeur (exigence Alexis). La vue n'émet rien : l'app écoute la table.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales'
  ) then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;

-- =============================================================================
-- ACTIVATION (après la migration, dans le SQL Editor) :
--   select o.name, public.numbers_activate(o.id) as ventes_a_completer
--   from public.organizations o
--   where o.name in ('<agence de démo>', 'RLS Test — jetable');
-- Mister Toiture Brest : SEULEMENT à la mise en prod (étape N10, feu vert briac).
-- Désactiver : update public.organizations set numbers_enabled = false where id = '…';
-- =============================================================================
