import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { AppLayout } from '@/components/layout'
import { AppSidebar, type PageKey, type Theme } from '@/components/app-sidebar'
import { useAppUiStore } from '@/store/app-ui-store'
import { useProxyStatus } from './features/proxy/hooks'

const pagePaths = {
  queue: '/queue',
  providers: '/providers',
  access: '/access',
  rules: '/rules',
  overview: '/overview',
  requests: '/requests',
  settings: '/settings',
  logs: '/logs',
} as const satisfies Record<PageKey, string>

function App() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const activePage = (pathname.split('/').filter(Boolean)[0] || 'queue') as PageKey
  const navigate = useNavigate()
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)
  const [systemTheme, setSystemTheme] = useState<Theme>('light')
  const proxyStatus = useProxyStatus()

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

  return (
    <ToastProvider>
      <ConfirmProvider>
        <TooltipProvider>
          <AppLayout
            sidebar={(
              <AppSidebar
                activePage={activePage}
                theme={theme}
                proxyRunning={proxyStatus?.running ?? false}
                proxyPort={proxyStatus?.port}
                onNavigate={page => void navigate({ to: pagePaths[page] })}
                onToggleTheme={toggleTheme}
              />
            )}
          >
            <Outlet />
          </AppLayout>
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
