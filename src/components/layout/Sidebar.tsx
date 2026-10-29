import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useDataSource } from '../../hooks/useDataSource'
import { cn } from '../../lib/utils'
import { BrandMark } from './BrandMark'
import { NAV } from './nav'

export function Sidebar() {
  const source = useDataSource()
  const auth = useAuth()
  const mode = source.data?.mode
  const email = auth.session.data?.user?.email
  return (
    <aside className="relative z-30 flex h-full w-[76px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#060a0f] py-3">
      <NavLink to="/" aria-label="ReadyHex home" className="grid size-12 place-items-center rounded-xl">
        <BrandMark size={34} />
      </NavLink>
      <nav className="mt-4 flex flex-col items-center gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            title={item.label}
            className="group relative flex w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-2 bottom-6 -left-1.5 w-[3px] rounded-full bg-primary shadow-[0_0_12px_rgba(61,222,192,0.8)]" />
                )}
                <span
                  className={cn(
                    'grid size-9 place-items-center rounded-lg transition-colors',
                    isActive ? 'bg-primary/12 text-primary' : 'group-hover:bg-white/[0.05]',
                  )}
                >
                  <item.icon className="size-[18px]" />
                </span>
                <span className={cn('max-w-14 text-center leading-tight', isActive && 'text-foreground')}>{item.short}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1.5">
        <span
          data-testid="data-mode"
          title={mode === 'supabase' ? 'Supabase data' : 'Mock data: synthetic Austin records'}
          className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-primary uppercase"
        >
          {mode === 'supabase' ? 'Supabase' : mode === 'mock' ? 'Mock' : '…'}
        </span>
        <NavLink
          to="/settings"
          title={email ? email : 'Sign in'}
          className="max-w-14 truncate text-center font-mono text-[9px] text-muted-foreground hover:text-foreground"
        >
          {email ? email.split('@')[0] : 'Sign in'}
        </NavLink>
        <span className="font-mono text-[9px] text-muted-foreground">H3 · r8</span>
      </div>
    </aside>
  )
}
