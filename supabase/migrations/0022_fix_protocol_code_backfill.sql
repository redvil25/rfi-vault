-- 0022_fix_protocol_code_backfill.sql
--
-- Repairs the protocol codes 0021 wrote.
--
-- The backfill in 0021 built the code as 'NN' || replace(imp_name, '-', ''), but
-- `imp_name` already starts with NN — the values are NN-1234. Every backfilled
-- row therefore came out as NNNN1234-9412 instead of NN1234-9412, and the codes
-- in the new dropdown did not match the shape `npm run seed` writes for a fresh
-- corpus. Found by counting the column after applying 0021 rather than by
-- trusting the migration: 130 rows, all of them wrong, `min` = NNNN1065-9412.
--
-- 0021 is applied and therefore not edited (CLAUDE.md §6, forward-only). A fresh
-- `supabase db reset` runs 0021 and then this, and lands on the same values a
-- reseed would produce.
--
-- Recomputed from `imp_name` rather than string-surgered from the broken value,
-- so this converges on the correct code whatever 0021 happened to write. The
-- four-digit serial is derived from the EU trial number, as before, so it is
-- stable across runs.

update trial
   set protocol_code =
         replace(imp_name, '-', '')
         || '-'
         || lpad((abs(hashtext(eu_trial_number)) % 10000)::text, 4, '0')
 where imp_name is not null
   and protocol_code is distinct from (
         replace(imp_name, '-', '')
         || '-'
         || lpad((abs(hashtext(eu_trial_number)) % 10000)::text, 4, '0')
       );

-- Trials with no IMP keep a null protocol code, deliberately.
--
-- These are the rows the ingestion path creates when a filed document references
-- an EU trial number the repository has not seen — they carry no product and the
-- document never stated a sponsor protocol code. Minting one would be inventing
-- a regulatory identifier, which is the one thing this system must not do
-- (CLAUDE.md §2.2). They are absent from the protocol code dropdown, and a
-- search filtered by protocol code will not return them. That is the honest
-- behaviour: the filter answers "which trial", and for these rows the answer is
-- not recorded.
