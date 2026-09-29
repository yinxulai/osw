import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { getPlatformCapabilities, type PlatformOs } from '@/platform/capabilities'
import { BreadcrumbTrail, usePageBreadcrumbsValue } from '@/components/breadcrumbs'
import { useWindowFullScreen } from '@/hooks/use-window-full-screen'

interface WindowTitlebarProps {
  title: string
  proxyRunning: boolean
  proxyPort?: number
}

export function resolveWindowTitlebarInsets(platform: PlatformOs, fullScreen: boolean): string {
  if (fullScreen) return 'pr-4 pl-4'
  return platform === 'darwin' ? 'pr-4 pl-20' : 'pr-40 pl-4'
}

export function WindowTitlebar(props: WindowTitlebarProps) {
  const t = useTranslation()
  const platform = getPlatformCapabilities().os
  const fullScreen = useWindowFullScreen()
  const breadcrumbs = usePageBreadcrumbsValue()
  const trail = breadcrumbs.length > 0 ? breadcrumbs : [{ label: props.title }]

  return (
    <header
      data-window-drag
      aria-label={props.title}
      className={cn(
        'flex h-11 shrink-0 select-none items-center gap-2.5 bg-background transition-[padding] duration-200 ease-out motion-reduce:transition-none',
        resolveWindowTitlebarInsets(platform, fullScreen),
      )}
    >
      <img src="icon.svg" alt="" draggable={false} className="size-4 shrink-0" />
      <span className="system-xs-semibold text-text-secondary">{t('app.windowTitle')}</span>
      <ChevronRight className="size-3 shrink-0 text-text-quaternary" aria-hidden="true" />
      <BreadcrumbTrail items={trail} className="min-w-0 flex-1 system-xs-medium" />
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            props.proxyRunning ? 'bg-success' : 'bg-text-quaternary',
          )}
        />
        <span className="system-2xs-regular text-text-quaternary">
          {props.proxyRunning
            ? t('nav.status.running', { port: props.proxyPort ?? 0 })
            : t('nav.status.stopped')}
        </span>
      </span>
    </header>
  )
}
