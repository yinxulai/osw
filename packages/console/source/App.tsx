import { useEffect, useState } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { AppLayout } from '@/components/layout'
import { ErrorBoundary, ErrorFallback } from '@/components/error-boundary'
import { AppSidebar, type Theme } from '@/components/app-sidebar'
import { OnboardingTopbar } from '@/pages/onboarding/onboarding-topbar'
import { ONBOARDING_ACTION_BAR_CLEARANCE } from '@/pages/onboarding/page'
import { useAppUiStore } from '@/store/app-ui-store'
import { useTranslation } from '@/i18n/provider'
import { RouteModeDialog } from '@/components/route-mode/route-mode-dialog'
import { useProxyStatus } from '@/data/proxy'
import { routePaths } from '@/routing/routes'

function App() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)
  const sidebarPinned = useAppUiStore(state => state.sidebarPinned)
  const setSidebarPinned = useAppUiStore(state => state.setSidebarPinned)
  const [systemTheme, setSystemTheme] = useState<Theme>('light')
  const proxyStatus = useProxyStatus()
  const t = useTranslation()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light')
    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  const theme: Theme = themeMode === 'system' ? systemTheme : themeMode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = () => setThemeMode(theme === 'dark' ? 'light' : 'dark')

  // 引导页是覆盖整个应用的「特殊层」：不带侧边栏、右上角固定主题与语言切换。
  // 不经过 AppLayout，因此它压在任何普通页面之上。
  const isOnboarding = pathname === routePaths.onboarding

  return (
    <ToastProvider bottomOffset={isOnboarding ? ONBOARDING_ACTION_BAR_CLEARANCE : undefined}>
      <ConfirmProvider>
        <TooltipProvider>
          {isOnboarding ? (
            <>
              <div className="fixed inset-0 z-40 overflow-auto bg-background text-foreground">
                <div className="fixed right-4 top-4 z-50">
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
            </>
          ) : (
            <AppLayout
              sidebarPinned={sidebarPinned}
              sidebar={(
                <AppSidebar
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
          )}

          {/*
           * 路由模式弹窗挂在这里，而不挂在某个页面上：它的入口分布在不相关的两处
           * （页头标题旁的图标、设置页的一行），能打开的必须是同一个弹窗。
           * 挂在 `AppLayout` 外、`TooltipProvider` 内：它不属于任何一页，但两者都在同一棵树下。
           */}
          <RouteModeDialog />
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
