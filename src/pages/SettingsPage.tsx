import { Link } from 'react-router-dom'
import { useDataSource } from '../hooks/useDataSource'
import { H3_RESOLUTION } from '../lib/limits'

export function SettingsPage() {
  const source = useDataSource()
  const data = source.data
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The Node server chooses the data provider. This page shows what that process loaded. It never shows a key.
          </p>
        </header>
        <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Data mode</dt>
            <dd className="font-medium" data-testid={data ? 'settings-mode' : undefined}>
              {data?.mode ?? (source.isLoading ? 'Loading…' : 'Unavailable')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">DATA_MODE</dt>
            <dd className="font-mono text-xs">{data?.rawMode ?? '—'}</dd>
          </div>
          {data?.unrecognized && (
            <p className="text-xs text-destructive">
              Unrecognized mode. The server is using mock data. Set DATA_MODE to mock or supabase.
            </p>
          )}
          {source.error && <p className="text-xs text-destructive">{source.error.message}</p>}
          <div>
            <dt className="text-xs text-muted-foreground">Supabase URL</dt>
            <dd>{data ? (data.supabase.urlConfigured ? 'Configured' : 'Not set') : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Supabase anon key</dt>
            <dd>{data ? (data.supabase.anonKeyConfigured ? 'Configured' : 'Not set') : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">H3 resolution</dt>
            <dd className="font-mono">{H3_RESOLUTION}</dd>
          </div>
        </dl>
        <p className="text-sm leading-6 text-muted-foreground">
          Queries run on the server. Set SUPABASE_URL and SUPABASE_ANON_KEY there when that provider is connected. Do
          not put the service-role key in the environment or in frontend source. Map and dataset credits live on{' '}
          <Link to="/licenses" className="text-primary underline-offset-2 hover:underline">
            Licenses
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
