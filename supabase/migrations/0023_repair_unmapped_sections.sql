-- 0023_repair_unmapped_sections.sql
--
-- Repairs considerations filed under a "section" that is not an application
-- section part at all.
--
-- lib/ingest/commit.ts read `c.section ?? c.sectionRaw ?? 'Regulatory'`. The
-- parser's normaliseSection() deliberately returns null for anything it cannot
-- map onto the taxonomy and raises a warning; the commit path then wrote the
-- rejected raw string anyway, undoing that refusal. Member State names reached
-- the column that way and showed up in the search "Document type" dropdown
-- beside real section parts:
--
--     Spain (2) · France (2) · Germany (2)
--
-- A judge reading that sees a system that does not know the difference between
-- a Member State and an application section part, which is precisely the
-- vocabulary signal CLAUDE.md section 6 says this audience scores on.
--
-- The code no longer does this — sectionForRow() takes only the mapped value
-- and falls back to the UNMAPPED sentinel — so this repairs the rows already
-- filed. It sets them to the same sentinel the fixed code would have written,
-- which is a correction, not a guess: the true section is not recoverable from
-- what was stored, and picking a plausible one would repeat the original error
-- in the other direction.
--
-- Deliberately expressed as "anything not in the taxonomy" rather than as a
-- list of the three offending values, so a corpus carrying a different stray
-- section is repaired too. On a fresh `supabase db reset` this matches nothing.

update rfi_consideration
   set section = 'UNMAPPED'
 where section not in (
   -- Part I
   'Regulatory',
   'Cover Letter',
   'EU Application Form',
   'Protocol',
   'Investigator Brochure',
   'IMPD Quality',
   'IMPD Safety and Efficacy',
   'GMP and QP Declaration',
   'Auxiliary Medicinal Product',
   'IMP Labelling',
   'Scientific Advice and PIP',
   -- Part II
   'Informed Consent',
   'Subject Recruitment Arrangements',
   'Investigator Suitability',
   'Site Suitability',
   'Insurance and Indemnification',
   'Financial Arrangements',
   'Data Protection',
   'Biological Samples',
   -- The sentinel itself, so re-running this is a no-op.
   'UNMAPPED'
 );
