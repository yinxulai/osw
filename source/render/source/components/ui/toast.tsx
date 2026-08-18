import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, type, message, duration }])
    if (duration > 0) {
      window.setTimeout(() => remove(id), duration)
    }
  }, [remove])

  const value: ToastContextValue = {
    toast,
    success: (msg: string) => toast(msg, 'success'),
    error: (msg: string) => toast(msg, 'error', 6000),
    info: (msg: string) => toast(msg, 'info'),
    warning: (msg: string) => toast(msg, 'warning'),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-100 flex flex-col gap-2">
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'relative flex min-w-65 items-center gap-2.5 overflow-hidden rounded-lg border border-border bg-popover px-3.5 py-3 text-xs text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-sm before:absolute before:inset-y-0 before:left-0 before:w-0.5 animate-in slide-in-from-right',
                STYLES[t.type],
              )}
              style={{ animation: 'toast-in 0.2s ease-out' }}
            >
              <Icon size={15} className={cn('shrink-0', ICON_STYLES[t.type])} />
              <span className="max-w-[320px] flex-1 leading-5">{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                aria-label="关闭通知"
                className="ml-1 shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
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
