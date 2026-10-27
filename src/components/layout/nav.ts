import { Bookmark, Database, ListChecks, Map as MapIcon, Settings } from 'lucide-react'

export const NAV = [
  { to: '/', label: 'Explorer', short: 'Explore', icon: MapIcon, end: true },
  { to: '/workflows', label: 'Workflows', short: 'Workflows', icon: Bookmark, end: false },
  { to: '/jobs', label: 'Jobs', short: 'Jobs', icon: ListChecks, end: false },
  { to: '/datasets', label: 'Datasets', short: 'Data', icon: Database, end: false },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings, end: false },
] as const
