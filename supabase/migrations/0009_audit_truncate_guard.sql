-- 0009_audit_truncate_guard.sql
--
-- Closes a real hole in 0005. Row-level BEFORE UPDATE / BEFORE DELETE triggers do
-- NOT fire on TRUNCATE, so the "append-only" audit trail could be erased entirely
-- by a single `truncate audit_events`. Verified against the live database before
-- and after this migration.
--
-- Immutability now covers all four mutation paths: UPDATE, DELETE, TRUNCATE, and
-- (by construction) there is no in-place edit path. Corrections are made by
-- appending compensating events. See ADR-007.

create trigger audit_no_truncate before truncate on audit_events
  for each statement execute function block_audit_mutation();
