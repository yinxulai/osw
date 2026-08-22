import { useState, useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { AppLayout } from '@/components/layout'
import { AppSidebar, type PageKey, type Theme, type ThemeMode } from '@/components/app-sidebar'
import { QueueControlPage } from './pages/queue-control/page'
import { ModelManagementPage } from './pages/model-management/page'
import { OverviewPage } from './pages/overview/page'
import { RuntimeSettingsPage } from './pages/runtime-settings/page'
import { LogsPage } from './pages/logs/page'
import { RequestLogsPage } from './pages/request-logs/page'
import { useProxyStatus } from './features/proxy/hooks'

function App() {
  const [activePage, setActivePage] = useState<PageKey>('queue')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    return 'system'
  })
  const [systemTheme, setSystemTheme] = useState<Theme>('light')
  const proxyStatus = useProxyStatus()

  // useProxyStatus 自身负责全局代理状态轮询

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light')
    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  const theme: Theme = themeMode === 'system' ? systemTheme : themeMode

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', themeMode)
  }, [theme, themeMode])

  const toggleTheme = () => setThemeMode(current => current === 'dark' ? 'light' : 'dark')

  return (
    <ToastProvider>
      <TooltipProvider>
        <AppLayout
          sidebar={(
            <AppSidebar
              activePage={activePage}
              theme={theme}
              proxyRunning={proxyStatus?.running ?? false}
              proxyPort={proxyStatus?.port}
              onNavigate={setActivePage}
              onToggleTheme={toggleTheme}
            />
          )}
        >
          {activePage === 'queue' && <QueueControlPage onNavigateToModels={() => setActivePage('providers')} />}
          {activePage === 'providers' && <ModelManagementPage />}
          {activePage === 'overview' && <OverviewPage />}
          {activePage === 'requests' && <RequestLogsPage />}
          {activePage === 'logs' && <LogsPage />}
          {activePage === 'settings' && (
            <RuntimeSettingsPage
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
            />
          )}
        </AppLayout>
      </TooltipProvider>
    </ToastProvider>
  )
}

export default App
