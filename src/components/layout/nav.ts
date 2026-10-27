import { Bookmark, Database, Map as MapIcon, Settings } from 'lucide-react'

export const NAV = [
  { to: '/', label: 'Explorer', short: 'Explore', icon: MapIcon, end: true },
  { to: '/saved', label: 'Saved queries', short: 'Saved', icon: Bookmark, end: false },
  { to: '/datasets', label: 'Datasets', short: 'Data', icon: Database, end: false },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings, end: false },
] as const
