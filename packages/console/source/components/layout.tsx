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
  /** 截图锚点，用于局部取景（见 `apps/app/source/screenshot-sets.ts`）。 */
  dataScreenshot?: string
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
        {/*
          滚动容器用 flex 列 + 内层 `flex-1`，而不是内层 `h-full`。
          `h-full` 把内层盒子的高度锁成容器高度，内容一超高就变成「子元素溢出父元素」，
          滚动容器算不到真实内容高度（`scrollHeight` 只等于可视高度），底部的 `py-5`
          因此既不参与滚动、也拦不住内容——滚到底或内容本来就高时最后一块直接贴住底边。
          换成 `flex-1` 后：内容不足一屏时撑满一屏（路由画布靠它拿到确定高度，`h-full`
          才解析得出来），内容超高时盒子随内容长高，`py-5` 始终是真正的尾部留白。
        */}
        <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-canvas shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
          {/*
            正文**不设全局最大宽度**：统计、请求记录、日志、模型管理这些都是数据视图，
            宽屏下本来就该用满可用宽度。以前这里的 `max-w-7xl` + `mx-auto` 把所有页面
            锁在 1280px 并居中，宽窗口两侧留出一大块空白，页面内部再怎么自适应也没用。

            阅读宽度是**页面自己的事**：需要窄栏的页面在 `PageLayout` 上写 `max-w-*`
            （设置页），引导页则根本不在这个外壳里（它自带 `max-w-3xl`）。

            高度链路：滚动容器自己写 `min-h-0`，内层只做 `flex-1`。内层不能再加
            `min-h-0`——那会让它在外层里被压到视口高度，内容超高时 `py-5` 的尾部留白
            留在视口底部而不是内容之后，滚到底最后一张卡片会贴边。
          */}
          <div className="relative z-10 w-full flex-1 px-4 py-5 md:px-6 2xl:px-8">{children}</div>
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
        'sticky top-0 z-20 -mx-4 -mt-5 flex flex-col gap-2 border-b border-border/50 bg-canvas/95 px-4 pt-5 pb-3 backdrop-blur-sm md:-mx-6 md:px-6 2xl:-mx-8 2xl:px-8',
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
  return <section data-screenshot={props.dataScreenshot} className={cn('grid gap-4', className)}>{children}</section>
}
