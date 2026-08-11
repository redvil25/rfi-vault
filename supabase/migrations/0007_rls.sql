-- 0007_rls.sql
-- Authorisation lives in the database. Approved knowledge is shared org-wide (that is
-- the entire product); work in progress stays with the owning team.
-- Roles map to the four groups named in the problem statement (docs/01-DOMAIN.md §7).

alter table rfi_consideration enable row level security;
alter table rfi_document      enable row level security;
alter table trial             enable row level security;
alter table draft_application enable row level security;
alter table draft_section     enable row level security;
alter table risk_assessment   enable row level security;
alter table audit_events      enable row level security;
alter table user_profile      enable row level security;

-- Helper: current user's team, marked stable so the planner caches it per statement.
create or replace function current_team() returns team_role
language sql stable security definer set search_path = public as $$
  select team from user_profile where id = auth.uid();
$$;

create policy profile_self_read on user_profile for select
  using (id = auth.uid());

-- Trials and documents are reference context; readable by any authenticated user.
create policy trial_read on trial for select
  using (auth.uid() is not null);
create policy document_read on rfi_document for select
  using (auth.uid() is not null);

-- The repository: approved and submitted responses are the shared corpus.
create policy read_shared_knowledge on rfi_consideration for select
  using (response_status in ('APPROVED','SUBMITTED'));

-- Work in progress is visible only to the owning team (and coordinators).
create policy read_own_team_wip on rfi_consideration for select
  using (
    response_status in ('DRAFT','IN_REVIEW')
    and (owner_team = current_team() or current_team() in ('ADMIN','CTA_MANAGEMENT'))
  );

create policy write_own_team on rfi_consideration for update
  using (owner_team = current_team() or current_team() in ('ADMIN','CTA_MANAGEMENT'));

create policy insert_own_team on rfi_consideration for insert
  with check (owner_team = current_team() or current_team() in ('ADMIN','CTA_MANAGEMENT'));

-- Draft applications: uploader's team plus coordinators.
create policy draft_read on draft_application for select
  using (uploaded_by = auth.uid() or current_team() in ('ADMIN','CTA_MANAGEMENT','EU_SUBMISSION_HUB'));
create policy draft_insert on draft_application for insert
  with check (uploaded_by = auth.uid());

create policy draft_section_read on draft_section for select
  using (exists (select 1 from draft_application d where d.id = draft_id));
create policy risk_read on risk_assessment for select
  using (exists (select 1 from draft_section s where s.id = draft_section_id));

-- Audit: own team's activity; coordinators and admins see everything.
create policy audit_read_own_team on audit_events for select
  using (actor_team = current_team() or current_team() in ('ADMIN','CTA_MANAGEMENT'));

create policy audit_insert on audit_events for insert
  with check (actor_id = auth.uid());
