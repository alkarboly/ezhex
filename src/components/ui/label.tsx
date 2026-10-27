import * as LabelPrimitive from '@radix-ui/react-label'
import { type ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-xs font-medium text-foreground', className)}
      {...props}
    />
  )
}
