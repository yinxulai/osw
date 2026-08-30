import {
  ChartColumnIncreasing,
  ClipboardList,
  Cog,
  Database,
  ListOrdered,
  Plug,
  ScrollText,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler'
import { buttonVariants } from '@/components/ui/button'

export type PageKey = 'queue' | 'providers' | 'access' | 'rules' | 'overview' | 'requests' | 'settings' | 'logs'
export type Theme = 'light' | 'dark'
export type ThemeMode = 'system' | Theme

interface NavItem {
  key: PageKey
  label: string
  icon: LucideIcon
  section: string
}

interface AppSidebarProps {
  activePage: PageKey
  theme: Theme
  proxyRunning: boolean
  proxyPort?: number
  onNavigate: (page: PageKey) => void
  onToggleTheme: () => void
}

const baseNavItems: NavItem[] = [
  { key: 'queue', label: '模型队列', icon: ListOrdered, section: '主要' },
  { key: 'providers', label: '模型管理', icon: Database, section: '主要' },
  { key: 'overview', label: '统计分析', icon: ChartColumnIncreasing, section: '数据' },
  { key: 'requests', label: '请求记录', icon: ClipboardList, section: '数据' },
  { key: 'rules', label: '请求修改', icon: SlidersHorizontal, section: '高级' },
  { key: 'access', label: '接入配置', icon: Plug, section: '系统' },
  { key: 'logs', label: '运行日志', icon: ScrollText, section: '系统' },
  { key: 'settings', label: '设置', icon: Cog, section: '系统' },
]

export function AppSidebar(props: AppSidebarProps) {
  const navSections = baseNavItems.reduce<Array<{ label: string; items: NavItem[] }>>((sections, item) => {
    const currentSection = sections.at(-1)
    if (currentSection?.label === item.section) {
      currentSection.items.push(item)
    } else {
      sections.push({ label: item.section, items: [item] })
    }
    return sections
  }, [])

  return (
    <div data-slot="app-sidebar" className="group/sidebar absolute inset-y-0 left-0 flex w-12 min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out hover:w-56 motion-reduce:transition-none">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-3">
        <img src="icon.svg" alt="" className="size-6 shrink-0 transition-[width,height] duration-200 ease-out group-hover/sidebar:size-7 motion-reduce:transition-none" />
        <div className="min-w-0 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">
          <h1 className="truncate text-sm font-medium leading-tight tracking-tight">One Switch</h1>
          <p className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted-foreground">local ai gateway</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto p-1.5">
        {navSections.map(section => (
          <section key={section.label}>
            <h2 className="mb-1 flex h-2 items-center justify-start px-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50 transition-[height] duration-150 group-hover/sidebar:h-5 motion-reduce:transition-none">
              <span className="px-1 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{section.label}</span>
            </h2>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const ItemIcon = item.icon
                const active = props.activePage === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => props.onNavigate(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <ItemIcon className="size-3.5 shrink-0" />
                    <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 p-1.5">
        <AnimatedThemeToggler
          theme={props.theme}
          onThemeChange={() => props.onToggleTheme()}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-full justify-start gap-2.5 px-2.5')}
        >
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{props.theme === 'dark' ? '浅色模式' : '深色模式'}</span>
        </AnimatedThemeToggler>
        <div className="flex h-7 items-center gap-2.5 px-2.5 text-[11px] text-muted-foreground">
          <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={cn('size-1.5 rounded-full', props.proxyRunning ? 'animate-pulse bg-success motion-reduce:animate-none' : 'bg-muted-foreground/50')} />
          </span>
          <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-75 motion-reduce:transition-none">{props.proxyRunning ? `服务运行中 · ${props.proxyPort ?? 0}` : '服务已停止'}</span>
        </div>
      </div>
    </div>
  )
}
