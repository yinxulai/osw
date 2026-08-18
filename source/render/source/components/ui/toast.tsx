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
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
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
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm animate-in slide-in-from-right',
                STYLES[t.type],
              )}
              style={{ animation: 'toast-in 0.2s ease-out' }}
            >
              <Icon size={15} className="shrink-0" />
              <span className="max-w-[320px]">{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                className="ml-1 shrink-0 opacity-50 hover:opacity-100"
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
