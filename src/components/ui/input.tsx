import { type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const fieldBase =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm text-foreground transition-colors hover:border-white/15 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'

export const nativeSelectClass = cn(fieldBase, 'select-chevron cursor-pointer appearance-none pr-8 pl-3')

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldBase,
        'flex px-3 placeholder:text-muted-foreground/55',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
