import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
  closing: boolean
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

interface ToastProviderProps {
  children: ReactNode
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
}

const STYLES: Record<ToastType, string> = {
  success: 'before:bg-success',
  error: 'before:bg-destructive',
  info: 'before:bg-info',
  warning: 'before:bg-warning',
}

const ICON_STYLES: Record<ToastType, string> = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-info',
  warning: 'text-warning',
}

const EXIT_DURATION = 200

export function ToastProvider(props: ToastProviderProps) {
  const { children } = props
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, number>>(new Map())

  const remove = useCallback((id: number) => {
    setToasts(prev => {
      const exists = prev.some(t => t.id === id)
      if (!exists) return prev
      return prev.map(t => (t.id === id ? { ...t, closing: true } : t))
    })
    const timer = window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      timersRef.current.delete(id)
    }, EXIT_DURATION)
    timersRef.current.set(id, timer)
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, type, message, duration, closing: false }])
    if (duration > 0) {
      const timer = window.setTimeout(() => remove(id), duration)
      timersRef.current.set(id, timer)
    }
  }, [remove])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const success = useCallback((message: string) => toast(message, 'success'), [toast])
  const error = useCallback((message: string) => toast(message, 'error', 6000), [toast])
  const info = useCallback((message: string) => toast(message, 'info'), [toast])
  const warning = useCallback((message: string) => toast(message, 'warning'), [toast])
  const value = useMemo<ToastContextValue>(() => ({ toast, success, error, info, warning }), [toast, success, error, info, warning])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto relative flex min-w-65 items-center gap-2.5 overflow-hidden rounded-lg border border-border bg-popover px-3.5 py-3 text-xs text-foreground shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-0.5 dark:shadow-black/40',
                STYLES[t.type],
                t.closing ? 'toast-out' : 'toast-in',
              )}
            >
              <Icon size={15} className={cn('shrink-0', ICON_STYLES[t.type])} />
              <span className="max-w-[320px] flex-1 leading-5">{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                aria-label="关闭通知"
                className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(24px) scale(0.98); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to { opacity: 0; transform: translateX(24px) scale(0.98); }
        }
        .toast-in {
          animation: toast-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .toast-out {
          animation: toast-out 0.2s ease-in forwards;
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
