import * as PopoverPrimitive from '@radix-ui/react-popover'
import { type ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  sideOffset = 10,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'glass z-50 rounded-2xl p-3 text-popover-foreground outline-none data-[state=open]:animate-[wp-pop-in_160ms_ease-out]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
