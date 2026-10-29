import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { cn } from '../../lib/utils'
import { useExplorer } from '../../store/explorer-store'
import { MobilePageHeader } from './MobileNav'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const { pathname } = useLocation()
  const setFiltersOpen = useExplorer((state) => state.setFiltersOpen)
  const introChrome = useExplorer((state) => state.introChrome)
  const hideChrome = pathname === '/' && introChrome === 'globe'
  const hideSidebar = pathname === '/' && (introChrome === 'globe' || introChrome === 'dock')

  useEffect(() => {
    if (window.matchMedia('(max-width: 1100px)').matches) setFiltersOpen(false)
  }, [setFiltersOpen])

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {!mobile && (
        <div
          aria-hidden={hideSidebar}
          className={cn(
            'h-full shrink-0 overflow-hidden transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.32,1)]',
            hideSidebar ? 'pointer-events-none w-0' : 'w-[76px]',
          )}
        >
          <Sidebar />
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {mobile && pathname !== '/' && <MobilePageHeader />}
        <Outlet />
        <div
          className={cn(
            'pointer-events-none absolute right-3 bottom-2 z-10 max-w-[min(90vw,26rem)] transition-opacity duration-500',
            hideChrome ? 'opacity-0' : 'opacity-100',
          )}
        >
          <p className="glass pointer-events-auto rounded-full px-3 py-1.5 text-[10px] text-muted-foreground">
            Demo only · payments and ledger are simulated · no personal banking data is collected ·{' '}
            <Link to="/licenses" className="text-primary hover:underline">
              details
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
