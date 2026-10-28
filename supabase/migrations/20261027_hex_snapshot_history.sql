-- Workflow snapshot pin and run metadata. Hex history stays on overture_hex_snapshots.
-- History starts at first Process. Later cuts are written on a workflow run.

alter table public.query_workflows
  add column if not exists release_version text;

alter table public.query_workflows
  drop constraint if exists query_workflows_release_version_check;

alter table public.query_workflows
  add constraint query_workflows_release_version_check
  check (release_version is null or release_version ~ '^[A-Za-z0-9._-]{3,64}$');

alter table public.query_workflow_runs
  add column if not exists release_version text;

alter table public.query_workflow_runs
  drop constraint if exists query_workflow_runs_release_version_check;

alter table public.query_workflow_runs
  add constraint query_workflow_runs_release_version_check
  check (release_version is null or release_version ~ '^[A-Za-z0-9._-]{3,64}$');

alter table public.query_workflow_runs
  add column if not exists snapshot_status text;

alter table public.query_workflow_runs
  drop constraint if exists query_workflow_runs_snapshot_status_check;

alter table public.query_workflow_runs
  add constraint query_workflow_runs_snapshot_status_check
  check (snapshot_status is null or snapshot_status in ('current', 'stale', 'historical'));

alter table public.query_workflow_runs
  add column if not exists historized_hexes text[] not null default '{}';

notify pgrst, 'reload schema';
