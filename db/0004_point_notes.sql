-- =============================================================================
-- AppProspection — migration 0004 : journal de notes par maison (point_notes)
-- =============================================================================
-- Les notes ne s'écrasent plus : chaque note est une ligne horodatée avec son
-- auteur, attachée au point. Table SÉPARÉE de point_events pour ne pas fausser
-- les statistiques (chaque ligne de point_events compte comme une visite).
-- `points.notes` reste la DERNIÈRE note (dénormalisée : pastille carte, agenda).
-- À exécuter dans le SQL Editor du dashboard Supabase (projet xmrendifislsdlwytnlp).

create table public.point_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  point_id         uuid not null references public.points (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  body             text not null,
  created_at       timestamptz not null default now()
);
create index point_notes_point_idx on public.point_notes (point_id, created_at desc);
create index point_notes_org_idx   on public.point_notes (organization_id);

alter table public.point_notes enable row level security;

-- Lecture équipe ; on n'écrit que ses propres notes ; suppression auteur/manager.
create policy point_notes_select_org on public.point_notes
  for select using (organization_id = public.current_org_id());

create policy point_notes_insert_self on public.point_notes
  for insert with check (
    organization_id = public.current_org_id()
    and author_id = auth.uid()
  );

create policy point_notes_delete_author_or_manager on public.point_notes
  for delete using (
    organization_id = public.current_org_id()
    and (author_id = auth.uid() or public.is_manager())
  );

alter publication supabase_realtime add table public.point_notes;

-- Reprise de l'existant : les notes déjà posées deviennent la 1re ligne du journal.
insert into public.point_notes (organization_id, point_id, author_id, body, created_at)
select organization_id, id, created_by, notes, updated_at
from public.points
where notes is not null and notes <> '';

-- Les notes de RDV liées à un point rejoignent aussi le journal de la maison.
insert into public.point_notes (organization_id, point_id, author_id, body, created_at)
select organization_id, point_id, coalesce(commercial_id, created_by), notes, created_at
from public.appointments
where point_id is not null and notes is not null and notes <> '';

-- =============================================================================
-- FIN — migration 0004
-- =============================================================================
