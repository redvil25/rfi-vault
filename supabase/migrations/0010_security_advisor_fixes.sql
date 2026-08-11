-- 0010_security_advisor_fixes.sql
-- Clears every warning reported by the Supabase security advisors.

-- 1. Trigger functions had a role-mutable search_path (lint 0011). Neither
--    resolves an unqualified object, so an empty search_path is safe.
alter function public.touch_updated_at()     set search_path = '';
alter function public.block_audit_mutation() set search_path = '';

-- 2. current_team() was SECURITY DEFINER and callable over the REST API by both
--    anon and authenticated (lints 0028/0029). It only ever needs to read the
--    caller's own user_profile row, which the profile_self_read policy already
--    permits — so SECURITY INVOKER gives identical behaviour with no elevated
--    privilege to expose. EXECUTE cannot simply be revoked from `authenticated`
--    because RLS policy expressions are evaluated as the querying role.
create or replace function public.current_team() returns team_role
language sql stable security invoker set search_path = public as $$
  select team from user_profile where id = auth.uid();
$$;

-- 3. Extensions belong outside the API-exposed schema (lint 0014). Moving them
--    keeps existing type OIDs and the HNSW index valid, but any function that
--    pins search_path must now also include `extensions` to resolve the `vector`
--    type — see 0011.
alter extension vector  set schema extensions;
alter extension pg_trgm set schema extensions;
