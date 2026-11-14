import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onValueChange: (value: number) => void
  label: string
  className?: string
}

export function Slider({ value, min = 0, max = 1, step = 0.05, onValueChange, label, className }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-4 w-full touch-none select-none items-center', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([next]) => onValueChange(next)}
      aria-label={label}
    >
      <SliderPrimitive.Track className="relative h-px w-full grow bg-line-2">
        <SliderPrimitive.Range className="absolute h-px bg-signal" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={`${Math.round(value * 100)}%`}
        className="block h-1.5 w-1.5 bg-signal focus-visible:outline-offset-4"
      />
    </SliderPrimitive.Root>
  )
}
