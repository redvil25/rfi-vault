-- 0006_ai_calls.sql
-- Cost and latency telemetry for every model call. Feeds the "cost per RFI answered"
-- number on the Business Impact slide, and the prompt_hash gives audit traceability
-- of which prompt version produced which output.

create table ai_calls (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  purpose       text not null,   -- EMBED | EXTRACT | DRAFT | VERIFY | RERANK
  model         text not null,
  prompt_hash   text,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  cost_usd      numeric(10,6),
  success       boolean not null default true,
  error         text
);

create index ai_calls_purpose on ai_calls (purpose, occurred_at desc);
