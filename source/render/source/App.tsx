import { useState, useEffect } from 'react'
import {
  Layers,
  Settings,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  CircleDot,
  Moon,
  Sun,
  SquareTerminal,
  History,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
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
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved) return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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

  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 900) {
        setCollapsed(true)
      }
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const sections = Array.from(new Set(navItems.map(i => i.section || ''))).filter(Boolean)

  return (
    <TooltipProvider>
      <AppLayout
        sidebar={(
          <aside
          className={cn(
            'relative flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-300',
            collapsed ? 'w-12' : 'w-48'
          )}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-3 py-3 border-b border-sidebar-border">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <CircleDot size={15} />
            </div>
            {!collapsed && (
              <div className="flex flex-col overflow-hidden">
                <h1 className="text-sm font-semibold leading-tight">One Switch</h1>
                <p className="text-[11px] text-muted-foreground">本地大模型代理切换</p>
              </div>
            )}
          </div>

          {/* 导航 */}
          <nav className="flex-1 overflow-y-auto p-1.5 space-y-3">
            {sections.map(section => (
              <div key={section}>
                {!collapsed && (
                  <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {section}
                  </div>
                )}
                <div className="space-y-0.5">
                  {navItems
                    .filter(i => i.section === section)
                    .map(item => {
                      const ItemIcon = item.icon
                      const btn = (
                        <button
                          key={item.key}
                          onClick={() => setActivePage(item.key)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors',
                            activePage === item.key
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                            collapsed && 'justify-center px-0'
                          )}
                        >
                          <ItemIcon size={15} className="shrink-0" />
                          {!collapsed && <span>{item.label}</span>}
                        </button>
                      )
                      return collapsed ? (
                        <Tooltip key={item.key} delayDuration={200}>
                          <TooltipTrigger asChild>{btn}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        btn
                      )
                    })}
                </div>
              </div>
            ))}
          </nav>

          {/* 底部 */}
          <div className="border-t border-sidebar-border p-1.5 space-y-0.5">
            {/* 主题切换 */}
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleTheme}
                  className={cn('w-full justify-start h-7 text-xs', collapsed && 'justify-center px-0')}
                >
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                  {!collapsed && <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  {theme === 'dark' ? '切换到浅色' : '切换到深色'}
                </TooltipContent>
              )}
            </Tooltip>

            {/* 服务状态 */}
            <div
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground',
                collapsed && 'justify-center'
              )}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', proxyStatus?.running ? 'bg-success animate-pulse' : 'bg-muted-foreground/50')} />
              {!collapsed && <span>{proxyStatus?.running ? `服务运行中 · ${proxyStatus.port}` : '服务已停止'}</span>}
            </div>
          </div>

          {/* 折叠按钮 */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-2.5 top-5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground transition-colors"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen size={11} /> : <PanelLeftClose size={11} />}
          </button>
          </aside>
        )}
      >
        {activePage === 'queue' && <QueueControlPage />}
        {activePage === 'providers' && <ModelManagementPage />}
        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'requests' && <RequestLogsPage />}
        {activePage === 'logs' && <LogsPage />}
        {activePage === 'settings' && <RuntimeSettingsPage />}
      </AppLayout>
    </TooltipProvider>
  )
}

export default App
