export function SavedQueriesPage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8">
        <h1 className="text-xl font-semibold">Saved queries</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Saving queries is the next slice. Authenticated users will store a name, description, and the same query
          JSON the explorer already builds. Subscriptions and scheduled runs are out of scope.
        </p>
        <pre className="overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-[11px] leading-5 text-muted-foreground">{`create table saved_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  name text not null,
  description text,
  query_config jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);`}</pre>
        <p className="text-sm leading-6 text-muted-foreground">
          This table is not created yet. Row level security will limit every row to <span className="font-mono">auth.uid() = user_id</span>.
          <span className="font-mono"> query_config</span> will store the explorer query spec, not SQL.
        </p>
      </div>
    </div>
  )
}
