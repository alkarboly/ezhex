import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { useExplorer } from '../../store/explorer-store'
import { MobilePageHeader } from './MobileNav'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const { pathname } = useLocation()
  const setFiltersOpen = useExplorer((state) => state.setFiltersOpen)

  useEffect(() => {
    if (window.matchMedia('(max-width: 1100px)').matches) setFiltersOpen(false)
  }, [setFiltersOpen])

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {!mobile && <Sidebar />}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {mobile && pathname !== '/' && <MobilePageHeader />}
        <Outlet />
        <div className="pointer-events-none absolute right-3 bottom-2 z-10 max-w-[min(90vw,26rem)]">
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
