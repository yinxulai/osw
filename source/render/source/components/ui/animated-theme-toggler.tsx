import { useCallback, useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { Moon, Sun } from 'lucide-react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark'

interface ViewTransition {
  ready: Promise<void>
  finished: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition
}

export interface AnimatedThemeTogglerProps extends ComponentPropsWithoutRef<'button'> {
  duration?: number
  fromCenter?: boolean
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

function getClipPaths(x: number, y: number, radius: number, width: number, height: number) {
  const point = (pointX: number, pointY: number) => `${(pointX / width) * 100}% ${(pointY / height) * 100}%`
  const toRadius = (value: number) => `${(value / (Math.hypot(width, height) / Math.SQRT2)) * 100}%`

  return [
    `circle(0% at ${point(x, y)})`,
    `circle(${toRadius(radius)} at ${point(x, y)})`,
  ] as const
}

export function AnimatedThemeToggler({
  children,
  className,
  duration = 400,
  fromCenter = false,
  theme,
  onThemeChange,
  ...props
}: AnimatedThemeTogglerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const transitioningRef = useRef(false)
  const animationRef = useRef<Animation | null>(null)

  const cleanup = useCallback(() => {
    const root = document.documentElement
    transitioningRef.current = false
    animationRef.current?.cancel()
    animationRef.current = null
    delete root.dataset.magicuiThemeVt
    root.style.removeProperty('--magicui-theme-toggle-vt-duration')
    root.style.removeProperty('--magicui-theme-vt-clip-from')
  }, [])

  useEffect(() => cleanup, [cleanup])

  const toggleTheme = useCallback(() => {
    const root = document.documentElement
    const button = buttonRef.current
    if (!button || transitioningRef.current || root.dataset.magicuiThemeVt === 'active') return

    const width = window.innerWidth
    const height = window.innerHeight
    const rect = button.getBoundingClientRect()
    const x = fromCenter ? width / 2 : rect.left + rect.width / 2
    const y = fromCenter ? height / 2 : rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y))
    const nextTheme = theme === 'dark' ? 'light' : 'dark'

    const applyTheme = () => {
      root.classList.toggle('dark', nextTheme === 'dark')
      onThemeChange(nextTheme)
    }

    const startViewTransition = (root.ownerDocument as ViewTransitionDocument).startViewTransition
    if (typeof startViewTransition !== 'function') {
      applyTheme()
      return
    }

    const [from, to] = getClipPaths(x, y, radius, width, height)
    transitioningRef.current = true
    root.dataset.magicuiThemeVt = 'active'
    root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`)
    root.style.setProperty('--magicui-theme-vt-clip-from', from)

    const transition = startViewTransition.call(root.ownerDocument, () => {
      flushSync(applyTheme)
    })
    transition.finished.finally(cleanup).catch(() => undefined)
    transition.ready.then(() => {
      animationRef.current = root.animate({ clipPath: [from, to] }, {
        duration,
        easing: 'ease-in-out',
        fill: 'forwards',
        pseudoElement: '::view-transition-new(root)',
      })
    }).catch(() => undefined)
  }, [cleanup, duration, fromCenter, onThemeChange, theme])

  return (
    <button
      {...props}
      ref={buttonRef}
      type="button"
      onClick={toggleTheme}
      className={cn(className)}
      aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
      {children ?? <span className="sr-only">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>}
    </button>
  )
}
