import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { getPlatformCapabilities, type PlatformOs } from '@/platform/capabilities'
import { BreadcrumbTrail, usePageBreadcrumbs } from '@/components/breadcrumbs'
import { useWindowFullScreen } from '@/hooks/use-window-full-screen'
import { useLiveMetrics } from '@/data/live-metrics'
import { useSettings } from '@/data/settings'
import { DEFAULT_LIVE_METRIC_TEMPLATE, renderLiveMetric } from '@common/live-metrics'

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
  const breadcrumbs = usePageBreadcrumbs()
  const trail = breadcrumbs.length > 0 ? breadcrumbs : [{ label: props.title }]

  return (
    <header
      data-window-drag
      aria-label={props.title}
      className={cn(
        'flex h-9 shrink-0 select-none items-center gap-2.5 bg-sidebar text-sidebar-foreground transition-[padding] duration-200 ease-out motion-reduce:transition-none',
        resolveWindowTitlebarInsets(platform, fullScreen),
      )}
    >
      <img src="icon.svg" alt="" draggable={false} className="size-4 shrink-0" />
      <span className="system-xs-semibold text-text-secondary">{t('app.windowTitle')}</span>
      <ChevronRight className="size-3 shrink-0 text-text-quaternary" aria-hidden="true" />
      <BreadcrumbTrail items={trail} className="min-w-0 flex-1 system-xs-medium" />
      <span className="ml-auto flex shrink-0 items-center gap-2.5">
        <WindowLiveMetric />
        <span className="flex items-center gap-1.5">
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
      </span>
    </header>
  )
}

/**
 * 标题栏里的实时指标，固定在**运行状态左边**。
 *
 * 这是标准的 {@link LiveMetrics} 的又一块画布——和菜单栏标题取同一份数、用同一段模板，
 * 所以两边永远一致。指标不是托盘专用的：这里只是把它画到窗口上而已。
 *
 * 只有开关打开、指标已到、且模板渲染出非空文本时才占位；否则整段不渲染，不给状态留一段
 * 空白间隙。指标还没到时**不显示**（而不是显示 `--`）：首次连接的空窗里闪一下占位符，
 * 比安静地等第一帧更吵。
 */
function WindowLiveMetric() {
  const settings = useSettings()
  const metrics = useLiveMetrics().data
  if (!settings?.liveMetricWindowEnabled || !metrics) return null
  const template = settings.liveMetricTemplate.trim() === '' ? DEFAULT_LIVE_METRIC_TEMPLATE : settings.liveMetricTemplate
  const text = renderLiveMetric(template, metrics)
  if (text === '') return null
  return <span className="max-w-56 truncate font-mono system-2xs-regular text-text-tertiary">{text}</span>
}
