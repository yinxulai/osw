import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BreadcrumbTrail, usePageBreadcrumb, usePageBreadcrumbs } from '@/components/breadcrumbs'
import { getPlatformCapabilities } from '@/platform/capabilities'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

interface PageHeaderProps {
  title: string
  /**
   * 紧跟在标题后面的控件。
   *
   * 与 `actions` 的区别是它属于**标题本身**而不是页面的操作：切换标题指的是哪个对象（如路由的两种模式）
   * 应该紧跟标题，而「试运行 / 新建」这类动作在右侧。两者位置不同，是因为读完标题后的下一个问题是
   * 「现在看的是哪一个」，而不是「能做什么」。
   */
  titleAdornment?: ReactNode
  description?: string
  actions?: ReactNode
  /** 当前页面对应的动态层级名称；父级层级由路由自动提供。 */
  breadcrumb?: string
  className?: string
}

interface PageContentProps {
  children: ReactNode
  className?: string
}

interface AppLayoutProps {
  sidebar: ReactNode
  /**
   * 侧边栏是否展开。
   *
   * hover 展开和固定展开都以占用真实布局宽度的方式推开正文。网格列与侧栏宽度使用同一时长过渡，
   * 避免内容已经让开、侧栏还没推到位时出现空档。
   */
  sidebarExpanded?: boolean
  children: ReactNode
}

export function AppLayout(props: AppLayoutProps) {
  const { sidebar, sidebarExpanded = false, children } = props
  return (
    <div
      className={cn(
        'grid h-full w-full overflow-hidden bg-sidebar text-foreground',
        'transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
        sidebarExpanded ? 'grid-cols-[14rem_minmax(0,1fr)]' : 'grid-cols-[3rem_minmax(0,1fr)]',
      )}
    >
      <aside className="relative z-30 min-h-0 overflow-visible text-sidebar-foreground">
        {sidebar}
      </aside>
      <main className="relative isolate min-h-0 min-w-0 p-2 pl-1">
        <div className="relative h-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-card shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
          <div className="relative z-10 mx-auto h-full w-full max-w-7xl px-6 py-5">{children}</div>
        </div>
      </main>
    </div>
  )
}

export function PageLayout(props: PageLayoutProps) {
  const { children, className } = props
  return <div className={cn('space-y-5', className)}>{children}</div>
}

export function PageHeader(props: PageHeaderProps) {
  const { title, titleAdornment, description, actions, breadcrumb, className } = props
  const isElectron = getPlatformCapabilities().name === 'electron'
  const breadcrumbs = usePageBreadcrumbs()
  usePageBreadcrumb(breadcrumb)

  return (
    <header
      className={cn(
        'sticky top-0 z-20 -mx-6 -mt-5 flex flex-col gap-2 border-b border-border/50 bg-card/95 px-6 pt-5 pb-3 backdrop-blur-sm',
        'sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        {!isElectron && breadcrumbs.length > 1 && (
          <BreadcrumbTrail items={breadcrumbs} className="mb-2 system-xs-regular" />
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="system-xl-semibold text-text-primary">{title}</h1>
          {titleAdornment}
        </div>
        {description && <p className="mt-1 system-xs-regular text-text-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageContent(props: PageContentProps) {
  const { children, className } = props
  return <section className={cn('grid gap-4', className)}>{children}</section>
}
