import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { type ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function TooltipProvider({
  delayDuration = 250,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'glass z-50 rounded-lg px-2 py-1 text-xs text-popover-foreground data-[state=delayed-open]:animate-[wp-fade-in_120ms_ease-out]',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
