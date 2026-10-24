import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { clearAllPageScratch } from '@/store/page-scratch'

/**
 * 渲染层的错误边界。
 *
 * 之前整个渲染层没有任何 `componentDidCatch`：任何一个组件在渲染期抛错，
 * React 都会卸载整棵树，界面直接变白（React 18 只在控制台留一行 "consider adding an error boundary"）。
 * 这里把抛错的子树圈住，替换成一块可读的兜底界面，并允许用户原地重试。
 *
 * 只兜**渲染期**的错误。事件回调、`setTimeout`、Promise 里的异常不会经过这里，
 * 那些由各处的 try/catch 与主进程的 unhandledRejection 处理。
 */
export interface ErrorBoundaryProps {
  children: ReactNode
  /** 出错时替换掉整棵子树；不传则用内置的整页兜底界面。 */
  fallback?: (props: ErrorFallbackProps) => ReactNode
  /** 出错时的额外上报钩子。 */
  onError?: (error: unknown, info: ErrorInfo) => void
  /**
   * 这些值变化时自动清掉错误状态。
   * 典型用法是传路由 pathname：某个页面崩了，用户切到别的页面就自动恢复，
   * 不用重启整个应用。
   */
  resetKeys?: readonly unknown[]
}

export interface ErrorFallbackProps {
  error: unknown
  reset: () => void
}

interface ErrorBoundaryState {
  error: unknown
}

function hasChanged(a: readonly unknown[] = [], b: readonly unknown[] = []) {
  return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 组件栈比 JS 栈更能直接指出是谁崩的，优先打到控制台。
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.props.onError?.(error, info)
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error !== null && hasChanged(previous.resetKeys, this.props.resetKeys)) {
      this.reset()
    }
  }

  reset = () => {
    if (this.state.error !== null) this.setState({ error: null })
  }

  render() {
    if (this.state.error === null) return this.props.children
    const fallback = this.props.fallback ?? (props => <ErrorFallback {...props} />)
    return fallback({ error: this.state.error, reset: this.reset })
  }
}

export interface DescribeErrorFallbacks {
  /** 抛出物是 `null` / `undefined` 时的标题。 */
  unknownTitle: string
  /** 抛出物不是 `Error` 且无法序列化时的标题。 */
  nonErrorTitle: string
}

/** 把任意抛出物压成一段可读文本，避免 `[object Object]` 或者整页只有 "Error"。 */
export function describeError(error: unknown, fallbacks: DescribeErrorFallbacks): { title: string; detail: string | null } {
  if (error instanceof Error) {
    return { title: error.message || error.name, detail: error.stack ?? null }
  }
  if (typeof error === 'string') return { title: error, detail: null }
  if (error === null || error === undefined) return { title: fallbacks.unknownTitle, detail: null }
  try {
    return { title: fallbacks.nonErrorTitle, detail: JSON.stringify(error, null, 2) }
  } catch {
    return { title: String(error), detail: null }
  }
}

interface ErrorFallbackOptions {
  /** 兜底界面的标题，路由级与整页级用不同措辞。 */
  title?: string
  description?: string
  /** 「重新加载」按钮是否展示。整页兜底才有意义，路由级留着让用户切页即可。 */
  reloadable?: boolean
  /**
   * 内嵌在已有壳层里（侧栏、顶栏都还活着）时置为 `true`：
   * 不再占满整屏，也不再提供「重新加载应用」——切页就能恢复，不需要重启。
   */
  embedded?: boolean
}

/**
 * 兜底界面本体。
 *
 * 全屏、居中、单张卡片：出错的界面本身不能再依赖任何可能同样出错的布局组件
 * （侧栏、路由 Outlet 都可能正是崩掉的那一块），所以这里只用最基础的标签和样式 token。
 */
export function ErrorFallback(props: ErrorFallbackProps & ErrorFallbackOptions) {
  const t = useTranslation()
  const { error, reset, title, description, embedded = false, reloadable = !embedded } = props
  const heading = title ?? t('common.error.rootTitle')
  const body = description ?? t('common.error.rootDescription')
  const { title: message, detail } = describeError(error, { unknownTitle: t('common.label.unknownError'), nonErrorTitle: t('common.error.nonError') })

  return (
    <div className={cn('flex w-full justify-center p-6', embedded ? 'items-start' : 'min-h-screen items-center bg-background')}>
      <div className="w-full max-w-xl rounded-xl border border-module-border bg-card p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="system-md-semibold text-text-primary">{heading}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">{body}</p>
          </div>
        </div>

        <p className="mt-4 system-xs-medium text-text-secondary">{t('common.error.messageLabel')}</p>
        <p className="mt-1 rounded-lg border border-module-border bg-inset p-3 system-xs-regular break-words text-text-secondary">
          {message}
        </p>

        {detail ? (
          <details className="mt-2">
            <summary className="cursor-pointer system-xs-regular text-text-tertiary select-none">{t('common.error.stackLabel')}</summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-module-border bg-inset p-3 system-2xs-regular whitespace-pre-wrap text-text-tertiary">
              {detail}
            </pre>
          </details>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={reset}>
            <RotateCcw size={13} /> {t('common.action.retry')}
          </Button>
          {reloadable ? (
            <Button size="sm" variant="outline" onClick={() => {
              // 重载前先丢掉所有页面的临时草稿（筛选、页码、展开项）。
              // 崩掉的那一页按定义还记着崩的时候那份筛选；原样重载很可能一脚踩回
              // 同一个状态里，用户看到的就是「重载也没用」。这里清的是临时状态，
              // 主题、语言这类长期偏好不受影响。
              clearAllPageScratch()
              window.location.reload()
            }}>
              {t('common.action.reloadApp')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
