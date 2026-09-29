import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/provider'
import { appNavigationItems, type AppNavigationItem } from '@/routing/navigation'
import { type AppNavPath } from '@/routing/routes'
import type { UiCatalogKey } from '@common/i18n/catalogs'

export type Theme = 'light' | 'dark'
export type ThemeMode = 'system' | Theme

interface IndicatorRect {
  top: number
  height: number
}

interface AppSidebarProps {
  showBrand: boolean
  theme: Theme
  proxyRunning: boolean
  proxyPort?: number
  onToggleTheme: () => void
  /** 展开态由上层维护，让侧栏宽度和主内容网格列同步变化。 */
  expanded: boolean
  onHoverChange: (hovered: boolean) => void
  /** 钉住时侧栏不再跟鼠标进出，一直保持推开。见 `AppUiState.sidebarPinned`。 */
  pinned: boolean
  onTogglePinned: () => void
}

/**
 * 折叠轨道上的文字开关。
 *
 * 标签不能靠 `hidden` 切换（宽度会突然归零，轨道跟着抽一下），而是靠 `truncate`：
 * `overflow: hidden` 会让 flex 里的 `min-width: auto` 解析为 0，于是折叠态标签宽度被压到 0、
 * 展开态拿到自然宽度。淡入延迟 100ms 是为了等轨道（200ms）基本推完再显字，
 * 否则中途能看到被截掉一半的文字。
 */
function revealClassName(expanded: boolean) {
  return cn(
    'truncate transition-opacity duration-150 motion-reduce:transition-none',
    expanded ? 'opacity-100 delay-100' : 'opacity-0',
  )
}

export function AppSidebar(props: AppSidebarProps) {
  const t = useTranslation()
  const expanded = props.expanded
  const pathname = useRouterState({ select: state => state.location.pathname })
  const [focusedKey, setFocusedKey] = useState<AppNavPath | null>(null)
  const [hoveredKey, setHoveredKey] = useState<AppNavPath | null>(null)
  const [hoverRect, setHoverRect] = useState<IndicatorRect | null>(null)
  const [activeRect, setActiveRect] = useState<IndicatorRect | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef(new Map<AppNavPath, HTMLAnchorElement>())
  const navSections = appNavigationItems.reduce<Array<{ key: UiCatalogKey; items: AppNavigationItem[] }>>((sections, item) => {
    const currentSection = sections.at(-1)
    if (currentSection?.key === item.sectionKey) {
      currentSection.items.push(item)
    } else {
      sections.push({ key: item.sectionKey, items: [item] })
    }
    return sections
  }, [])
  const activeKey = appNavigationItems.find(item => pathname === item.to || pathname.startsWith(`${item.to}/`))?.to ?? null

  useLayoutEffect(() => {
    const measureItem = (key: AppNavPath): IndicatorRect | null => {
      const nav = navRef.current
      const item = itemRefs.current.get(key)
      if (!nav || !item) return null

      const navRect = nav.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      return {
        top: itemRect.top - navRect.top + nav.scrollTop,
        height: itemRect.height,
      }
    }

    const updateIndicators = () => {
      if (activeKey) setActiveRect(measureItem(activeKey))
      if (hoveredKey) setHoverRect(measureItem(hoveredKey))
    }

    updateIndicators()

    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateIndicators)
    observer.observe(nav)
    for (const item of itemRefs.current.values()) observer.observe(item)
    window.addEventListener('resize', updateIndicators)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateIndicators)
    }
  }, [activeKey, expanded, hoveredKey])

  return (
    <div
      data-slot="app-sidebar"
      data-expanded={expanded ? 'true' : undefined}
      data-pinned={props.pinned ? 'true' : undefined}
      onPointerEnter={() => props.onHoverChange(true)}
      onPointerLeave={() => props.onHoverChange(false)}
      className={cn(
        'absolute inset-y-0 left-0 flex min-h-0 w-12 flex-col overflow-hidden text-sidebar-foreground',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        expanded && 'w-56',
      )}
    >
      {props.showBrand && (
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-3">
          <img src="icon.svg" alt="" className="size-6 shrink-0" />
          <div className="min-w-0">
            <h1 className={cn('system-sm-semibold text-sidebar-foreground', revealClassName(expanded))}>{t('app.windowTitle')}</h1>
            <p className={cn('font-mono system-2xs-medium-uppercase tracking-[1.2px] text-sidebar-foreground/60', revealClassName(expanded))}>{t('app.tagline')}</p>
          </div>
        </div>
      )}

      <nav
        ref={navRef}
        className={cn('relative min-h-0 flex-1 space-y-2 overflow-y-auto p-1.5', !props.showBrand && 'pt-2.5')}
        onPointerLeave={() => setHoveredKey(null)}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-1.5 right-1.5 top-0 z-0 rounded-lg bg-sidebar-accent/50',
            'transition-[transform,height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          )}
          style={{
            height: hoverRect ? `${hoverRect.height}px` : 0,
            opacity: hoveredKey && hoveredKey !== activeKey && hoverRect ? 1 : 0,
            transform: `translateY(${hoverRect?.top ?? 0}px)`,
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-1.5 right-1.5 top-0 z-0 rounded-lg bg-sidebar-accent',
            'transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          )}
          style={{
            height: activeRect ? `${activeRect.height}px` : 0,
            opacity: activeRect ? 1 : 0,
            transform: `translateY(${activeRect?.top ?? 0}px)`,
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-0 h-4 w-0.5 rounded-full bg-sidebar-primary',
            'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          )}
          style={{
            opacity: activeRect ? 1 : 0,
            transform: activeRect
              ? `translateY(${activeRect.top + (activeRect.height - 16) / 2}px)`
              : 'translateY(0)',
          }}
        />
        {navSections.map(section => (
          <section key={section.key}>
            {/*
             * 分组标题固定 16px 高：折叠态只藏文字、不塌陷高度，
             * 这样 hover 展开时导航项不会整体上下跳（旧实现是 `h-2` ↔ `h-5` 动画）。
             */}
            <div className="relative mb-1 flex h-4 items-center px-2.5">
              <h2 className={cn('absolute inset-x-2.5 top-1/2 -translate-y-1/2 system-2xs-medium-uppercase tracking-[1.2px] text-sidebar-foreground/60', revealClassName(expanded))}>
                {t(section.key)}
              </h2>
            </div>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const ItemIcon = item.icon
                return (
                  <Tooltip key={item.to} open={!expanded && focusedKey === item.to}>
                    <TooltipTrigger asChild>
                      {/*
                       * 导航交给 router 的 `Link`：目标路径直接写在 `to` 上，
                       * active 状态与 `aria-current` 由 Link 根据当前路由自动注入，
                       * 不再由父级传 `activePage` / `onNavigate`。
                       * `includeSearch: false`：`/overview` 这类页面带 `?range=`，搜索参数变化不应影响高亮。
                       */}
                      <Link
                        to={item.to}
                        ref={node => {
                          if (node) itemRefs.current.set(item.to, node)
                          else itemRefs.current.delete(item.to)
                        }}
                        activeOptions={{ includeSearch: false }}
                        aria-label={t(item.labelKey)}
                        onPointerEnter={() => setHoveredKey(item.to)}
                        onFocus={event => {
                          // 只认键盘聚焦：鼠标点出来的聚焦由 hover 展开接管，不需要 tooltip。
                          if (event.currentTarget.matches(':focus-visible')) {
                            setFocusedKey(item.to)
                            setHoveredKey(item.to)
                          }
                        }}
                        onBlur={() => {
                          setFocusedKey(current => (current === item.to ? null : current))
                          setHoveredKey(current => (current === item.to ? null : current))
                        }}
                        className={cn(
                          'relative z-10 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 outline-none transition-colors',
                          'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                        )}
                        activeProps={{ className: 'system-xs-semibold text-sidebar-accent-foreground' }}
                        inactiveProps={{ className: 'system-xs-medium text-sidebar-foreground/80 hover:text-sidebar-accent-foreground' }}
                      >
                        <ItemIcon className="size-4 shrink-0" aria-hidden="true" />
                        <span className={revealClassName(expanded)}>{t(item.labelKey)}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>{t(item.labelKey)}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 p-1.5">
        {/**
         * 钉住开关长在脚注区最上面一行，和主题、运行状态同一族外壳（`h-9 / px-2.5 / gap-2.5 / size-4`）：
         * 它管的是这个侧栏自己，而上面那三组管的是页面 —— 既然不是同类，就归到脚注里。
         *
         * 钉住时它用和导航项激活态一样的那套（`bg-sidebar-accent` + `semibold`）：
         * 「现在钉着」是一个持续生效的状态，得一直看得见，而不是只在按下那一瞬间给个反馈；
         * 图标同时换成 `PinOff`（点一下会取消），所以状态和动作各有一个说法，不靠颜色单独表意。
         */}
        <button
          type="button"
          aria-pressed={props.pinned}
          aria-label={t(props.pinned ? 'nav.sidebar.unpin' : 'nav.sidebar.pin')}
          onClick={props.onTogglePinned}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
            'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            props.pinned
              ? 'bg-sidebar-accent system-xs-semibold text-sidebar-accent-foreground'
              : 'system-xs-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
          )}
        >
          {props.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          <span className={revealClassName(expanded)}>{t(props.pinned ? 'nav.sidebar.unpin' : 'nav.sidebar.pin')}</span>
        </button>
        <AnimatedThemeToggler
          theme={props.theme}
          onThemeChange={() => props.onToggleTheme()}
          className={cn(
            // `[&_svg]:shrink-0` 是必需的：折叠态轨道只剩 48px，flex 会把没有 min-width 的 svg 压成一条 1px 竖线。
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
            'system-xs-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
            'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          )}
        >
          <span className={revealClassName(expanded)}>{props.theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}</span>
        </AnimatedThemeToggler>
        {/*
         * 运行状态不单独圈框：它和上面的主题切换是同一族的脚注行，用一模一样的
         * `h-9 / px-2.5 / gap-2.5` 外壳 + `size-4` 前导图标盒。折叠态下小圆点就落在这条轨道的
         * 图标中线上（边框会额外吃掉 1px，圆点会整体右偏、和上面的图标错开）。
         */}
        <div className="flex h-9 w-full items-center gap-2.5 px-2.5">
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={cn('size-2 rounded-full', props.proxyRunning ? 'animate-pulse bg-success motion-reduce:animate-none' : 'bg-sidebar-foreground/30')} />
          </span>
          <span className={cn('system-2xs-regular text-sidebar-foreground/80', revealClassName(expanded))}>
            {props.proxyRunning ? t('nav.status.running', { port: props.proxyPort ?? 0 }) : t('nav.status.stopped')}
          </span>
        </div>
      </div>
    </div>
  )
}
