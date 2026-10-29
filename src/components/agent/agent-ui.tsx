import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

const HEX_POINTS = '50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5'

/** The agent's mark: a spinning gradient ring around a glowing hex core. */
export function AgentOrb({ size = 56, busy = false, className }: { size?: number; busy?: boolean; className?: string }) {
  const gradient = `wp-orb-${useId().replace(/:/g, '')}`
  return (
    <span
      aria-hidden
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <span className="wp-agent-halo absolute -inset-[22%] rounded-full blur-md" data-busy={busy} />
      <span className="wp-agent-ring absolute inset-0 rounded-full" data-busy={busy} />
      <span className="absolute inset-[2px] rounded-full bg-[radial-gradient(circle_at_34%_28%,#173a40,#070b10_72%)]" />
      <svg viewBox="0 0 100 100" className="relative" style={{ width: size * 0.5, height: size * 0.5 }}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#7ef0dc" />
            <stop offset="1" stopColor={busy ? '#f4c25b' : '#3ddec0'} />
          </linearGradient>
        </defs>
        <polygon
          points={HEX_POINTS}
          fill={`url(#${gradient})`}
          fillOpacity={0.16}
          stroke={`url(#${gradient})`}
          strokeWidth={7}
          strokeLinejoin="round"
        />
        <circle
          cx="50"
          cy="50"
          r={busy ? 15 : 12}
          fill={`url(#${gradient})`}
          className={cn('wp-motion', busy && 'animate-[wp-blink_1s_ease-in-out_infinite]')}
        />
      </svg>
    </span>
  )
}

export type HexGlyphTone = 'idle' | 'ready' | 'missing' | 'running' | 'done' | 'error'

const HEX_TONES: Record<HexGlyphTone, { fill: string; stroke: string }> = {
  idle: { fill: 'rgba(141,155,174,0.08)', stroke: 'rgba(141,155,174,0.45)' },
  ready: { fill: 'rgba(61,222,192,0.28)', stroke: '#3ddec0' },
  missing: { fill: 'rgba(141,155,174,0.12)', stroke: 'rgba(232,238,245,0.55)' },
  running: { fill: 'rgba(244,194,91,0.3)', stroke: '#f4c25b' },
  done: { fill: 'rgba(61,222,192,0.42)', stroke: '#7ef0dc' },
  error: { fill: 'rgba(240,113,120,0.25)', stroke: '#f07178' },
}

export function HexGlyph({
  tone,
  size = 11,
  delay = 0,
  pulse = false,
}: {
  tone: HexGlyphTone
  size?: number
  delay?: number
  pulse?: boolean
}) {
  const colors = HEX_TONES[tone]
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={cn('shrink-0 animate-[wp-hex-pop_380ms_ease-out_both]', pulse && 'wp-motion')}
      style={{ width: size, height: size, animationDelay: `${delay}ms` }}
    >
      <polygon
        points={HEX_POINTS}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={9}
        strokeLinejoin="round"
        className={pulse ? 'wp-motion animate-[wp-blink_1.1s_ease-in-out_infinite]' : undefined}
      />
    </svg>
  )
}

export function ShimmerBar({ className, active = true }: { className?: string; active?: boolean }) {
  return (
    <div className={cn('relative h-1 overflow-hidden rounded-full bg-white/[0.06]', className)}>
      {active ? (
        <div className="wp-shimmer-bar absolute inset-y-0 left-0 w-2/5 rounded-full" />
      ) : (
        <div className="absolute inset-0 rounded-full bg-primary/70" />
      )}
    </div>
  )
}

export function Chip({
  children,
  icon,
  tone = 'default',
  delay = 0,
  className,
}: {
  children: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'primary' | 'amber' | 'violet'
  delay?: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'wp-rise inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] leading-4',
        tone === 'default' && 'border-white/[0.08] bg-white/[0.04] text-foreground/85',
        tone === 'primary' && 'border-primary/30 bg-primary/10 text-primary',
        tone === 'amber' && 'border-select/35 bg-select/10 text-select',
        tone === 'violet' && 'border-[#b69cff]/35 bg-[#b69cff]/10 text-[#cbb8ff]',
        className,
      )}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function useNow(active: boolean, interval = 100): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [active, interval])
  return now
}

/** Types text in once. Turns that were already on screen render in full. */
export function useTypewriter(text: string, animate: boolean): { shown: string; typing: boolean } {
  const [count, setCount] = useState(() => (animate ? 0 : text.length))
  useEffect(() => {
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      return
    }
    setCount(0)
    const step = Math.max(1, Math.round(text.length / 90))
    const timer = window.setInterval(() => {
      setCount((current) => {
        const next = Math.min(text.length, current + step)
        if (next >= text.length) window.clearInterval(timer)
        return next
      })
    }, 16)
    return () => window.clearInterval(timer)
  }, [text, animate])
  return { shown: text.slice(0, count), typing: count < text.length }
}

export function formatElapsed(ms: number): string {
  if (ms < 0) return '0.0s'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
