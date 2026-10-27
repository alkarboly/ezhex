import { Check } from 'lucide-react'
import { type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}

export function Chip({ pressed, onPressedChange, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-medium capitalize transition-colors',
        pressed
          ? 'border-primary/45 bg-primary/15 text-primary'
          : 'border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {pressed && <Check className="size-3" />}
      {children}
    </button>
  )
}
