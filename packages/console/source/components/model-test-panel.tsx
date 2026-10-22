import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  Gauge,
  Maximize2,
  Minus,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { cacheHitRate, formatMilliseconds, formatOutputSpeed, formatTokenCount } from '@common/metrics'
import { ALL_MODEL_TEST_MODES, type ModelTestMode, type Protocol, type Provider, type ProviderModelRoute } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { FormRow } from '@/components/form-kit'
import { MetricCard, type MetricCardProps } from '@/components/metric-card'
import { PROTOCOL_ICONS } from '@/components/protocol-icons'
import { TableFrame, TableHeaderSurface, tableRowClass } from '@/components/table-primitives'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useTranslation } from '@/i18n/provider'
import { formatPercent } from '@/lib/format-percent'
import { cn } from '@/lib/utils'
import { useProviderModels } from '@/data/provider-models'
import { useProviders } from '@/data/providers'
import { useTasks } from '@/data/tasks'
import { useAppUiStore } from '@/store/app-ui-store'
import { clampConfigNumber } from '@/lib/model-test/config'
import {
  buildSelectionView,
  clearAllTasks,
  getProtocolSegmentClassName,
  isEveryTaskSelected,
  pruneModelProtocolSelection,
  pruneProviderSelection,
  selectEveryTask,
  toggleModelSelection,
  toggleProtocolSelection,
  toggleProviderSelection,
  type ModelProtocolSelection,
} from '@/lib/model-test/selection'
import {
  getResultRounds,
  getRoundSuccessRate,
  getTaskDurationLabel,
  getTaskSpeedLabel,
  getTaskStatusClassName,
  getTaskStatusTitle,
  getTaskTokenLabel,
  getTaskTtftLabel,
} from '@/lib/model-test/results'
import {
  MODEL_TEST_TASK_KIND,
  buildPlannedRows,
  getCurrentRoundLabel,
  getVisibleTestRows,
  hasSettledOrRunning,
  mergeTestRows,
  summarizeTestRows,
  toModelTestItems,
  type TestRow,
  type TestRowSummary,
  type TestRowStatus,
} from '@/lib/model-test/tasks'
import { useModelTestConfigStore, type TestConfig } from '@/store/model-test-config'

/**
 * 渠道诊断面板——**外壳级的非模态浮窗**。
 *
 * ## 为什么它不再是一个 `Dialog`
 *
 * 队列在服务端跑，界面只是读数与发令的地方。做成模态弹窗时，用户「边看日志边等结果」
 * 这件事就被挡住了：遮罩把页面压灰，什么都点不动。所以这里去掉 `DialogOverlay`，
 * 面板变成固定在右下角的浮窗——页面照旧可交互、可滚动，面板只是浮在上面。
 *
 * ## 为什么最小化 ≠ 关闭
 *
 * 跑的时候把面板收成角标是常态（「我知道它在跑，别占我地方」），收起来之后任务照跑、
 * 角标照报「第几轮 / 已完成多少 / 挂了几个」。**关闭**才是收摊：确认之后把这一批取消掉。
 * 今天那条「跑着就不许关」的约束随之取消——它当初是为了掩盖「客户端队列一卸载就断」，
 * 而队列现在已经不在客户端了。
 *
 * ## 为什么这一层不再持有队列
 *
 * 状态、并发、取消、去重全在服务端（`packages/core/source/management/tasks/`）。这个文件
 * 只做三件事：从 {@link useTasks} 拿快照、把服务端任务翻成表格行（`lib/model-test/tasks`）、
 * 把「用户点了什么」翻成命令。它卸载、切页、关窗口，都不会中断一个已经在跑的任务。
 */

/**
 * 结果表列宽模板：表头与数据行共用一份，避免两处列宽只改一半。
 *
 * 一格只放一个事实。协议**单独成列**（色条只能表达「是转出来的」，说不出「测的是哪个协议」），
 * 最左边 20px 是展开箭头，四个数字列右对齐、等宽数字。列对所有模式都在，不跟着数据变。
 */
const TASK_GRID_COLUMNS = 'md:grid-cols-[20px_minmax(150px,1.4fr)_minmax(120px,0.9fr)_66px_62px_64px_64px_64px]'

/** 明细里逐轮的列宽模板：列名横条与每一轮共用一份。 */
const ROUND_GRID_COLUMNS = 'md:grid-cols-[68px_56px_68px_80px_80px_76px_92px]'

const TEST_MODE_LABEL_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  streaming: 'modelTest.mode.streaming',
  speed: 'modelTest.mode.speed',
}

const TEST_MODE_HINT_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  streaming: 'modelTest.mode.streamingHint',
  speed: 'modelTest.mode.speedHint',
}

const TASK_STATUS_LABEL_KEYS: Record<TestRowStatus, UiCatalogKey> = {
  queued: 'modelTest.status.queued',
  running: 'modelTest.status.running',
  success: 'modelTest.status.success',
  failed: 'modelTest.status.failed',
  cancelled: 'modelTest.status.cancelled',
}

/**
 * 协议分段控件的**底座**：一条凹槽（`bg-inset`），放这个模型的全部可测协议。
 *
 * 槽本身会换行：协议名一律用正式写法（`OpenAI Completions`），三个满名并排在 340px 的
 * 侧栏里排不下，宁可多占一行，不减字——缩写会引出第二个叫法。
 */
const PROTOCOL_TRACK_CLASS = 'inline-flex flex-wrap items-stretch gap-0.5 rounded-md bg-inset p-0.5'

interface ProtocolSegmentProps {
  converted: boolean
  disabled: boolean
  protocol: Protocol
  selected: boolean
  title: string
  onToggle: () => void
}

/** 槽里的一个协议分段。`role="checkbox"` 是拿来表达三态（行级那圈求和出来的半选）的。 */
function ProtocolSegment(props: ProtocolSegmentProps) {
  const Icon = PROTOCOL_ICONS[props.protocol]
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.selected}
      aria-label={props.title}
      title={props.title}
      disabled={props.disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 system-2xs-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        getProtocolSegmentClassName({ converted: props.converted, selected: props.selected }),
      )}
      onClick={props.onToggle}
    >
      {props.converted ? <Repeat size={9} aria-hidden className="shrink-0" /> : <Icon size={11} aria-hidden className="shrink-0" />}
      {PROTOCOL_DISPLAY_NAMES[props.protocol]}
    </button>
  )
}

interface ModelSelectionProps {
  busy: boolean
  allTasksSelected: boolean
  availableProviders: Provider[]
  selectedProviderIds: Set<string>
  enabledModels: ProviderModelRoute[]
  selectedModelProtocols: Record<string, Set<Protocol>>
  onToggleAll: () => void
  onToggleModel: (modelId: string) => void
  onToggleProvider: (providerId: string) => void
  onToggleModelProtocol: (modelId: string, protocol: Protocol) => void
}

function ModelSelection(props: ModelSelectionProps) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const providerViews = useMemo(() => buildSelectionView({
    providers: props.availableProviders,
    models: props.enabledModels,
    providerIds: props.selectedProviderIds,
    modelProtocols: props.selectedModelProtocols,
    query,
    t,
  }), [query, props.availableProviders, props.enabledModels, props.selectedModelProtocols, props.selectedProviderIds, t])

  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 bg-card lg:border-r lg:border-b-0">
      <div className="grid shrink-0 gap-3 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="system-xs-medium text-text-primary">{t('modelTest.selection.title')}</div>
            <div className="mt-0.5 system-2xs-regular text-text-tertiary">{t('modelTest.selection.description')}</div>
          </div>
          <Button variant="ghost" size="xs" disabled={props.busy || props.enabledModels.length === 0} onClick={props.onToggleAll}>
            {props.allTasksSelected ? t('modelTest.selection.clear') : t('common.action.selectAll')}
          </Button>
        </div>
        <div className="relative">
          <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-quaternary" />
          <Input
            value={query}
            disabled={props.busy}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('modelTest.selection.searchPlaceholder')}
            className="pr-3 pl-7.5"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border-t border-border/60">
        {providerViews.map(providerView => (
          <section key={providerView.provider.id}>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <Checkbox
                checked={providerView.selected}
                disabled={props.busy}
                aria-label={providerView.provider.name}
                onCheckedChange={() => props.onToggleProvider(providerView.provider.id)}
              />
              <button
                type="button"
                disabled={props.busy}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                onClick={() => props.onToggleProvider(providerView.provider.id)}
              >
                <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{providerView.provider.name}</span>
                <span className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-quaternary">{t('modelTest.selection.modelCount', { count: providerView.models.length })}</span>
              </button>
            </div>

            {providerView.selected && (
              <div className="grid gap-2.5 px-4 pb-3 pl-10">
                {providerView.models.map(modelView => (
                  <div key={modelView.model.id}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Checkbox
                        checked={modelView.indeterminate ? 'indeterminate' : modelView.selected}
                        disabled={props.busy}
                        aria-label={t('modelTest.selection.modelAria', { name: modelView.model.modelName })}
                        onCheckedChange={() => props.onToggleModel(modelView.model.id)}
                      />
                      <button
                        type="button"
                        disabled={props.busy}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                        onClick={() => props.onToggleModel(modelView.model.id)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono system-2xs-regular text-text-secondary">{modelView.model.modelName}</span>
                        {/*
                         * 计数要带单位。裸 `2/3` 排在模型名右边，读者第一反应是
                         * 「三个模型里选了两个」——可这里模型只有一行，被数的是协议。
                         */}
                        <span className="shrink-0 system-2xs-regular tabular-nums text-text-quaternary">
                          {t('modelTest.selection.protocolCount', { selected: modelView.selectedCount, total: modelView.protocols.length })}
                        </span>
                      </button>
                    </div>
                    <div className={PROTOCOL_TRACK_CLASS}>
                      {modelView.protocols.map(protocolView => (
                        <ProtocolSegment
                          key={`${modelView.model.id}:${protocolView.protocol}`}
                          converted={protocolView.converted}
                          disabled={props.busy}
                          protocol={protocolView.protocol}
                          selected={protocolView.selected}
                          title={protocolView.title}
                          onToggle={() => props.onToggleModelProtocol(modelView.model.id, protocolView.protocol)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
        {providerViews.length === 0 && (
          <InlineEmptyState
            title={props.enabledModels.length === 0 ? t('modelTest.empty.noModels') : t('modelTest.selection.empty')}
            className="px-3 py-10"
          />
        )}
      </div>
    </aside>
  )
}

interface TestProgressProps {
  cancelledCount: number
  completedCount: number
  failureCount: number
  progress: number
  running: boolean
  successCount: number
  totalCount: number
}

/**
 * 常驻状态块。
 *
 * 无论是否跑过都渲染同一套骨架（状态文案 + 四个计数 + 进度条 + 费用提示），
 * 只是空值落回 `0` / 尚未开始：这样点「开始诊断」时页面不会突然多出一整条横幅。
 */
function TestProgress(props: TestProgressProps) {
  const t = useTranslation()
  const status = props.running
    ? t('modelTest.progress.running')
    : props.completedCount === 0
      ? t('modelTest.progress.idle')
      : props.failureCount > 0
        ? t('modelTest.progress.failed')
        : props.cancelledCount > 0
          ? t('modelTest.progress.cancelled')
          : t('modelTest.progress.done')
  return (
    <div className="mx-4 mt-3 rounded-lg border border-module-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-4 system-2xs-regular">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('truncate system-2xs-medium', props.running ? 'text-text-primary' : 'text-text-secondary')}>{status}</span>
          <span className="shrink-0 text-text-success">{t('modelTest.progress.success', { count: props.successCount })}</span>
          <span className={cn('shrink-0', props.failureCount > 0 ? 'text-text-destructive' : 'text-text-tertiary')}>{t('modelTest.progress.failure', { count: props.failureCount })}</span>
          <span className={cn('shrink-0', props.cancelledCount > 0 ? 'text-text-tertiary' : 'text-text-quaternary')}>{t('modelTest.progress.cancelledCount', { count: props.cancelledCount })}</span>
        </div>
        <span className="shrink-0 font-mono tabular-nums text-text-tertiary">{props.completedCount}/{props.totalCount} · {props.progress}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-inset">
        <div className={cn('h-full transition-all duration-300', props.failureCount > 0 && !props.running ? 'bg-destructive' : 'bg-primary')} style={{ width: `${props.progress}%` }} />
      </div>
      <div className="mt-2 flex items-start gap-2 border-t border-border/50 pt-2 system-2xs-regular leading-4 text-text-warning">
        <TriangleAlert size={13} aria-hidden className="mt-px shrink-0" />
        <span className="min-w-0">{t('modelTest.costWarning')}</span>
      </div>
    </div>
  )
}

interface TaskCellProps {
  /** 格子的窄屏标签 key。表头管着 md 及以上，所以它只在这之下渲染。 */
  labelKey: UiCatalogKey
  align?: 'start' | 'end'
  children: React.ReactNode
}

/** 结果行里的一格数据。 */
function TaskCell(props: TaskCellProps) {
  const t = useTranslation()
  const numeric = props.align === 'end'
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3 md:block', numeric && 'md:text-right')}>
      <span className="shrink-0 system-2xs-regular text-text-quaternary md:hidden">{t(props.labelKey)}</span>
      <div className={cn('min-w-0', numeric && 'font-mono system-2xs-regular tabular-nums text-text-tertiary')}>{props.children}</div>
    </div>
  )
}

/** 展开体只接一条已有结论的行。 */
interface TestRowDetailProps {
  row: TestRow
}

/**
 * 展开体：一排指标块，下面一张带框的逐轮表。
 *
 * 汇总这里**故意用指标块而不是一句结论**：诊断要回答的是「这个渠道能不能用、首字多快、
 * 出字多快、缓存有没有被用上」这几件互相独立的事。四块行内等分排满：总耗时与输入 / 输出
 * Token 不进来（结果行与逐轮表里已经有了），缓存命中率不一样——不放到这里就没有地方能回答它。
 */
function TestRowDetail(props: TestRowDetailProps) {
  const t = useTranslation()
  const result = props.row.result!
  const rounds = getResultRounds(result)
  const successCount = rounds.filter(round => round.success).length
  const successRate = getRoundSuccessRate(rounds)
  // 汇总值一律取服务端的 `result`（`summarizeRounds` 是唯一定义处），不在这里重算。
  const speed = formatOutputSpeed(result.tokensPerSecond)
  // 命中率不在这一层重算：服务端已经把分子分母各自取了均值，这里只把「比率」交给
  // `@common/metrics` 的唯一定义算一次。任一值为 `null`（上游压根没报缓存字段）就写 `—`。
  const hitRate = result.cachedInputTokens == null || result.inputTokens == null
    ? null
    : cacheHitRate(result.cachedInputTokens, result.inputTokens)
  const metrics: MetricCardProps[] = [
    {
      label: t('modelTest.detail.successRate'),
      value: `${successCount}/${rounds.length} · ${successRate}%`,
      tone: successRate === 100 ? 'success' : 'destructive',
    },
    { label: t('modelTest.detail.ttft'), value: formatMilliseconds(result.ttftMilliseconds) },
    { label: t('modelTest.detail.tps'), value: speed === '—' ? '—' : `${speed} t/s` },
    { label: t('modelTest.detail.cacheHitRate'), value: hitRate == null ? '—' : formatPercent(hitRate) },
  ]
  return (
    <div className="col-span-full">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <section className="mt-3 overflow-hidden rounded-lg border border-module-border">
        <TableHeaderSurface className={cn('hidden items-baseline gap-3 px-3 py-2 md:grid', ROUND_GRID_COLUMNS)}>
          <span>{t('modelTest.detail.roundColumn')}</span>
          <span>{t('modelTest.table.status')}</span>
          <span>{t('modelTest.detail.httpStatus')}</span>
          <span className="text-right">{t('modelTest.detail.ttft')}</span>
          <span className="text-right">{t('modelTest.detail.duration')}</span>
          <span className="text-right">{t('modelTest.detail.tps')}</span>
          <span className="text-right">{t('modelTest.detail.outputTokens')}</span>
        </TableHeaderSurface>
        {rounds.map(round => (
          <div key={round.round} className="border-b border-border/40 px-3 py-2.5 last:border-0">
            <div className={cn('grid grid-cols-2 gap-x-3 gap-y-1.5 system-2xs-regular md:items-baseline md:gap-y-0', ROUND_GRID_COLUMNS)}>
              <span className="font-mono tabular-nums text-text-quaternary">{t('modelTest.detail.round', { round: round.round })}</span>
              <TaskCell labelKey="modelTest.table.status">
                <span className={cn('system-2xs-medium', round.success ? 'text-text-success' : 'text-text-destructive')}>
                  {t(TASK_STATUS_LABEL_KEYS[round.success ? 'success' : 'failed'])}
                </span>
              </TaskCell>
              <TaskCell labelKey="modelTest.detail.httpStatus">
                <span className="font-mono tabular-nums">{round.statusCode ?? '—'}</span>
              </TaskCell>
              <TaskCell labelKey="modelTest.detail.ttft" align="end">{formatMilliseconds(round.ttftMilliseconds)}</TaskCell>
              <TaskCell labelKey="modelTest.detail.duration" align="end">{formatMilliseconds(round.durationMilliseconds)}</TaskCell>
              <TaskCell labelKey="modelTest.detail.tps" align="end">{formatOutputSpeed(round.tokensPerSecond)}</TaskCell>
              <TaskCell labelKey="modelTest.detail.outputTokens" align="end">{formatTokenCount(round.outputTokens)}</TaskCell>
            </div>
            {!round.success && (
              <div className="mt-1.5 wrap-break-word rounded-md bg-destructive/8 px-2 py-1.5 font-mono system-2xs-regular leading-4 text-text-destructive">
                {round.errorMessage || t('modelTest.detail.noError')}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

interface TestTaskRowProps {
  row: TestRow
  expanded: boolean
  onToggleExpanded: () => void
}

/**
 * 一行诊断结论。
 *
 * 整行是一枚按钮（`aria-expanded`）：协议色条与标题都不可点，会让「这条能不能点开」
 * 变成靠猜。展开按钮放在最左一列，与状态列分开，是因为状态列要能竖着扫。
 */
function TestTaskRow(props: TestTaskRowProps) {
  const { row } = props
  const t = useTranslation()
  const statusLabel = t(TASK_STATUS_LABEL_KEYS[row.status])
  const ProtocolIcon = PROTOCOL_ICONS[row.protocol]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={props.expanded}
      aria-label={props.expanded ? t('modelTest.detail.collapse') : t('modelTest.detail.expand')}
      className={cn(
        tableRowClass,
        'grid cursor-pointer grid-cols-1 gap-2.5 px-3 py-2.5 md:items-start md:gap-3',
        TASK_GRID_COLUMNS,
      )}
      onClick={props.onToggleExpanded}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onToggleExpanded()
      }}
    >
      <div className="flex items-center md:pt-0.5">
        <ChevronRight size={13} aria-hidden className={cn('shrink-0 text-text-quaternary transition-transform', props.expanded && 'rotate-90')} />
      </div>
      {/* 渠道 / 模型一格定主体。 */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 md:block">
          <span className="shrink-0 system-2xs-regular text-text-quaternary md:hidden">{t('modelTest.table.target')}</span>
          <div className="min-w-0">
            <div className="truncate system-xs-medium text-text-primary">{row.providerName}</div>
            <div className="mt-0.5 truncate font-mono system-2xs-regular text-text-tertiary">{row.modelName}</div>
          </div>
        </div>
      </div>
      <TaskCell labelKey="modelTest.table.protocol">
        <span className={cn('inline-flex min-w-0 items-center gap-1 system-2xs-regular', row.converted ? 'text-text-warning' : 'text-text-secondary')}>
          {row.converted ? <Repeat size={9} aria-hidden className="shrink-0" /> : <ProtocolIcon size={11} aria-hidden className="shrink-0" />}
          <span className="truncate">{PROTOCOL_DISPLAY_NAMES[row.protocol]}</span>
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.status">
        <span
          title={getTaskStatusTitle(row, statusLabel)}
          className={cn('inline-flex items-center gap-1 system-2xs-medium', getTaskStatusClassName(row.status))}
        >
          {statusLabel}
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.ttft" align="end">{getTaskTtftLabel(row)}</TaskCell>
      <TaskCell labelKey="modelTest.table.duration" align="end">{getTaskDurationLabel(row)}</TaskCell>
      <TaskCell labelKey="modelTest.table.speed" align="end">{getTaskSpeedLabel(row)}</TaskCell>
      <TaskCell labelKey="modelTest.table.tokens" align="end">{getTaskTokenLabel(row)}</TaskCell>
      {/* 明细只在点开且真的有结论时挂了：收起时不渲染，一张几十行的表里每行都藏一份明细会变卡。 */}
      {props.expanded && row.result && <TestRowDetail row={row} />}
      {!props.expanded && row.errorMessage && <div className="col-span-full wrap-break-word rounded-lg border border-module-border bg-destructive/8 px-2.5 py-2 font-mono system-2xs-regular leading-4 text-text-destructive">{row.errorMessage}</div>}
    </div>
  )
}

interface EmptyTestTasksProps {
  hasEnabledModels: boolean
}

function EmptyTestTasks(props: EmptyTestTasksProps) {
  const t = useTranslation()
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <Cpu size={20} strokeWidth={1.5} aria-hidden className="mb-1.5 text-text-quaternary" />
      <div className="system-xs-medium text-text-primary">{props.hasEnabledModels ? t('modelTest.empty.noTasks') : t('modelTest.empty.noModels')}</div>
      <div className="mt-1.5 max-w-sm system-xs-regular leading-5 text-text-tertiary">
        {props.hasEnabledModels ? t('modelTest.empty.noTasksHint') : t('modelTest.empty.noModelsHint')}
      </div>
    </div>
  )
}

interface TestConfigPanelProps {
  config: TestConfig
  onChange: (config: TestConfig) => void
  onBack: () => void
  onReset: () => void
}

interface ConfigNumberRowProps {
  title: string
  description: string
  value: number
  /** 下界是定义（轮次至少一轮），不是策略；上界故意不给。 */
  min: number
  /** 数值单位。数字后面那个词必须说出来，否则 `3` 是 3 个什么全看读者猜。 */
  unitKey: UiCatalogKey
  onChange: (value: number) => void
}

/** 一个数字设置项。右上角的 `—` / `+` 比裸输入框好用：调一格就是一次点击。 */
function ConfigNumberRow(props: ConfigNumberRowProps) {
  const t = useTranslation()
  return (
    <FormRow
      title={props.title}
      description={props.description}
      control={
        <>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={props.value <= props.min}
            aria-label="-"
            onClick={() => props.onChange(clampConfigNumber(props.value - 1, props.min))}
          >
            <span aria-hidden className="text-base leading-none">−</span>
          </Button>
          <input
            type="number"
            inputMode="numeric"
            min={props.min}
            value={props.value}
            aria-label={props.title}
            onChange={event => props.onChange(clampConfigNumber(event.target.valueAsNumber, props.min))}
            className="h-7 w-20 rounded-md border border-border bg-components-input-bg-normal px-1 text-center font-mono system-2xs-regular tabular-nums text-text-primary outline-none focus-visible:border-primary"
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="+"
            onClick={() => props.onChange(clampConfigNumber(props.value + 1, props.min))}
          >
            <span aria-hidden className="text-base leading-none">+</span>
          </Button>
          {/* 单位槽要固定宽度 + 不折行，两个条件缺一不可，否则各行控件排不成一条竖线。 */}
          <span className="w-16 shrink-0 whitespace-nowrap system-2xs-regular text-text-quaternary">{t(props.unitKey)}</span>
        </>
      }
    />
  )
}

/**
 * 测试配置页。
 *
 * 它是同一层浮窗里的**另一页**，不是嵌套弹窗：诊断面板已经浮在页面上，再叠一层会让人
 * 在关闭路径上犯迷糊。每一项都是一条朴素横排（标题 + 说明在左、控件在右、`divide-y` 分隔）。
 */
function TestConfigPanel(props: TestConfigPanelProps) {
  const t = useTranslation()
  const { config } = props
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" title={t('modelTest.config.back')} aria-label={t('modelTest.config.back')} onClick={props.onBack}>
            <ArrowLeft size={14} aria-hidden />
          </Button>
          <div className="min-w-0">
            <div className="system-xs-medium text-text-primary">{t('modelTest.config.title')}</div>
            <div className="mt-0.5 truncate system-2xs-regular text-text-tertiary">{t('modelTest.config.description')}</div>
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={props.onReset}>
          <RotateCcw size={11} aria-hidden /> {t('modelTest.config.reset')}
        </Button>
      </div>

      <div className="divide-y divide-border/50 px-4">
        <ConfigNumberRow
          title={t('modelTest.config.rounds')}
          description={t('modelTest.config.roundsHint')}
          value={config.rounds}
          min={1}
          unitKey="modelTest.config.unit.rounds"
          onChange={rounds => props.onChange({ ...config, rounds })}
        />
        <ConfigNumberRow
          title={t('modelTest.config.inputLength')}
          description={t('modelTest.config.inputLengthHint')}
          value={config.inputLength}
          min={0}
          unitKey="modelTest.config.unit.characters"
          onChange={inputLength => props.onChange({ ...config, inputLength })}
        />
        <div className="grid gap-1.5 py-3">
          <div className="system-sm-medium text-text-primary">{t('modelTest.config.prompt')}</div>
          <p className="system-xs-regular text-text-tertiary">{t('modelTest.config.promptHint')}</p>
          <Textarea
            value={config.prompt}
            placeholder={t('modelTest.config.promptPlaceholder')}
            className="mt-1"
            onChange={event => props.onChange({ ...config, prompt: event.target.value })}
          />
          {/* 只报实际长度，不报「/ 上限」：没有上限，横杠后面那个数只是假的约束。 */}
          <span className="text-right font-mono system-2xs-regular tabular-nums text-text-quaternary">
            {config.prompt.length}
          </span>
        </div>
      </div>
    </div>
  )
}

interface TestPanelBadgeProps {
  rows: readonly TestRow[]
  summary: TestRowSummary
  busy: boolean
  onExpand: () => void
  onCancel: () => void
}

/**
 * 最小化之后的角标。
 *
 * 它要回答的只有三件事：**跑到第几轮了**、**完成了几条**、**有几条挂了**。第三个是重点
 * ——一个人一边看日志一边等结果时，唯一想被主动告知的就是「有几个挂了」，所以失败数
 * 带一枚红点，不做成和其它计数一样的灰字。
 *
 * 角标不是通知栏：它不弹窗、不响铃，只是安静地待在那里，点一下展开。
 */
function TestPanelBadge(props: TestPanelBadgeProps) {
  const t = useTranslation()
  const round = getCurrentRoundLabel(props.rows)
  const total = props.rows.length
  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-module-border bg-popover px-3 py-2 shadow-lg">
      <FlaskConical size={14} aria-hidden className="shrink-0 text-primary" />
      {round ? (
        <>
          <span className="shrink-0 system-2xs-medium tabular-nums text-text-primary">{t('modelTest.badge.round', { round: round.round, total: round.totalRounds })}</span>
          <span className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-tertiary">{t('modelTest.badge.completed', { completed: props.summary.completedCount, total })}</span>
        </>
      ) : (
        <span className="shrink-0 system-2xs-medium tabular-nums text-text-primary">{t('modelTest.badge.summary', { total, failed: props.summary.failureCount })}</span>
      )}
      {props.summary.failureCount > 0 && (
        <span className="flex shrink-0 items-center gap-1 system-2xs-medium text-text-destructive">
          <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
          {t('modelTest.badge.failed', { count: props.summary.failureCount })}
        </span>
      )}
      {props.busy && (
        <Button variant="ghost" size="icon-sm" title={t('modelTest.action.stop')} aria-label={t('modelTest.action.stop')} onClick={props.onCancel}>
          <Square size={11} fill="currentColor" />
        </Button>
      )}
      <Button variant="outline" size="icon-sm" title={t('modelTest.action.expand')} aria-label={t('modelTest.action.expand')} onClick={props.onExpand}>
        <Maximize2 size={12} aria-hidden />
      </Button>
    </div>
  )
}

/**
 * 诊断面板本体（未最小化时）。
 *
 * 非模态：它只是一个 `fixed` 的浮窗，没有遮罩、不抢焦点，页面照旧可以点、可以滚。
 */
export function ModelTestPanel() {
  const t = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()
  const open = useAppUiStore(state => state.testPanelOpen)
  const minimized = useAppUiStore(state => state.testPanelMinimized)
  const setOpen = useAppUiStore(state => state.setTestPanelOpen)
  const setMinimized = useAppUiStore(state => state.setTestPanelMinimized)

  const models = useProviderModels()
  const providers = useProviders()
  const { tasks, enqueue, cancel, clear } = useTasks()

  const enabledModels = useMemo(() => models.filter(model => model.enabled), [models])
  const availableProviders = useMemo(
    () => providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, providers],
  )

  const [selectedModelProtocols, setSelectedModelProtocols] = useState<ModelProtocolSelection>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [failedOnly, setFailedOnly] = useState(false)
  /** 浮窗主体的两个视图：结果与配置。 */
  const [view, setView] = useState<'results' | 'config'>('results')
  const config = useModelTestConfigStore(state => state.config)
  const setConfig = useModelTestConfigStore(state => state.setConfig)
  const resetConfig = useModelTestConfigStore(state => state.resetConfig)
  /** 展开的行。只存 id，收起时不渲染明细。 */
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set())
  /** 本轮诊断要问哪个问题。只影响「下一次开始」。 */
  const [testMode, setTestMode] = useState<ModelTestMode>('streaming')
  const previousOpen = useRef(false)

  /**
   * 模型 / 供应商集合变化后校正选中态。
   *
   * 三个 updater 都遵守同一条规矩：**没有实际变化就返回 `current`**，否则父级每 10s / 30s
   * 重建数组时会把「重渲染 → 重跑 effect → 写 state → 再重渲染」这条空转链装回去。
   */
  useEffect(() => {
    const isOpening = open && !previousOpen.current
    previousOpen.current = open
    if (!open) return

    setSelectedModelProtocols(current => {
      if (isOpening) return Object.keys(current).length === 0 ? current : {}
      return pruneModelProtocolSelection(enabledModels, current)
    })
    setSelectedProviderIds(current => {
      if (isOpening) return current.size === 0 ? current : new Set()
      return pruneProviderSelection(availableProviders, current)
    })
    if (isOpening) {
      setFailedOnly(false)
      // 展开态跟着结果走：重开面板时表是空的，残留的展开 id 只会在下一批结果里随机命中。
      setExpandedRowIds(current => (current.size === 0 ? current : new Set()))
      setView('results')
      setTestMode('streaming')
    }
  }, [open, enabledModels, availableProviders])

  /**
   * 这一批的骨架：用户打算测的每一行。服务端任务按 `key` 叠在它上面。
   *
   * 键里带着 `mode` / `rounds` / `inputLength`（见 `@common/diagnostics`），所以参数一变
   * 骨架的键就变——「换了参数重测」在服务端是新任务，在表里也该是另一行，不会假装成同一次。
   */
  const plannedRows = useMemo(
    () => buildPlannedRows(enabledModels, providers, selectedProviderIds, selectedModelProtocols, {
      mode: testMode,
      rounds: config.rounds,
      inputLength: config.inputLength,
    }),
    [enabledModels, providers, selectedProviderIds, selectedModelProtocols, testMode, config.rounds, config.inputLength],
  )
  const rows = useMemo(() => mergeTestRows(plannedRows, tasks, models, providers), [plannedRows, tasks, models, providers])
  const summary = useMemo(() => summarizeTestRows(rows), [rows])
  /** 服务端真的还在跑 / 还没跑的诊断任务（本地计划里的「排队」不算）。 */
  const busy = useMemo(() => tasks.some(task => task.kind === MODEL_TEST_TASK_KIND && (task.status === 'running' || task.status === 'queued')), [tasks])
  /**
   * 台账里有没有任务在跑——**任何 kind**，不只是诊断。
   *
   * 服务端的 `clear()` 是有在跑的就不清（`queue.ts`：那条在跑的行不该凭空消失），而它的
   * 判断是全台账的。所以「清空结果」的禁用条件必须是这一个，不能只看诊断的 `busy`：
   * 只看 `busy` 的话，将来加了第二个 kind，另一个 kind 在跑时按钮会亮着，按下去什么也不会
   * 发生——正是那条注释想防的事。
   */
  const anyRunning = useMemo(() => tasks.some(task => task.status === 'running'), [tasks])

  const hasResults = hasSettledOrRunning(rows)
  const startDisabled = plannedRows.length === 0
  const { rows: visibleRows, total: visibleTotal, failedOnlyActive: showFailedOnly } = getVisibleTestRows(rows, failedOnly)

  const toggleRowExpanded = (rowId: string) => {
    setExpandedRowIds(current => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  /**
   * 清空结果。
   *
   * 服务端有任务在跑时整条空操作，所以按钮那时是禁用的（见 {@link anyRunning}）；这里
   * 再挡一次是防「先点了清空、任务紧接着开跑」的竞态。
   *
   * 返回值**要读**：`cleared` 是服务端真的删掉了几条。它不会是 0 却没告诉我们——那种情况
   * 说明服务端什么都没清（竞态正好撞上、或台账已被别人清了），这时把本地视图当作「清过了」
   * 是自欺：结果其实还在，下一帧快照会把它们推回来。所以那种情况说一句实话，不动本地状态。
   */
  const clearResults = async () => {
    if (anyRunning) return
    let cleared: number
    try {
      cleared = await clear()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modelTest.notice.clearFailed'))
      return
    }
    if (cleared === 0) {
      toast.warning(t('modelTest.notice.clearSkipped'))
      return
    }
    setFailedOnly(false)
    setExpandedRowIds(current => (current.size === 0 ? current : new Set()))
  }

  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (busy) return
    setSelectedModelProtocols(current => toggleProtocolSelection(enabledModels, current, modelId, protocol))
    setFailedOnly(false)
  }

  const toggleProvider = (providerId: string) => {
    if (busy) return
    setSelectedProviderIds(current => toggleProviderSelection(current, providerId))
    setFailedOnly(false)
  }

  const toggleModel = (modelId: string) => {
    if (busy) return
    setSelectedModelProtocols(current => toggleModelSelection(enabledModels, current, modelId))
    setFailedOnly(false)
  }

  const allTasksSelected = isEveryTaskSelected(enabledModels, selectedProviderIds, selectedModelProtocols)

  const toggleAll = () => {
    if (busy) return
    const next = allTasksSelected
      ? clearAllTasks(enabledModels)
      : selectEveryTask(enabledModels, availableProviders)
    setSelectedProviderIds(next.providerIds)
    setSelectedModelProtocols(next.modelProtocols)
    setFailedOnly(false)
  }

  /**
   * 把当前参数与选择交给**服务端队列**。
   *
   * 这里只说「用这些参数跑这几行」，排队、并发、去重、取消收尾都在服务端。参数是
   * 开跑那一刻的快照：跑的过程中改配置不影响已经发出去的那一批。
   */
  const startRows = async (batch: readonly TestRow[]) => {
    try {
      const { accepted, skipped } = await enqueue(MODEL_TEST_TASK_KIND, toModelTestItems(batch, {
        mode: testMode,
        rounds: config.rounds,
        prompt: config.prompt,
        inputLength: config.inputLength,
      }))
      // `skipped` 是正常调度结果（同键已在队列里、队列满、载荷解析不过），但界面上必须
      // 说出来：静默跳过就是「点了没反应」。服务端只给两个计数，这里如实报两个数。
      if (skipped > 0) toast.warning(t('modelTest.notice.enqueueSkipped', { accepted, skipped }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('modelTest.notice.enqueueFailed'))
    }
  }

  const startTests = () => {
    setFailedOnly(false)
    void startRows(plannedRows)
  }

  /** 重测不重新规划：直接拿表里失败的那几行重跑，服务端按 `key` 去重、结果就地刷新。 */
  const retryFailedTests = () => {
    void startRows(rows.filter(row => row.status === 'failed'))
  }

  const stopTests = () => {
    void cancel({ kind: MODEL_TEST_TASK_KIND })
  }

  /** 关闭 = 收摊：还在跑或还排着队时先问一句，确认后取消这一批。 */
  const closePanel = async () => {
    if (busy) {
      const confirmed = await confirm({
        title: t('modelTest.confirm.close.title'),
        description: t('modelTest.confirm.close.description'),
        confirmLabel: t('modelTest.confirm.close.confirm'),
        variant: 'destructive',
      })
      if (!confirmed) return
      stopTests()
    }
    setMinimized(false)
    setOpen(false)
  }

  if (!open) return null
  if (minimized) {
    return <TestPanelBadge rows={rows} summary={summary} busy={busy} onExpand={() => setMinimized(false)} onCancel={stopTests} />
  }

  return (
    /*
     * 非模态浮窗：`fixed` 在右下角，没有遮罩、不铺灰、不抢焦点。页面照旧可交互、可滚动，
     * 面板只是浮在上面——这正是「边看日志边等结果」需要的形态。
     */
    <div className="flex h-[min(780px,92vh)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border border-module-border bg-popover text-sm text-popover-foreground shadow-2xl fixed right-4 bottom-4 z-50">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-popover px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConical size={15} aria-hidden /></div>
          <div className="min-w-0">
            <div className="truncate system-sm-medium text-text-primary">{t('modelTest.title')}</div>
            <div className="mt-1 truncate system-xs-regular text-text-tertiary">{t('modelTest.description')}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" title={t('modelTest.action.minimize')} aria-label={t('modelTest.action.minimize')} onClick={() => setMinimized(true)}>
            <Minus size={14} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('modelTest.action.close')} aria-label={t('modelTest.action.close')} onClick={() => void closePanel()}>
            <X size={14} aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
        <ModelSelection
          allTasksSelected={allTasksSelected}
          availableProviders={availableProviders}
          enabledModels={enabledModels}
          busy={busy}
          selectedModelProtocols={selectedModelProtocols}
          selectedProviderIds={selectedProviderIds}
          onToggleAll={toggleAll}
          onToggleModel={toggleModel}
          onToggleModelProtocol={toggleModelProtocol}
          onToggleProvider={toggleProvider}
        />

        <div className="flex min-h-0 flex-col bg-card">
          {view === 'config' ? (
            <TestConfigPanel
              config={config}
              onChange={setConfig}
              onBack={() => setView('results')}
              onReset={resetConfig}
            />
          ) : (
            <>
              <div className="px-4 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Gauge size={14} aria-hidden className="text-text-quaternary" />
                      <div>
                        <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{plannedRows.length}</div>
                        <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.tasks')}</div>
                      </div>
                    </div>
                    <div className="h-7 w-px bg-border" />
                    <div>
                      <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{selectedProviderIds.size}</div>
                      <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.channels')}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {hasResults && (
                      /*
                       * 有任务在跑时服务端不许清（那条在跑的行不该凭空消失），所以按钮留在
                       * 原地、置灰并说明原因——收起来只会让用户以为这个功能没了。
                       */
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={anyRunning}
                        title={t(anyRunning ? 'modelTest.action.clearResultsBusy' : 'modelTest.action.clearResults')}
                        aria-label={t(anyRunning ? 'modelTest.action.clearResultsBusy' : 'modelTest.action.clearResults')}
                        onClick={() => void clearResults()}
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                    {summary.failureCount > 0 && !busy && (
                      <Button variant="outline" size="sm" onClick={retryFailedTests}>
                        <RotateCcw size={12} /> {t('modelTest.action.retryFailed')}
                      </Button>
                    )}
                    {busy ? (
                      <Button variant="destructive" size="sm" onClick={stopTests}>
                        <Square size={11} fill="currentColor" /> {t('modelTest.action.stop')}
                      </Button>
                    ) : (
                      <>
                        {/* 设置按钮放在开始按钮左边：它是「开始之前先想一下」的前置动作。 */}
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title={t('modelTest.action.settings')}
                          aria-label={t('modelTest.action.settings')}
                          onClick={() => setView('config')}
                        >
                          <Settings2 size={13} aria-hidden />
                        </Button>
                        {/* 分裂按钮：左半是「用当前模式开始」，右半那枚箭头展开模式本身。 */}
                        <ButtonGroup>
                          <Button size="sm" disabled={startDisabled} onClick={startTests}>
                            <Play size={12} fill="currentColor" /> {t('modelTest.action.start')}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-sm"
                                disabled={startDisabled}
                                aria-label={t('modelTest.mode.select', { mode: t(TEST_MODE_LABEL_KEYS[testMode]) })}
                                title={t('modelTest.mode.select', { mode: t(TEST_MODE_LABEL_KEYS[testMode]) })}
                              >
                                <ChevronDown size={13} aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={6} className="w-72 min-w-72">
                              <DropdownMenuLabel>{t('modelTest.mode.label')}</DropdownMenuLabel>
                              <DropdownMenuSeparator className="bg-components-panel-border" />
                              <DropdownMenuRadioGroup
                                value={testMode}
                                onValueChange={value => {
                                  const next = ALL_MODEL_TEST_MODES.find(mode => mode === value)
                                  if (next) setTestMode(next)
                                }}
                              >
                                {ALL_MODEL_TEST_MODES.map(mode => (
                                  <DropdownMenuRadioItem
                                    key={mode}
                                    value={mode}
                                    className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg py-1.5 pl-2"
                                  >
                                    <span className="system-xs-medium text-text-primary">{t(TEST_MODE_LABEL_KEYS[mode])}</span>
                                    <span className="system-2xs-regular leading-4 text-text-tertiary">{t(TEST_MODE_HINT_KEYS[mode])}</span>
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </ButtonGroup>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <TestProgress
                cancelledCount={summary.cancelledCount}
                completedCount={summary.completedCount}
                failureCount={summary.failureCount}
                progress={summary.progress}
                running={busy}
                successCount={summary.successCount}
                totalCount={visibleTotal}
              />

              <main className="min-h-0 flex-1 overflow-auto p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Button variant={showFailedOnly ? 'ghost' : 'secondary'} size="xs" onClick={() => setFailedOnly(false)}>{t('modelTest.filter.all')}</Button>
                    <Button variant={showFailedOnly ? 'secondary' : 'ghost'} size="xs" disabled={!hasResults || summary.failureCount === 0} onClick={() => setFailedOnly(true)}>
                      {summary.failureCount > 0 ? `${t('modelTest.filter.failed')} · ${summary.failureCount}` : t('modelTest.filter.failed')}
                    </Button>
                  </div>
                  <span className="font-mono system-2xs-regular tabular-nums text-text-quaternary">{visibleRows.length} / {visibleTotal}</span>
                </div>
                {visibleRows.length > 0 ? (
                  <TableFrame>
                    <TableHeaderSurface className={cn('hidden gap-3 px-3 py-2 md:grid', TASK_GRID_COLUMNS)}>
                      <span aria-hidden />
                      <span>{t('modelTest.table.target')}</span>
                      <span>{t('modelTest.table.protocol')}</span>
                      <span>{t('modelTest.table.status')}</span>
                      <span className="text-right">{t('modelTest.table.ttft')}</span>
                      <span className="text-right">{t('modelTest.table.duration')}</span>
                      <span className="text-right">{t('modelTest.table.speed')}</span>
                      <span className="text-right">{t('modelTest.table.tokens')}</span>
                    </TableHeaderSurface>
                    {visibleRows.map(row => (
                      <TestTaskRow
                        key={row.id}
                        row={row}
                        expanded={expandedRowIds.has(row.id)}
                        onToggleExpanded={() => toggleRowExpanded(row.id)}
                      />
                    ))}
                  </TableFrame>
                ) : (
                  <EmptyTestTasks hasEnabledModels={enabledModels.length > 0} />
                )}
              </main>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
