import { H3_RESOLUTION } from '../lib/limits'
import { supabasePublicConfig } from '../lib/supabase'
import { configuredDataMode } from '../services'

export function SettingsPage() {
  const mode = configuredDataMode()
  const supabase = supabasePublicConfig()
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Account sign-in arrives with Supabase. This page only shows how the app is configured.
          </p>
        </header>
        <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Data mode</dt>
            <dd className="font-medium" data-testid="settings-mode">
              {mode.resolved}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">VITE_DATA_MODE</dt>
            <dd className="font-mono text-xs">{mode.raw}</dd>
          </div>
          {mode.unrecognized && (
            <p className="text-xs text-destructive">
              Unrecognized mode. WorldPulse is using mock data. Set the variable to mock or supabase.
            </p>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">Supabase URL</dt>
            <dd>{supabase.urlConfigured ? 'Configured' : 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Supabase anon key</dt>
            <dd>{supabase.anonKeyConfigured ? 'Configured' : 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">H3 resolution</dt>
            <dd className="font-mono">{H3_RESOLUTION}</dd>
          </div>
        </dl>
        <p className="text-sm leading-6 text-muted-foreground">
          The browser only receives the Supabase URL and the publishable anon key. Do not put the service-role key in
          a VITE_ variable or in frontend source.
        </p>
      </div>
    </div>
  )
}
