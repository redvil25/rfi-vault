-- 0001_extensions.sql
-- pgvector for semantic search, pg_trgm for fuzzy identifier matching.

create extension if not exists vector;
create extension if not exists pg_trgm;
