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
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layout'
import QueuePage from './pages/QueuePage'
import ProvidersPage from './pages/ProvidersPage'
import OverviewPage from './pages/OverviewPage'
import SettingsPage from './pages/SettingsPage'

type PageKey = 'queue' | 'providers' | 'overview' | 'settings'
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
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success animate-pulse" />
              {!collapsed && <span>服务运行中 · 9300</span>}
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
        {activePage === 'queue' && <QueuePage />}
        {activePage === 'providers' && <ProvidersPage />}
        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'settings' && <SettingsPage />}
      </AppLayout>
    </TooltipProvider>
  )
}

export default App
