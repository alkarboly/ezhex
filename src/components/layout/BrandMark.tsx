import { useId } from 'react'

export function BrandMark({ size = 36 }: { size?: number }) {
  const gradient = useId()
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden className="shrink-0 drop-shadow-[0_0_14px_rgba(61,222,192,0.35)]">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff5e2" />
          <stop offset="1" stopColor="#139c93" />
        </linearGradient>
      </defs>
      <path d="M18 2.5 31.4 10.25v15.5L18 33.5 4.6 25.75v-15.5Z" fill={`url(#${gradient})`} />
      <path d="M18 9.6 25.3 13.8v8.4L18 26.4 10.7 22.2v-8.4Z" fill="#05080c" fillOpacity="0.88" />
      <circle cx="18" cy="18" r="2.7" fill="#8ff5e2" />
    </svg>
  )
}
