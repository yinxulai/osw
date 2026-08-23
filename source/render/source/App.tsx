import { useState, useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { AppLayout } from '@/components/layout'
import { AppSidebar, type Theme } from '@/components/app-sidebar'
import { useAppUiStore } from '@/store/app-ui-store'
import { QueueControlPage } from './pages/queue-control/page'
import { ModelManagementPage } from './pages/model-management/page'
import { OverviewPage } from './pages/overview/page'
import { RuntimeSettingsPage } from './pages/runtime-settings/page'
import { LogsPage } from './pages/logs/page'
import { RequestLogsPage } from './pages/request-logs/page'
import { ModificationRulesPage } from './pages/modification-rules/page'
import { useProxyStatus } from './features/proxy/hooks'

function App() {
  const activePage = useAppUiStore(state => state.activePage)
  const setActivePage = useAppUiStore(state => state.setActivePage)
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)
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
  }, [theme])

  const toggleTheme = () => setThemeMode(theme === 'dark' ? 'light' : 'dark')

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
          {activePage === 'rules' && <ModificationRulesPage />}
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
