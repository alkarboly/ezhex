import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useDataSource } from '../../hooks/useDataSource'
import { H3_RESOLUTION } from '../../lib/limits'
import { cn } from '../../lib/utils'
import { BrandMark } from './BrandMark'
import { NAV } from './nav'

export function MobileNavButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const source = useDataSource()
  const auth = useAuth()
  const mode = source.data?.mode
  const email = auth.session.data?.user?.email
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className={cn('glass grid size-11 shrink-0 place-items-center rounded-full', className)}
        >
          <BrandMark size={24} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-[wp-fade-in_160ms_ease-out]" />
        <Dialog.Content className="glass fixed top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 z-50 flex w-[min(19rem,calc(100vw-1rem))] flex-col rounded-2xl p-4 data-[state=open]:animate-[wp-slide-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]">
          <div className="flex items-center gap-3">
            <BrandMark size={34} />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">WorldPulse</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">Austin H3 explorer</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close menu"
              className="ml-auto grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <nav className="mt-6 flex flex-col gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground',
                    isActive && 'bg-primary/10 text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn('size-[18px]', isActive && 'text-primary')} />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-primary">{mode === 'supabase' ? 'Supabase' : 'Mock data'}</span>
            {' · '}H3 resolution {H3_RESOLUTION}
            <p className="mt-1">
              {mode === 'supabase'
                ? 'Reading from the configured Supabase project.'
                : 'Synthetic Austin records shaped like Overture features.'}
            </p>
            <p className="mt-2">
              {email ? `Signed in as ${email}` : 'Not signed in.'}{' '}
              <NavLink to="/settings" onClick={() => setOpen(false)} className="text-primary underline-offset-2 hover:underline">
                {email ? 'Account' : 'Sign in'}
              </NavLink>
            </p>
            <NavLink
              to="/licenses"
              onClick={() => setOpen(false)}
              className="mt-2 inline-block text-primary underline-offset-2 hover:underline"
            >
              Licenses
            </NavLink>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function MobilePageHeader() {
  const { pathname } = useLocation()
  const item = NAV.find((entry) => entry.to !== '/' && pathname.startsWith(entry.to))
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <MobileNavButton />
      <span className="text-sm font-semibold">{item?.label ?? 'WorldPulse'}</span>
    </header>
  )
}
