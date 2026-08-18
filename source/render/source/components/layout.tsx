import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

interface PageContentProps {
  children: ReactNode
  className?: string
}

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout(props: AppLayoutProps) {
  const { sidebar, children } = props
  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background text-foreground">
      {sidebar}
      <main className="ml-12 min-w-0 flex-1 overflow-auto overscroll-contain">
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-5 md:p-8">{children}</div>
      </main>
    </div>
  )
}

export function PageLayout(props: PageLayoutProps) {
  const { children, className } = props
  return <div className={cn('space-y-7', className)}>{children}</div>
}

export function PageHeader(props: PageHeaderProps) {
  const { title, description, actions, className } = props
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-medium tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  )
}

export function PageContent(props: PageContentProps) {
  const { children, className } = props
  return <section className={cn('space-y-4', className)}>{children}</section>
}
