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
  { key: 'providers', label: '供应商', icon: Plug, section: '主要' },
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
      <div className="flex h-screen w-full bg-background text-foreground">
        {/* 侧边栏 */}
        <aside
          className={cn(
            'relative flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-300',
            collapsed ? 'w-16' : 'w-60'
          )}
        >
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <CircleDot size={20} />
            </div>
            {!collapsed && (
              <div className="flex flex-col overflow-hidden">
                <h1 className="text-base font-semibold leading-tight">One Switch</h1>
                <p className="text-xs text-muted-foreground">本地大模型代理切换</p>
              </div>
            )}
          </div>

          {/* 导航 */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-4">
            {sections.map(section => (
              <div key={section}>
                {!collapsed && (
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {section}
                  </div>
                )}
                <div className="space-y-1">
                  {navItems
                    .filter(i => i.section === section)
                    .map(item => {
                      const ItemIcon = item.icon
                      const btn = (
                        <button
                          key={item.key}
                          onClick={() => setActivePage(item.key)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            activePage === item.key
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                            collapsed && 'justify-center px-0'
                          )}
                        >
                          <ItemIcon size={18} className="shrink-0" />
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
          <div className="border-t border-sidebar-border p-2 space-y-1">
            {/* 主题切换 */}
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleTheme}
                  className={cn('w-full justify-start', collapsed && 'justify-center px-0')}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
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
                'flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground',
                collapsed && 'justify-center'
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />
              {!collapsed && <span>服务运行中 · 9300</span>}
            </div>
          </div>

          {/* 折叠按钮 */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-3 top-6 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground transition-colors"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
          </button>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-4 md:p-5">
            {activePage === 'queue' && <QueuePage />}
            {activePage === 'providers' && <ProvidersPage />}
            {activePage === 'overview' && <OverviewPage />}
            {activePage === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}

export default App
