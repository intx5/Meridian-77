import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center border border-line-2 bg-transparent transition-colors data-[state=checked]:border-accent disabled:opacity-30',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-2 w-2 translate-x-[3px] bg-faint transition-transform duration-150 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent" />
    </SwitchPrimitive.Root>
  )
}
