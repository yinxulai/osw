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
  /**
   * toast 距视口底部的距离（px）。不传就用 sonner 的默认值。
   *
   * 给「页面底部有一条常驻操作条」的界面用（引导页的「上一步 / 跳过 / 下一步」）：
   * toast 固定在右下角，正好压在那条操作条的主按钮上。抬到操作条之上是唯一干净的做法 ——
   * 让操作条躲 toast（加内边距、换位置）会把那条线在整屏里推得上不着天下不着地。
   */
  bottomOffset?: number
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** sonner 自己的 API 已经够稳定，这里只做薄封装，所以函数全部提到模块作用域。 */
const showToast = (message: string, type: ToastType = 'info', duration = 4000) => {
  sonnerToast[type](message, { duration })
}

/**
 * context value 是模块级常量，`useToast()` 的返回值引用恒定。
 *
 * 引用必须恒定：任何把 `toast` / `toast.error` 写进 `useCallback`、`useEffect` 依赖数组的
 * 地方，都会在引用每次变化时重跑一遍，而这类重跑经常带 `setState`——正是最容易演变成
 * `Maximum update depth exceeded` 的那类写法。在 `ToastProvider` 里构造对象就正好会引入
 * 这种引用变化，所以整个 value 连里面的箭头函数一起提到模块作用域。
 */
const TOAST_VALUE: ToastContextValue = {
  toast: showToast,
  success: message => sonnerToast.success(message),
  error: message => sonnerToast.error(message, { duration: 6000 }),
  info: message => sonnerToast.info(message),
  warning: message => sonnerToast.warning(message),
}

export function ToastProvider(props: ToastProviderProps) {
  const offset = props.bottomOffset === undefined ? undefined : { bottom: props.bottomOffset }

  return (
    <ToastContext.Provider value={TOAST_VALUE}>
      {props.children}
      {/*
       * `mobileOffset` 必须单独传一份：窄屏下 sonner 读的是 `--mobile-offset`，
       * 只给 `offset` 的话手机上还是压在操作条上。
       */}
      <Toaster position="bottom-right" offset={offset} mobileOffset={offset} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
