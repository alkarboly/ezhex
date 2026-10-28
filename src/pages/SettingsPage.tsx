import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDataSource } from '../hooks/useDataSource'
import { H3_RESOLUTION } from '../lib/limits'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'

export function SettingsPage() {
  const source = useDataSource()
  const data = source.data
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to own workflows later. The public map stays open. This page never shows a key.
          </p>
        </header>
        <AccountCard />
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
          Queries run on the server. Set SUPABASE_URL and SUPABASE_ANON_KEY there. Do not put the service-role key in
          the environment or in frontend source. Map and dataset credits live on{' '}
          <Link to="/licenses" className="text-primary underline-offset-2 hover:underline">
            Licenses
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

function AccountCard() {
  const { session, signIn, signUp, signOut, remove } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const user = session.data?.user ?? null
  const configured = session.data?.configured ?? false
  const pending = signIn.isPending || signUp.isPending
  const error =
    signIn.error?.message ||
    signUp.error?.message ||
    signOut.error?.message ||
    remove.error?.message ||
    (session.error ? session.error.message : null)

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Account</h2>
      {session.isLoading && <p className="mt-2 text-sm text-muted-foreground">Checking session…</p>}
      {!session.isLoading && !configured && (
        <p className="mt-2 text-sm text-muted-foreground">
          Set SUPABASE_URL and SUPABASE_ANON_KEY on the server, then run supabase/migrations/20261027_auth.sql. Turn off
          Confirm email in Supabase Auth if you want a session right after sign-up.
        </p>
      )}
      {!session.isLoading && configured && !user && (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            signIn.mutate({ email, password })
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="account-email">Email</Label>
            <Input
              id="account-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="account-password">Password</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Sign in
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => signUp.mutate({ email, password })}
            >
              Create account
            </Button>
          </div>
          {signUp.data?.needs_confirmation && (
            <p className="text-sm text-muted-foreground">
              Account created. Confirm the email if your project requires it, then sign in.
            </p>
          )}
        </form>
      )}
      {!session.isLoading && user && (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-sm">
            Signed in as <span className="font-medium">{user.email ?? user.id}</span>
          </p>
          <div>
            <Button type="button" variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          </div>
          <form
            className="flex flex-col gap-3 rounded-md border border-destructive/30 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (deleteConfirm !== 'DELETE') return
              remove.mutate(deletePassword)
            }}
          >
            <p className="text-sm text-muted-foreground">
              Delete this account and any workflows you own. Public map data stays. Type DELETE to confirm.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="delete-password">Password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="delete-confirm">Type DELETE</Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="destructive" disabled={remove.isPending || deleteConfirm !== 'DELETE'}>
              Delete account
            </Button>
          </form>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
