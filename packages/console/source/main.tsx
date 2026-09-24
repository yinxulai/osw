import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './routing/router'
import { ErrorBoundary } from './components/error-boundary'
import { I18nProvider } from './i18n/provider'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!, {
  // 并发渲染里被丢掉的一棵树出错时不冒泡到任何错误边界，只会走到这里。
  // 之前没接这个回调，这类错误是完全静默的。
  onRecoverableError: (error, errorInfo) => {
    console.error('[recoverable]', error, errorInfo.componentStack)
  },
}).render(
  <React.StrictMode>
    <ErrorBoundary
      onError={(error, info) => {
        // 应用最外层的兜底：这里再往上就没有别的东西了，能做的只有留痕。
        console.error('[root]', error, info.componentStack)
      }}
    >
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
