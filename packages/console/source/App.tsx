import { useEffect } from 'react'
import { Outlet, useMatchRoute, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { AppLayout } from '@/components/layout'
import { ErrorBoundary, ErrorFallback } from '@/components/error-boundary'
import { AppSidebar } from '@/components/app-sidebar'
import { OnboardingTopbar } from '@/pages/onboarding/onboarding-topbar'
import { ONBOARDING_ACTION_BAR_CLEARANCE } from '@/pages/onboarding/page'
import { useAppUiStore } from '@/store/app-ui-store'
import { useTranslation } from '@/i18n/provider'
import { RouteModeDialog } from '@/components/route-mode/route-mode-dialog'
import { WindowTitlebar } from '@/components/window-titlebar'
import { PageBreadcrumbsProvider } from '@/components/breadcrumbs'
import { LiveRequestsProvider } from '@/data/live-requests'
import { useProxyStatus } from '@/data/proxy'
import { findCurrentNavigationItem } from '@/routing/navigation'
import { routePaths } from '@/routing/routes'
import { useAppearance, useAppearanceUrlSync } from '@/hooks/use-appearance'
import { getPlatformCapabilities } from '@/platform/capabilities'

function App() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const matchRoute = useMatchRoute()
  const sidebarPinned = useAppUiStore(state => state.sidebarPinned)
  const setSidebarPinned = useAppUiStore(state => state.setSidebarPinned)
  const { theme, toggleTheme } = useAppearance()
  const proxyStatus = useProxyStatus()
  const t = useTranslation()
  const isElectron = getPlatformCapabilities().name === 'electron'
  const currentPage = findCurrentNavigationItem(pathname)
  const windowTitle = currentPage ? t(currentPage.labelKey) : t('app.windowTitle')

  // 地址栏的补齐只在这里挂一次（理由见 hook 内部注释），避免每个用到 `useAppearance`
  // 的组件各自发一次跳转。
  useAppearanceUrlSync()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    getPlatformCapabilities().setTheme?.(theme)
  }, [theme])

  // 引导页是覆盖整个应用的「特殊层」：不带侧边栏、右上角固定主题与语言切换。
  // 不经过 AppLayout，因此它压在任何普通页面之上。
  //
  // 用 `matchRoute` 而不是比较 `pathname`：`routePaths` 里是干净的路径，语言与主题在查询串里，
  // 于是 `/onboarding?lang=zh-CN` 也能被认出来，`matchRoute` 已经处理了这一点。
  const isOnboarding = Boolean(matchRoute({ to: routePaths.onboarding }))
  const needsLiveRequests = pathname === routePaths.logicalModels || pathname === routePaths.requestLogs

  return (
    <ToastProvider bottomOffset={isOnboarding ? ONBOARDING_ACTION_BAR_CLEARANCE : undefined}>
      <ConfirmProvider>
        <TooltipProvider>
          <PageBreadcrumbsProvider>
            <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
              {isElectron && (
                <WindowTitlebar
                  title={windowTitle}
                  proxyRunning={proxyStatus?.running ?? false}
                  proxyPort={proxyStatus?.port}
                />
              )}
              <div className="relative min-h-0 flex-1">
                {isOnboarding ? (
                  <div className="h-full overflow-auto bg-background text-foreground">
                    <div className={isElectron ? 'fixed right-4 top-15 z-50' : 'fixed right-4 top-4 z-50'}>
                      <OnboardingTopbar theme={theme} onToggleTheme={toggleTheme} />
                    </div>
                    <ErrorBoundary
                      resetKeys={[pathname]}
                      fallback={fallbackProps => (
                        <ErrorFallback
                          {...fallbackProps}
                          embedded
                          title={t('common.error.pageTitle')}
                          description={t('common.error.pageDescription')}
                        />
                      )}
                    >
                      <Outlet />
                    </ErrorBoundary>
                  </div>
                ) : (
                  <LiveRequestsProvider enabled={needsLiveRequests}>
                    <AppLayout
                      sidebarPinned={sidebarPinned}
                      sidebar={(
                        <AppSidebar
                          showBrand={!isElectron}
                          theme={theme}
                          onToggleTheme={toggleTheme}
                          proxyPort={proxyStatus?.port}
                          proxyRunning={proxyStatus?.running ?? false}
                          pinned={sidebarPinned}
                          onTogglePinned={() => setSidebarPinned(!sidebarPinned)}
                        />
                      )}
                    >
                      {/*
                       * 内层再兜一道：路由级错误会被这里拦截，侧栏与顶部导航继续可用，
                       * 用户切到别的页面就自动恢复（`resetKeys` 是当前路径）。
                       * `routing.tsx` 里的根路由 `errorComponent` 是外层保险，
                       * 作用于 App 自身（包括侧栏、各种 Provider）抛错的情况。
                       */}
                      <ErrorBoundary
                        resetKeys={[pathname]}
                        fallback={fallbackProps => (
                          <ErrorFallback
                            {...fallbackProps}
                            embedded
                            title={t('common.error.pageTitle')}
                            description={t('common.error.pageDescription')}
                          />
                        )}
                      >
                        <Outlet />
                      </ErrorBoundary>
                    </AppLayout>
                  </LiveRequestsProvider>
                )}
              </div>

              {/*
               * 路由模式弹窗挂在这里，而不挂在某个页面上：它的入口分布在不相关的两处
               * （页头标题旁的图标、设置页的一行），能打开的必须是同一个弹窗。
               * 挂在 `AppLayout` 外、`TooltipProvider` 内：它不属于任何一页，但两者都在同一棵树下。
               */}
              <RouteModeDialog />
            </div>
          </PageBreadcrumbsProvider>
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
