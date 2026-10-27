import { useEffect, useState } from 'react'

export const MOBILE_QUERY = '(max-width: 767px)'
/** Devices without hover get the center reticle lens instead of a cursor lens. */
export const TOUCH_QUERY = '(hover: none), (pointer: coarse)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return matches
}
