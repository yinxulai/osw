import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  duration?: number
  decimalPlaces?: number
}

export function NumberTicker({ value, decimalPlaces = 0, duration = 650, className, ...props }: NumberTickerProps) {
  const previousValue = useRef(value)
  const frame = useRef<number | null>(null)
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    const startValue = previousValue.current
    const delta = value - startValue
    const startedAt = performance.now()
    previousValue.current = value

    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (delta === 0) {
      setDisplayValue(value)
      return
    }

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1)
      const easedProgress = 1 - (1 - progress) ** 4
      setDisplayValue(startValue + delta * easedProgress)
      if (progress < 1) frame.current = requestAnimationFrame(tick)
      else frame.current = null
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [duration, value])

  return (
    <span className={cn('inline-block tabular-nums', className)} {...props}>
      {displayValue.toLocaleString('en-US', {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      })}
    </span>
  )
}
