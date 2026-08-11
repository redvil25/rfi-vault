-- 0002_enums.sql
-- Domain vocabulary as database types. Terms match CTIS exactly (docs/01-DOMAIN.md).

create type submission_type as enum ('INITIAL','SUBSTANTIAL_MODIFICATION','ADDITIONAL_MS');
create type rfi_phase       as enum ('VALIDATION','ASSESSMENT_PART_I','ASSESSMENT_PART_II');
create type section_part    as enum ('PART_I','PART_II');
create type response_status as enum ('DRAFT','IN_REVIEW','APPROVED','SUBMITTED');
create type rfi_outcome     as enum ('ACCEPTED','FOLLOW_UP_RFI','UNKNOWN');
create type team_role       as enum ('RA_CLINICAL','AFFILIATE','CTA_MANAGEMENT','EU_SUBMISSION_HUB','ADMIN');
