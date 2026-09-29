import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BreadcrumbTrail, usePageBreadcrumbs, type PageBreadcrumb } from '@/components/breadcrumbs'
import { getPlatformCapabilities } from '@/platform/capabilities'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

export type { PageBreadcrumb } from '@/components/breadcrumbs'

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
  breadcrumbs?: PageBreadcrumb[]
  className?: string
}

interface PageContentProps {
  children: ReactNode
  className?: string
}

interface AppLayoutProps {
  sidebar: ReactNode
  /**
   * 侧边栏是否被钉住。
   *
   * 不钉时轨道只留 48px，展开的那 14rem 由侧栏自己 `absolute` 铺出去盖在内容上 —— 这是对的：
   * 扫一眼就收起的浮层不该把正文挤走。钉住则刚好相反，用户要的是它**一直在**，
   * 那就得让轨道真的占宽，否则侧栏永远盖住左边 176px 的内容。
   *
   * 轨道宽度跟着一起过渡：侧栏自己的宽度是 200ms 过渡的，轨道若瞬移就会出现
   * 「内容已经让开了、侧栏还没推到位」的那一帧空档，两边同一个时长就同步了。
   */
  sidebarPinned?: boolean
  children: ReactNode
}

export function AppLayout(props: AppLayoutProps) {
  const { sidebar, sidebarPinned = false, children } = props
  return (
    <div
      className={cn(
        'grid h-full w-full overflow-hidden bg-background text-foreground',
        'transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
        sidebarPinned ? 'grid-cols-[14rem_minmax(0,1fr)]' : 'grid-cols-[3rem_minmax(0,1fr)]',
      )}
    >
      <aside className="relative z-30 min-h-0 overflow-visible bg-background text-sidebar-foreground">
        {sidebar}
      </aside>
      <main className="relative isolate min-w-0 overflow-auto overscroll-contain">
        <div className="relative z-10 mx-auto min-h-full w-full max-w-7xl px-6 py-5">{children}</div>
      </main>
    </div>
  )
}

export function PageLayout(props: PageLayoutProps) {
  const { children, className } = props
  return <div className={cn('space-y-5', className)}>{children}</div>
}

export function PageHeader(props: PageHeaderProps) {
  const { title, titleAdornment, description, actions, breadcrumbs, className } = props
  const isElectron = getPlatformCapabilities().name === 'electron'
  usePageBreadcrumbs(breadcrumbs)

  return (
    <header
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        {!isElectron && breadcrumbs && breadcrumbs.length > 0 && (
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
