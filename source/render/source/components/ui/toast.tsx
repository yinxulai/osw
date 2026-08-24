import { createContext, useContext, type ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

type ToastType = 'success' | 'error' | 'info' | 'warning'

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

export function ToastProvider(props: ToastProviderProps) {
  const toast = (message: string, type: ToastType = 'info', duration = 4000) => {
    sonnerToast[type](message, { duration })
  }
  const value: ToastContextValue = {
    toast,
    success: message => sonnerToast.success(message),
    error: message => sonnerToast.error(message, { duration: 6000 }),
    info: message => sonnerToast.info(message),
    warning: message => sonnerToast.warning(message),
  }

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      <Toaster position="bottom-right" />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
