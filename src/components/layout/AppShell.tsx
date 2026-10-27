import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
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
      </main>
    </div>
  )
}
