-- Subscribe-to-new-data flag on saved inspect workflows.
-- Check now reads overture_hex_snapshots. No scheduler is wired yet.

alter table public.query_workflows
  add column if not exists subscribe_new_data boolean not null default false;

notify pgrst, 'reload schema';
