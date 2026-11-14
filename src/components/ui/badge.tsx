import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] leading-none',
  {
    variants: {
      variant: {
        default: 'border-line-2 text-muted',
        go: 'border-go/40 text-go',
        caution: 'border-caution/40 text-caution',
        nogo: 'border-danger/40 text-danger',
        science: 'border-signal/35 text-signal',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
