-- Agentic workflow run metadata.
-- Keeps run logs + simulated quote/debit fields when persisted.

alter table public.query_workflow_runs
  add column if not exists logs jsonb not null default '[]'::jsonb;

alter table public.query_workflow_runs
  add column if not exists quote_total_usd_cents integer not null default 0;

alter table public.query_workflow_runs
  add column if not exists tips_usd_cents integer not null default 0;

alter table public.query_workflow_runs
  add column if not exists ledger_debit_id text;

alter table public.query_workflow_runs
  drop constraint if exists query_workflow_runs_quote_total_check;

alter table public.query_workflow_runs
  add constraint query_workflow_runs_quote_total_check
  check (quote_total_usd_cents >= 0);

alter table public.query_workflow_runs
  drop constraint if exists query_workflow_runs_tips_check;

alter table public.query_workflow_runs
  add constraint query_workflow_runs_tips_check
  check (tips_usd_cents >= 0);

notify pgrst, 'reload schema';
