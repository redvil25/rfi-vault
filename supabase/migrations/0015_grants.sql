-- 0015_grants.sql
--
-- Table privileges, so the schema is self-contained.
--
-- Found by building a database from these migrations alone and running the
-- seed against it: every write failed with "permission denied for table trial",
-- and `has_table_privilege('authenticated','rfi_consideration','SELECT')`
-- returned false. The application roles held only Dxtm — TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN — and none of SELECT, INSERT, UPDATE or DELETE.
--
-- The linked project works because its objects were created by `supabase_admin`
-- through the dashboard, whose default privileges grant the data verbs. Nothing
-- in this repository reproduced that, so `supabase db reset` produced a database
-- the application could not read. Same class of problem as ADR-016: the schema
-- was not fully described by its migrations.
--
-- A GRANT is not an access-control decision here. Row Level Security still
-- decides which rows any role may touch (0007, 0010, 0012); a missing GRANT
-- simply means the policies are never consulted at all.

-- ------------------------------------------------------------------ schema

grant usage on schema public to anon, authenticated, service_role;

-- ------------------------------------------------------- anon sees nothing
--
-- Every policy is scoped `to authenticated` on purpose — 0012 exists because
-- unauthenticated callers could once read the whole repository through the REST
-- API. Revoking at the privilege level as well means a future policy written
-- without a role clause cannot re-open that hole.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------- authenticated
--
-- Read everything, subject to RLS. Write only where a policy exists to govern
-- it: considerations (own team), audit events (append-only), and a user's own
-- draft application. Everything else is filed by the ingestion path, which runs
-- as service_role behind an application role gate (ADR-013).

grant select on all tables in schema public to authenticated;

grant insert, update on rfi_consideration  to authenticated;
grant insert           on audit_events     to authenticated;
grant insert           on draft_application to authenticated;
grant insert           on draft_section    to authenticated;

-- audit_events and ai_calls use bigserial.
grant usage, select on all sequences in schema public to authenticated;

-- The rate-limit window is reachable only through consume_rate_limit(), which is
-- SECURITY DEFINER. No role needs direct access to the table.
revoke all on rate_limit_hit from authenticated;

-- ------------------------------------------------------------ service_role
--
-- Bypasses RLS by design: seeding, ingestion, telemetry and admin scripts.

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- ------------------------------------------------------- future objects
--
-- So a later migration that adds a table does not silently ship without
-- privileges and fail the same way this one did.

alter default privileges in schema public
  grant select on tables to authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

alter default privileges in schema public
  grant all on sequences to service_role;
