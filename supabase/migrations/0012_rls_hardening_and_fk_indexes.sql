-- 0012_rls_hardening_and_fk_indexes.sql
--
-- Three fixes in one pass.
--
-- 1. SECURITY: the policies in 0007 were not role-scoped, so they applied to
--    `anon` as well as `authenticated`. read_shared_knowledge had no auth.uid()
--    test, which meant an UNAUTHENTICATED caller could read every APPROVED or
--    SUBMITTED consideration through the REST API. Every policy is now
--    explicitly `to authenticated`. Found by reviewing pg_policies.roles after
--    the advisors came back clean — the linter does not flag this.
--
-- 2. PERFORMANCE (lint 0003, auth_rls_initplan): auth.uid() and current_team()
--    were re-evaluated once per row. Wrapping each in a scalar subquery turns
--    them into an InitPlan, evaluated once per statement.
--
-- 3. PERFORMANCE (lint 0006, multiple_permissive_policies): rfi_consideration
--    had two permissive SELECT policies, both evaluated on every query. Merged
--    into one with an OR. Same semantics, half the policy evaluations.

drop policy if exists read_shared_knowledge on rfi_consideration;
drop policy if exists read_own_team_wip     on rfi_consideration;
drop policy if exists write_own_team        on rfi_consideration;
drop policy if exists insert_own_team       on rfi_consideration;
drop policy if exists profile_self_read     on user_profile;
drop policy if exists trial_read            on trial;
drop policy if exists document_read         on rfi_document;
drop policy if exists embedding_read        on rfi_embedding;
drop policy if exists draft_read            on draft_application;
drop policy if exists draft_insert          on draft_application;
drop policy if exists draft_section_read    on draft_section;
drop policy if exists risk_read             on risk_assessment;
drop policy if exists audit_read_own_team   on audit_events;
drop policy if exists audit_insert          on audit_events;
drop policy if exists ai_calls_read         on ai_calls;

create policy profile_self_read on user_profile for select to authenticated
  using (id = (select auth.uid()));

create policy trial_read     on trial         for select to authenticated using (true);
create policy document_read  on rfi_document  for select to authenticated using (true);
create policy embedding_read on rfi_embedding for select to authenticated using (true);

-- Shared approved knowledge OR own-team work in progress, in one policy.
create policy read_repository on rfi_consideration for select to authenticated
  using (
    response_status in ('APPROVED','SUBMITTED')
    or (select current_team()) in ('ADMIN','CTA_MANAGEMENT')
    or owner_team = (select current_team())
  );

create policy write_own_team on rfi_consideration for update to authenticated
  using (owner_team = (select current_team())
         or (select current_team()) in ('ADMIN','CTA_MANAGEMENT'));

create policy insert_own_team on rfi_consideration for insert to authenticated
  with check (owner_team = (select current_team())
              or (select current_team()) in ('ADMIN','CTA_MANAGEMENT'));

create policy draft_read on draft_application for select to authenticated
  using (uploaded_by = (select auth.uid())
         or (select current_team()) in ('ADMIN','CTA_MANAGEMENT','EU_SUBMISSION_HUB'));

create policy draft_insert on draft_application for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

create policy draft_section_read on draft_section for select to authenticated
  using (exists (select 1 from draft_application d where d.id = draft_id));

create policy risk_read on risk_assessment for select to authenticated
  using (exists (select 1 from draft_section s where s.id = draft_section_id));

create policy audit_read_own_team on audit_events for select to authenticated
  using (actor_team = (select current_team())
         or (select current_team()) in ('ADMIN','CTA_MANAGEMENT'));

create policy audit_insert on audit_events for insert to authenticated
  with check (actor_id = (select auth.uid()));

create policy ai_calls_read on ai_calls for select to authenticated
  using ((select current_team()) in ('ADMIN','CTA_MANAGEMENT'));

-- Covering indexes for foreign keys (lint 0001).
create index audit_events_actor_id_idx         on audit_events (actor_id);
create index draft_application_trial_id_idx    on draft_application (trial_id);
create index draft_application_uploaded_by_idx on draft_application (uploaded_by);
create index rfi_consideration_trial_id_idx    on rfi_consideration (trial_id);
create index rfi_document_trial_id_idx         on rfi_document (trial_id);
