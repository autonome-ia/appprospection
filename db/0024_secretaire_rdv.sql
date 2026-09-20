-- 0024 — Secrétaire : prise et gestion des RDV AU NOM des commerciaux
-- (20/09/2026, retour Alexis via Caroline : « il lui faut un droit d'édition :
-- modifier les RDV si besoin et en créer »).
--
-- Matrice v2 secrétaire (l'idée directrice ne change pas : elle agit toujours
-- au nom d'un commercial, tout ce qu'elle écrit lui appartient, jamais de
-- geste terrain) :
--   * CRÉER un RDV pour un commercial choisi — déjà autorisé par
--     appts_insert_org (0019 : kind = 'rdv', titulaire membre de l'agence) ;
--   * MODIFIER un RDV « à venir » de l'agence (date, heure, adresse, tél.,
--     note, RÉATTRIBUTION à un autre commercial) et l'ANNULER (statut
--     `annule`) — jamais Vendu / En attente / Refus, jamais une tâche, jamais
--     de DELETE (annuler garde l'historique) ;
--   * LIER un RDV à un client déjà connu : le point passe « RDV pris » avec un
--     événement de journal au nom du COMMERCIAL — trois écritures (RDV, point,
--     journal) dans UNE transaction via book_rdv_for(), car la secrétaire n'a
--     aucun droit d'UPDATE sur points. La fonction sert aussi aux
--     superviseurs (même chemin, même contrôle) et au commercial pour lui-même.
--
-- À exécuter dans l'éditeur SQL Supabase (prod ; agence de test rlstest pour
-- rejouer le banc `node tools/rls-test/rls-test.mjs run`). Sans elle, les
-- nouveaux boutons de la secrétaire tombent sur « Modification refusée ».

-- =============================================================================
-- 1. UPDATE des RDV : la secrétaire décale / réattribue / annule un RDV
--    « à venir » de type RDV — et rien d'autre.
-- =============================================================================
drop policy if exists appts_update_owner_or_manager on public.appointments;
create policy appts_update_owner_or_manager on public.appointments
  for update using (
    organization_id = public.current_org_id()
    and (
      commercial_id = auth.uid()
      or created_by = auth.uid()
      or public.is_supervisor()
      or (public.is_secretaire() and kind = 'rdv' and status = 'a_venir')
    )
  )
  with check (
    organization_id = public.current_org_id()
    and (
      not public.is_secretaire()
      or (
        kind = 'rdv'
        and status in ('a_venir', 'annule')
        and commercial_id is not null
        and public.is_org_member(commercial_id)
      )
    )
  );

-- =============================================================================
-- 2. book_rdv_for : RDV lié à un point existant, en une transaction.
--    Qui : le titulaire lui-même, un superviseur, ou la secrétaire.
--    Effet : insert appointments (créé par l'appelant, AU NOM du titulaire) ;
--    si le point n'est pas déjà « RDV pris », il le devient (visited_at =
--    maintenant) et le journal reçoit `rdv_pris` signé du TITULAIRE (la porte
--    et le RDV comptent pour lui — même attribution que ContactForm) ; le nom
--    et le téléphone saisis remontent sur le point s'ils sont renseignés.
-- =============================================================================
create or replace function public.book_rdv_for(
  p_point_id uuid,
  p_commercial_id uuid,
  p_scheduled_at timestamptz,
  p_address text default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_point public.points%rowtype;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'Compte inactif';
  end if;
  if p_commercial_id is null or not exists (
    select 1 from public.profiles
    where id = p_commercial_id and organization_id = v_org and disabled_at is null
  ) then
    raise exception 'Titulaire hors agence';
  end if;
  if not (auth.uid() = p_commercial_id or public.is_supervisor() or public.is_secretaire()) then
    raise exception 'Prise de RDV au nom d''un collègue réservée aux superviseurs et à la secrétaire';
  end if;
  select * into v_point from public.points where id = p_point_id and organization_id = v_org;
  if not found then
    raise exception 'Point introuvable';
  end if;

  insert into public.appointments (
    organization_id, point_id, commercial_id, created_by, scheduled_at,
    address, client_name, client_phone, notes, status, kind
  ) values (
    v_org, p_point_id, p_commercial_id, auth.uid(), p_scheduled_at,
    coalesce(p_address, v_point.address),
    coalesce(p_client_name, v_point.client_name),
    coalesce(p_client_phone, v_point.client_phone),
    p_notes, 'a_venir', 'rdv'
  ) returning id into v_id;

  if v_point.status <> 'rdv_pris' then
    update public.points
      set status = 'rdv_pris',
          visited_at = now(),
          client_name = coalesce(p_client_name, client_name),
          client_phone = coalesce(p_client_phone, client_phone)
      where id = p_point_id;
    insert into public.point_events (organization_id, point_id, author_id, status, occurred_at)
      values (v_org, p_point_id, p_commercial_id, 'rdv_pris', now());
  elsif p_client_name is not null or p_client_phone is not null then
    update public.points
      set client_name = coalesce(p_client_name, client_name),
          client_phone = coalesce(p_client_phone, client_phone)
      where id = p_point_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.book_rdv_for(uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_rdv_for(uuid, uuid, timestamptz, text, text, text, text) to authenticated;

-- Contrôle : la policy et la fonction existent.
select polname from pg_policy where polrelid = 'public.appointments'::regclass and polname = 'appts_update_owner_or_manager';
select proname from pg_proc where proname = 'book_rdv_for';
