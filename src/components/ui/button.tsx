import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const VARIANT = {
  default: 'btn-primary',
  secondary: 'btn-outline',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
} as const

const SIZE = {
  sm: 'h-7 px-2.5 text-[10px]',
  md: '',
  icon: 'h-8 w-8 px-0',
} as const

export function Button({
  className,
  variant = 'default',
  size = 'md',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE }) {
  return <button type={type} className={cn('btn', VARIANT[variant], SIZE[size], className)} {...props} />
}
