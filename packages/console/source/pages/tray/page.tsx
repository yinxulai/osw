/**
 * 托盘面板。
 *
 * 这不是「控制台的简化版」，而是控制台**同一份实现**的另一种排布：同一份管理 API、
 * 同一条实时流、同一套推导、同一批组件。面板里唯一特有的东西是「窗口只有这么宽、高度由
 * 内容决定」这件事本身（见 `use-tray-panel-height`）。
 *
 * 于是这里没有：
 * - 自己的一份模型摘要与状态口径（`@common/provider-model-status` 一份）；
 * - 自己的协议图标（`ProtocolIcons` 一份，一眼看出来就是控制台那一排）；
 * - 自己的语言（跟控制台同样的偏好，最外层 `I18nProvider` 已经解析好）；
 * - 自己的实时通道（`LiveRequestsProvider` 一条流，「处理中（n）」两边同时跳）。
 *
 * 与控制台主界面的差别只剩「少了什么」：没有侧栏、没有拖拽、没有编辑操作。少掉的东西
 * 用不渲染来表达，而不是复制一份再删几行。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { AppWindow, Power, Timer, X, Zap } from 'lucide-react'
import type { LogicalModel, LogicalModelProviderModel, Provider } from '@common/schemas'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { providerModelMetricKey, type ProviderModelMetrics } from '@common/provider-model-metrics'
import { providerModelProcessingCounts, resolveProviderModelBadge } from '@common/provider-model-status'
import { TRAY_PANEL_GUTTER } from '@common/tray-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProtocolIcons } from '@/components/protocol-icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { useLiveRequests } from '@/data/live-requests'
import { useLogicalModels, useLogicalModelsLoading } from '@/data/logical-models'
import { useLogicalModelControlService } from '@/pages/logical-models/service'
import { useProxyToggle } from '@/pages/logical-models/hooks/use-proxy-toggle'
import { useDocumentTheme } from '@/shell/document-theme'
import { useTrayPanelHeight } from './use-tray-panel-height'

/** 模型列表的高度上限。窗口再高也不铺满屏幕，剩下的交给列表自己滚。 */
const MODEL_LIST_MAX_HEIGHT = 'max-h-74'

export function TrayPanelPage() {
  const t = useTranslation()
  const toast = useToast()
  const panelRef = useRef<HTMLDivElement | null>(null)

  useDocumentTheme()
  useTrayPanelHeight(panelRef, TRAY_PANEL_GUTTER * 2)

  const logicalModels = useLogicalModels()
  const logicalModelsLoading = useLogicalModelsLoading()
  const liveRequests = useLiveRequests()
  // 状态与开关都走控制台那一份（`useProxyToggle` 会把执行结果直接写回查询缓存，
  // 所以按钮不需要第二次请求就能翻面）。主进程那边每 2 秒读一次真实状态来刷新托盘菜单，
  // 两条路径读的是同一个服务，不会各说各话。
  const { proxyStatus, toggleProxy } = useProxyToggle()

  // 选中的标签用**数据记录 id** 记：模型名是可改的，拿它当选中态的开键，改完名选中就丢了。
  const [selectedLogicalModelId, setSelectedLogicalModelId] = useState<string | null>(null)
  const activeLogicalModelId = logicalModels.some(model => model.id === selectedLogicalModelId)
    ? selectedLogicalModelId
    : logicalModels[0]?.id ?? null

  // 在途请求按**最后一次尝试命中的**供应商模型计数，与列表里那一行的口径完全一致。
  const processingCounts = useMemo(
    () => providerModelProcessingCounts(liveRequests.data),
    [liveRequests.data],
  )

  const running = proxyStatus?.running ?? false
  const host = window.trayPanel

  const openMainWindow = useCallback(() => {
    // 打开主界面会顶掉这个浮层（失去焦点就收起来），所以失败必须说话，不能悄悄吞掉。
    host?.openMainWindow().catch(error => {
      console.warn('[tray] failed to open the main window', error)
      toast.error(t('tray.panel.actionFailed'))
    })
  }, [host, t, toast])

  return (
    // 外圈留白是给窗口阴影的：窗口做成无边框 + 透明，CSS 阴影画在内容卡片上，
    // 留白不够就会被窗口边界裁掉一条边。数值来自 `@common/tray-panel`，主进程摆放窗口时
    // 用的是同一个常量，两边不会各留一个数。
    <div style={{ padding: TRAY_PANEL_GUTTER }}>
      <div
        ref={panelRef}
        className="flex flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-[0_8px_24px_rgb(0_0_0/0.12),0_1px_4px_rgb(0_0_0/0.06)]"
      >
        <header className="flex min-h-14 shrink-0 items-center gap-2.5 border-b border-components-panel-border px-3.5">
          <img src="icon.svg" alt="" className="size-7 shrink-0 rounded-[7px]" />
          <span className="min-w-0 flex-1">
            <strong className="block system-sm-semibold">OSW</strong>
            <span className="block truncate system-2xs-regular text-text-tertiary">{t('tray.panel.subtitle')}</span>
          </span>
          <Badge variant={running ? 'success' : 'muted'} aria-live="polite">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {running ? t('common.state.running') : t('common.state.stopped')}
          </Badge>
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => { void toggleProxy() }}
            aria-label={running ? t('tray.panel.stopProxy') : t('tray.panel.startProxy')}
            title={running ? t('tray.panel.stopProxy') : t('tray.panel.startProxy')}
          >
            <Power size={15} />
          </Button>
        </header>

        <div className="flex flex-col px-3.5 py-3">
          <section className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              {/* 排版阶梯里 `2xs` 一族只有 `regular` / `medium` / `semibold-uppercase`；
                  写一个不存在的 `system-2xs-semibold` 不会报错，元素会静静退回 `<h2>` 的
                  浏览器默认字号，标题于是比正文大一整圈。 */}
              <h2 className="system-2xs-medium">{t('logicalModels.title')}</h2>
              <span className="shrink-0 system-2xs-regular text-text-quaternary">
                {t('tray.panel.logicalModelsCount', { count: logicalModels.length })}
              </span>
            </div>
            {activeLogicalModelId === null ? (
              // 首次拉取与「真的一个都没有」是两件事：前者显示空状态就是在报一个还不成立的结论。
              logicalModelsLoading
                ? <div className="min-h-24" />
                : (
                    <TrayEmptyState
                      title={t('tray.panel.logicalModelsEmpty')}
                      description={t('tray.panel.logicalModelsEmptyHint')}
                    />
                  )
            ) : (
              <Tabs value={activeLogicalModelId} onValueChange={setSelectedLogicalModelId}>
                {/* 标准标签行为：列表铺满整行当作分割线，标签按内容宽度**从左往右**排。
                    两处默认值要收回来——列表自带 `justify-center`、标签自带 `flex-1`，
                    单个逻辑模型时那个标签会被居中并抻满整行，像没画完的占位。
                    收回后单个贴左缘、多个依次排开，名字再长也只截断自己，溢出交给横向滚动。 */}
                <TabsList className="w-full justify-start overflow-x-auto" aria-label={t('tray.panel.logicalModelTabs')}>
                  {logicalModels.map(model => (
                    <TabsTrigger
                      key={model.id}
                      value={model.id}
                      title={model.modelId}
                      className={cn(
                        'min-w-0 max-w-full flex-none overflow-hidden text-ellipsis',
                        !model.enabled && 'text-text-quaternary',
                      )}
                    >
                      {model.modelId}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {/* 一个逻辑模型一个面板，Radix 只挂载当前选中的那个：因此同时只有一个
                    `useLogicalModelControlService` 在跑，切标签不产生 N 份轮询。 */}
                {logicalModels.map(model => (
                  <TabsContent key={model.id} value={model.id} className="mt-0">
                    <TrayProviderModelList
                      logicalModel={model}
                      processingCounts={processingCounts}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </section>

          <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-2">
            <Button onClick={openMainWindow}>
              <AppWindow size={15} />
              {t('tray.panel.openApp')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => host?.quit()}
              aria-label={t('tray.panel.quit')}
              title={t('tray.panel.quit')}
            >
              <X size={15} />
            </Button>
          </div>

          <p className="mt-2.5 text-center system-2xs-regular text-text-quaternary">{t('tray.panel.footnote')}</p>
        </div>
      </div>
    </div>
  )
}

interface TrayEmptyStateProps {
  title: string
  description?: string
}

function TrayEmptyState(props: TrayEmptyStateProps) {
  return (
    <div className="grid min-h-24 place-content-center gap-1 px-4 py-4 text-center">
      <div className="system-2xs-medium">{props.title}</div>
      {props.description && (
        <div className="system-2xs-regular text-text-tertiary">{props.description}</div>
      )}
    </div>
  )
}

interface TrayProviderModelListProps {
  /** 整条逻辑模型交进来：绑定查记录 id，手动锁定比对模型 id。 */
  logicalModel: LogicalModel
  processingCounts: Map<string, number>
}

function TrayProviderModelList(props: TrayProviderModelListProps) {
  const t = useTranslation()
  const service = useLogicalModelControlService(props.logicalModel)

  if (service.models.length === 0) {
    return (
      <TrayEmptyState
        title={t('logicalModels.card.empty.title')}
        description={t('logicalModels.card.empty.description')}
      />
    )
  }

  return (
    <div className={cn('overflow-y-auto overscroll-contain rounded-xl border border-module-border bg-components-panel-bg', MODEL_LIST_MAX_HEIGHT)}>
      {service.models.map(model => (
        <TrayProviderModelRow
          key={model.id}
          model={model}
          provider={service.providers[model.providerId]}
          metrics={service.modelMetrics[providerModelMetricKey(model.providerId, model.id)]}
          cooling={service.isCooling(model.providerId, model.id)}
          selected={service.mode === 'manual' && service.manualModelId === model.id}
          processingCount={props.processingCounts.get(model.id) ?? 0}
        />
      ))}
    </div>
  )
}

interface TrayProviderModelRowProps {
  model: LogicalModelProviderModel
  provider?: Provider
  metrics?: ProviderModelMetrics
  cooling: boolean
  selected: boolean
  processingCount: number
}

/**
 * 模型行：控制台那一行的只读版本。
 *
 * 少了拖拽手柄、健康度文案与右侧操作区，留下「谁 · 哪个模型 · 走什么协议 · 快不快 ·
 * 现在能不能用」。状态位那一段是与控制台**完全同一份**推导（`resolveProviderModelBadge`），
 * 两边的优先级——「处理中 > 模型停用 > 冷却 > 已选中/待命 > 绑定停用」——不可能再各自漂移。
 */
function TrayProviderModelRow(props: TrayProviderModelRowProps) {
  const t = useTranslation()
  const { model } = props
  const badge = resolveProviderModelBadge({
    processingCount: props.processingCount,
    modelEnabled: model.modelEnabled,
    enabled: model.enabled,
    cooling: props.cooling,
    selected: props.selected,
  })

  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-0.5 system-xs-medium">
          <span className={cn('min-w-0 truncate', props.provider ? 'text-text-primary' : 'text-text-tertiary')}>
            {props.provider ? props.provider.name : t('logicalModels.row.unknownProvider')}
          </span>
          <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
          <span className="min-w-0 truncate font-mono text-text-primary">{model.modelName}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 system-2xs-regular text-text-tertiary">
          <ProtocolIcons endpoints={model.endpoints} />
          <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Zap size={10} aria-hidden />
            TPS {formatOutputSpeed(props.metrics?.avgTps)}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Timer size={10} aria-hidden />
            TTFT {formatMilliseconds(props.metrics?.avgTtftMilliseconds)}
          </span>
        </div>
      </div>
      <Badge variant={badge.tone}>
        {badge.key === 'logicalModels.row.processing' && (
          <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />
        )}
        {t(badge.key, badge.count !== undefined ? { count: badge.count } : undefined)}
      </Badge>
    </div>
  )
}
