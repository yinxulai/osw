/**
 * 渲染层的通用外壳：一个产物、两个入口（控制台主界面与托盘面板）共用的那些东西。
 *
 * 两个入口各自写一遍 `QueryClient` 配置、错误边界与 `I18nProvider`，等于把「界面
 * 由哪些 provider 撑起来」这件事写了两遍：某天给控制台加一个 provider，托盘面板
 * 不会跟着有，于是面板里的组件在运行时才炸（`useX must be used inside XProvider`）。
 * 事实上的差别（一个挂路由、一个不挂）由调用方决定，其余部分必须只有一份。
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'
import { I18nProvider } from '@/i18n/provider'
import '@/styles/index.css'

/**
 * 查询默认值。
 *
 * `staleTime` 取 5 秒：界面里的列表都有各自的 `refetchInterval`，这个值只负责挡住
 * 「同一个 key 在几毫秒内被多个组件各拉一次」。
 * `refetchOnWindowFocus` 必须关掉：托盘面板靠 blur 自动收起，窗口焦点变化极频繁，
 * 开着它等于每收起一次就整体重取一遍。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export interface ShellProvidersProps {
  children: ReactNode
}

export function ShellProviders(props: ShellProvidersProps) {
  return (
    <ErrorBoundary
      onError={(error, info) => {
        // 应用最外层的兜底：这里再往上就没有别的东西了，能做的只有留痕。
        console.error('[root]', error, info.componentStack)
      }}
    >
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{props.children}</I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

/**
 * 把一棵树挂到容器上。
 *
 * `elementId` 而不是直接取 `#root`：两个入口的容器 id 一样，但显式传参让「挂哪儿」
 * 在调用处一眼可见。
 */
export function mountShell(elementId: string, node: ReactNode): void {
  ReactDOM.createRoot(document.getElementById(elementId)!, {
    // 并发渲染里被丢掉的一棵树出错时不冒泡到任何错误边界，只会走到这里。
    // 之前没接这个回调，这类错误是完全静默的。
    onRecoverableError: (error, errorInfo) => {
      console.error('[recoverable]', error, errorInfo.componentStack)
    },
  }).render(
    <React.StrictMode>
      <ShellProviders>{node}</ShellProviders>
    </React.StrictMode>,
  )
}
