import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-[#030609]/90" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-[min(94vw,780px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-line-2 bg-surface shadow-[0_32px_90px_rgba(0,0,0,0.65)]',
          className,
        )}
        {...props}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-6 border-b border-line bg-surface px-6 py-4">
          <div>
            <DialogPrimitive.Title className="text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 meta">{description}</DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close dialog"
            className="mt-1 p-1 text-faint transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </header>
        <div className="px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
