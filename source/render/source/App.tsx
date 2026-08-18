import { useState, useEffect } from 'react'
import {
  Layers,
  Settings,
  BarChart3,
  Plug,
  CircleDot,
  Moon,
  Sun,
  SquareTerminal,
  History,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { ToastProvider } from '@/components/ui/toast'
import { AppLayout } from '@/components/layout'
import { QueueControlPage } from './pages/queue-control/page'
import { ModelManagementPage } from './pages/model-management/page'
import { OverviewPage } from './pages/overview/page'
import { RuntimeSettingsPage } from './pages/runtime-settings/page'
import { LogsPage } from './pages/logs/page'
import { RequestLogsPage } from './pages/request-logs/page'
import { proxyApi } from './api'
import type { ProxyServerStatus } from '@common/schemas'

type PageKey = 'queue' | 'providers' | 'overview' | 'requests' | 'settings' | 'logs'
type Theme = 'light' | 'dark'

interface NavItem {
  key: PageKey
  label: string
  icon: LucideIcon
  section?: string
}

const navItems: NavItem[] = [
  { key: 'queue', label: '模型队列', icon: Layers, section: '主要' },
  { key: 'providers', label: '模型管理', icon: Plug, section: '主要' },
  { key: 'overview', label: '统计分析', icon: BarChart3, section: '数据' },
  { key: 'requests', label: '请求记录', icon: History, section: '数据' },
  { key: 'logs', label: '运行日志', icon: SquareTerminal, section: '系统' },
  { key: 'settings', label: '设置', icon: Settings, section: '系统' },
]

function App() {
  const [activePage, setActivePage] = useState<PageKey>('queue')
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved) return saved
    return 'dark'
  })
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const refreshStatus = async () => {
      const result = await proxyApi.status()
      if (!cancelled && result.success) setProxyStatus(result.data)
    }
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activePage])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const sections = Array.from(new Set(navItems.map(i => i.section || ''))).filter(Boolean)

  return (
    <ToastProvider>
    <TooltipProvider>
      <AppLayout
        sidebar={(
          <aside
          className="group/sidebar absolute inset-y-0 left-0 z-30 flex w-12 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out *:w-56 hover:w-56"
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 border-b border-sidebar-border px-3 py-3.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <CircleDot size={15} />
            </div>
            <div className="flex flex-1 flex-col overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75">
              <h1 className="text-sm font-medium leading-tight tracking-tight">One Switch</h1>
              <p className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted-foreground">local ai gateway</p>
            </div>
          </div>

          {/* 导航 */}
          <nav className="flex-1 overflow-y-auto p-1.5 space-y-3">
            {sections.map(section => (
              <div key={section}>
                <div className="relative h-6 text-sidebar-foreground/60">
                  <span className="absolute left-2.5 top-1/2 h-px w-4 -translate-y-1/2 rounded-full bg-current opacity-100 transition-opacity duration-150 delay-75 group-hover/sidebar:opacity-0 group-hover/sidebar:delay-0" />
                  <span className="absolute inset-x-0 px-2.5 py-1 font-mono text-[10px] font-normal uppercase tracking-wider opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75">
                    {section}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {navItems
                    .filter(i => i.section === section)
                    .map(item => {
                      const ItemIcon = item.icon
                      return (
                        <button
                          key={item.key}
                          onClick={() => setActivePage(item.key)}
                          title={item.label}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-xs font-medium transition-colors',
                            activePage === item.key
                              ? 'border-sidebar-primary/25 bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          <ItemIcon size={15} className="shrink-0" />
                          <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75">{item.label}</span>
                        </button>
                      )
                    })}
                </div>
              </div>
            ))}
          </nav>

          {/* 底部 */}
          <div className="border-t border-sidebar-border p-1.5 space-y-0.5">
            {/* 主题切换 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="w-full justify-start"
              aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
            </Button>

            {/* 服务状态 */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground"
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', proxyStatus?.running ? 'bg-success animate-pulse' : 'bg-muted-foreground/50')} />
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75">{proxyStatus?.running ? `服务运行中 · ${proxyStatus.port}` : '服务已停止'}</span>
            </div>
          </div>
          </aside>
        )}
      >
        {activePage === 'queue' && <QueueControlPage onNavigateToModels={() => setActivePage('providers')} />}
        {activePage === 'providers' && <ModelManagementPage />}
        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'requests' && <RequestLogsPage />}
        {activePage === 'logs' && <LogsPage />}
        {activePage === 'settings' && <RuntimeSettingsPage />}
      </AppLayout>
    </TooltipProvider>
    </ToastProvider>
  )
}

export default App
