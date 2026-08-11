-- 0005_workflow_audit.sql
-- Feature 5. Append-only audit trail enforced by the DATABASE, not by application
-- code (ADR-007). Corrections are made by appending compensating events.

create table user_profile (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  team         team_role not null,
  member_state text,
  created_at   timestamptz not null default now()
);

create table audit_events (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references auth.users(id),
  actor_team  team_role,
  entity_type text not null,      -- 'rfi_consideration' | 'draft_application' | ...
  entity_id   uuid not null,
  action      text not null,      -- INGESTED | DRAFTED | SUBMITTED_FOR_REVIEW | APPROVED | ...
  from_status text,
  to_status   text,
  reason      text,
  metadata    jsonb not null default '{}'
);

create index audit_entity on audit_events (entity_type, entity_id, occurred_at desc);
create index audit_actor  on audit_events (actor_team, occurred_at desc);

create or replace function block_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_no_update before update on audit_events
  for each row execute function block_audit_mutation();

create trigger audit_no_delete before delete on audit_events
  for each row execute function block_audit_mutation();
