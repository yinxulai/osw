import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Cpu,
  FlaskConical,
  Gauge,
  Loader2,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Square,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { ALL_MODEL_TEST_MODES, type ModelTestMode, type Protocol, type Provider, type ProviderModelRoute } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { CONVERTIBLE_PROTOCOLS, PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { modelTestApi, type ModelTestResult } from '@/api/tools'
import { InlineEmptyState } from '@/components/inline-empty-state'
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
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: ProviderModelRoute[]
  providers: Provider[]
}

type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

interface TestTask {
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  converted: boolean
  status: TestTaskStatus
  result?: ModelTestResult
  errorMessage?: string
}

const PROTOCOL_LABELS: Record<Protocol, string> = { ...PROTOCOL_DISPLAY_NAMES }

const TEST_CONCURRENCY = 3

/** 结果表列宽模板：表头与数据行共用一份，避免两处列宽各改一半。
 *  首字与速度两列对所有模式都在：连通性只能填 `—`，但列数不跟着数据变——
 *  同一张表在三种模式之间来回切时列宽就不该跳。 */
const TASK_GRID_COLUMNS = 'md:grid-cols-[20px_minmax(140px,1.6fr)_minmax(88px,0.9fr)_56px_64px_60px_58px_minmax(84px,auto)]'

const TEST_MODE_LABEL_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  connectivity: 'modelTest.mode.connectivity',
  streaming: 'modelTest.mode.streaming',
  speed: 'modelTest.mode.speed',
}

const TEST_MODE_HINT_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  connectivity: 'modelTest.mode.connectivityHint',
  streaming: 'modelTest.mode.streamingHint',
  speed: 'modelTest.mode.speedHint',
}

const TASK_STATUS_LABEL_KEYS: Record<TestTaskStatus, UiCatalogKey> = {
  queued: 'modelTest.status.queued',
  running: 'modelTest.status.running',
  success: 'modelTest.status.success',
  failed: 'modelTest.status.failed',
  cancelled: 'modelTest.status.cancelled',
}

function getTestableProtocols(model: ProviderModelRoute): Protocol[] {
  const protocols = new Set(model.endpoints.map(endpoint => endpoint.protocol))
  for (const endpoint of model.endpoints) {
    if (!endpoint.protocolConversionEnabled) continue
    for (const protocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) protocols.add(protocol)
  }
  return [...protocols]
}

function supportsConvertedProtocol(model: ProviderModelRoute, protocol: Protocol): boolean {
  return !model.endpoints.some(endpoint => endpoint.protocol === protocol)
    && model.endpoints.some(endpoint => endpoint.protocolConversionEnabled && CONVERTIBLE_PROTOCOLS[endpoint.protocol].includes(protocol))
}

interface ProtocolButtonState {
  converted: boolean
  selected: boolean
}

interface ProtocolButtonLabelOptions {
  converted: boolean
  protocol: Protocol
  t: AppTranslator
}

/**
 * 协议胶囊：未选中只给文字，选中才上底色。
 * 未选中只给纯文字 + 悬浮底色：给每个胶囊铺 `bg-inset` 会在列里排出一片灰底小方块，
 * 同一屏里的灰底块越少越好。转换出来的协议（`converted`）用 warning 色区分，选中时再用浅底强调。
 */
function getProtocolButtonClassName(state: ProtocolButtonState): string {
  if (state.converted) {
    return state.selected
      ? 'bg-warning/15 text-text-warning'
      : 'text-text-warning hover:bg-warning/10'
  }
  if (state.selected) return 'bg-primary text-primary-foreground'
  return 'text-text-tertiary hover:bg-state-base-hover hover:text-text-primary'
}

function getProtocolButtonTitle(options: ProtocolButtonLabelOptions): string {
  const label = PROTOCOL_LABELS[options.protocol]
  return options.converted ? options.t('protocol.conversion.aria', { protocol: label }) : label
}

/** 响应列只放「HTTP 状态 + 输出 token」：耗时、首字与速度各自占一列，扫一眼就能横向比对。 */
function getTaskResponseLabel(task: TestTask): string {
  if (!task.result) return '—'
  const status = task.result.statusCode ? `HTTP ${task.result.statusCode}` : '—'
  if (!task.result.success) return status
  return `${status} ↓${task.result.outputTokens ?? '—'}`
}

function getTaskDurationLabel(task: TestTask): string {
  return task.result ? formatMilliseconds(task.result.durationMilliseconds) : '—'
}

/** 首字耗时只量得到流式：整包响应里没有「第一块」这个时刻，没量到就写 `—`，不编一个 0。 */
function getTaskTtftLabel(task: TestTask): string {
  return task.result ? formatMilliseconds(task.result.ttftMilliseconds) : '—'
}

/** 出字速度只有速度诊断会给：其余模式里分母是两个数减出来的，宁缺勿编。 */
function getTaskSpeedLabel(task: TestTask): string {
  if (!task.result) return '—'
  const speed = formatOutputSpeed(task.result.tokensPerSecond)
  return speed === '—' ? '—' : `${speed} t/s`
}

interface TaskStatusProps {
  status: TestTaskStatus
}

function TaskStatus(props: TaskStatusProps) {
  const t = useTranslation()
  const { status } = props
  // 图标是唯一的状态载体，必须给读屏留一个名字，否则整列读出来是空的。
  const label = t(TASK_STATUS_LABEL_KEYS[status])
  if (status === 'running') return <Loader2 size={15} role="img" aria-label={label} className="animate-spin text-primary" />
  if (status === 'success') return <CheckCircle2 size={15} role="img" aria-label={label} className="text-text-success" />
  if (status === 'failed') return <XCircle size={15} role="img" aria-label={label} className="text-text-destructive" />
  if (status === 'cancelled') return <Square size={13} role="img" aria-label={label} className="text-text-quaternary" />
  return <Circle size={15} role="img" aria-label={label} className="text-text-quaternary" />
}

interface ModelSelectionProps {
  allTasksSelected: boolean
  availableProviders: Provider[]
  enabledModels: ProviderModelRoute[]
  running: boolean
  selectedModelProtocols: Record<string, Set<Protocol>>
  selectedProviderIds: Set<string>
  onToggleAll: () => void
  onToggleModelProtocol: (modelId: string, protocol: Protocol) => void
  onToggleProvider: (providerId: string) => void
}

function ModelSelection(props: ModelSelectionProps) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const providerViews = useMemo(() => props.availableProviders.map(provider => {
    const selected = props.selectedProviderIds.has(provider.id)
    const models = props.enabledModels
      .filter(model => model.providerId === provider.id)
      .filter(model => !normalizedQuery
        || provider.name.toLocaleLowerCase().includes(normalizedQuery)
        || model.modelName.toLocaleLowerCase().includes(normalizedQuery))
      .map(model => {
        const protocols = getTestableProtocols(model)
        const selectedProtocols = props.selectedModelProtocols[model.id] ?? new Set(protocols)
        return {
          model,
          selectedCount: selectedProtocols.size,
          protocols: protocols.map(protocol => {
            const converted = supportsConvertedProtocol(model, protocol)
            const protocolSelected = selectedProtocols.has(protocol)
            return {
              protocol,
              converted,
              selected: protocolSelected,
              label: PROTOCOL_LABELS[protocol],
              title: getProtocolButtonTitle({ converted, protocol, t }),
              className: getProtocolButtonClassName({ converted, selected: protocolSelected }),
            }
          }),
        }
      })
    return {
      provider,
      selected,
      models,
      selectedCount: models.filter(model => model.selectedCount > 0).length,
    }
  }).filter(view => view.models.length > 0), [normalizedQuery, props.availableProviders, props.enabledModels, props.selectedModelProtocols, props.selectedProviderIds, t])

  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 bg-card lg:border-r lg:border-b-0">
      {/* 头部与搜索不铺底色，靠底部发丝线跟列表分开（左侧栏原本整块 `bg-inset`，是这页最主要的灰盒子）。 */}
      <div className="grid shrink-0 gap-3 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="system-xs-medium text-text-primary">{t('modelTest.selection.title')}</div>
            <div className="mt-0.5 system-2xs-regular text-text-tertiary">{t('modelTest.selection.description')}</div>
          </div>
          <Button variant="ghost" size="xs" disabled={props.running || props.enabledModels.length === 0} onClick={props.onToggleAll}>
            {props.allTasksSelected ? t('modelTest.selection.clear') : t('common.action.selectAll')}
          </Button>
        </div>
        <div className="relative">
          <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-quaternary" />
          <Input
            value={query}
            disabled={props.running}
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
                disabled={props.running}
                aria-label={providerView.provider.name}
                onCheckedChange={() => props.onToggleProvider(providerView.provider.id)}
              />
              <button
                type="button"
                disabled={props.running}
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
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{modelView.model.modelName}</span>
                      <span className="shrink-0 system-2xs-regular tabular-nums text-text-quaternary">{modelView.selectedCount}/{modelView.protocols.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {modelView.protocols.map(protocolView => (
                        <button
                          key={`${modelView.model.id}:${protocolView.protocol}`}
                          type="button"
                          disabled={props.running}
                          aria-pressed={protocolView.selected}
                          title={protocolView.title}
                          className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 system-2xs-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', protocolView.className)}
                          onClick={() => props.onToggleModelProtocol(modelView.model.id, protocolView.protocol)}
                        >
                          {protocolView.converted && <Repeat size={9} aria-hidden />}
                          {protocolView.label}
                        </button>
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

interface TestTaskRowProps {
  task: TestTask
}

interface EmptyTestTasksProps {
  hasEnabledModels: boolean
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

function TestTaskRow(props: TestTaskRowProps) {
  const { task } = props
  const t = useTranslation()
  return (
    <div className={cn(tableRowClass, 'grid grid-cols-1 gap-2 px-3 py-2.5 md:items-center md:gap-3', TASK_GRID_COLUMNS)}>
      <TaskStatus status={task.status} />
      <div className="min-w-0">
        <div className="truncate system-xs-medium text-text-primary">{task.providerName}</div>
        <div className="mt-0.5 truncate font-mono system-2xs-regular text-text-tertiary">{task.modelName}</div>
      </div>
      <div className="min-w-0 system-2xs-regular text-text-tertiary">
        <span className={cn('inline-flex items-center gap-1 truncate', task.converted && 'text-text-warning')}>
          {task.converted && <Repeat size={9} aria-hidden />}{PROTOCOL_LABELS[task.protocol]}
        </span>
      </div>
      <div className={cn('system-2xs-medium', task.status === 'success' && 'text-text-success', task.status === 'failed' && 'text-text-destructive', task.status === 'running' && 'text-text-primary', task.status === 'cancelled' && 'text-text-tertiary')}>{t(TASK_STATUS_LABEL_KEYS[task.status])}</div>
      <div className="font-mono system-2xs-regular tabular-nums text-text-tertiary md:text-right">{getTaskTtftLabel(task)}</div>
      <div className="font-mono system-2xs-regular tabular-nums text-text-tertiary md:text-right">{getTaskDurationLabel(task)}</div>
      <div className="font-mono system-2xs-regular tabular-nums text-text-tertiary md:text-right">{getTaskSpeedLabel(task)}</div>
      <div className="font-mono system-2xs-regular tabular-nums text-text-tertiary md:text-right">{getTaskResponseLabel(task)}</div>
      {task.errorMessage && <div className="col-span-full wrap-break-word rounded-lg border border-module-border bg-destructive/8 px-2.5 py-2 font-mono system-2xs-regular leading-4 text-text-destructive md:ml-8">{task.errorMessage}</div>}
    </div>
  )
}

function EmptyTestTasks(props: EmptyTestTasksProps) {
  const t = useTranslation()
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      {/* 空状态只用一枚淡图标，不再给图标铺灰底方块——同一屏里的灰盒子越少越好。 */}
      <Cpu size={20} strokeWidth={1.5} aria-hidden className="mb-1.5 text-text-quaternary" />
      <div className="system-xs-medium text-text-primary">{props.hasEnabledModels ? t('modelTest.empty.noTasks') : t('modelTest.empty.noModels')}</div>
      <div className="mt-1.5 max-w-sm system-xs-regular leading-5 text-text-tertiary">
        {props.hasEnabledModels ? t('modelTest.empty.noTasksHint') : t('modelTest.empty.noModelsHint')}
      </div>
    </div>
  )
}

export function ModelTestPanel(props: ModelTestPanelProps) {
  const t = useTranslation()
  const enabledModels = useMemo(() => props.models.filter(model => model.enabled), [props.models])
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedModelProtocols, setSelectedModelProtocols] = useState<Record<string, Set<Protocol>>>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TestTask[]>([])
  const [failedOnly, setFailedOnly] = useState(false)
  /** 本轮诊断要问哪个问题。只影响「下一次开始」：已经有结论的行保留它自己跑的模式。 */
  const [testMode, setTestMode] = useState<ModelTestMode>('connectivity')
  const [running, setRunning] = useState(false)
  const previousOpen = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  /**
   * `running` 是渲染状态，要等下一帧才变成 `true`：连点两下「开始诊断」时两个
   * 事件处理器看到的都还是 `false`，会同时打两批真实请求（真的花钱）。
   * 用 ref 做同步闸门，并把定时器 / 网络请求都挂在同一批身上。
   */
  const runningRef = useRef(false)

  // 面板被卸载（切换页面）时掐掉在跑的那批诊断，避免用户已经离开还在持续计费。
  useEffect(() => () => abortControllerRef.current?.abort(), [])

  /**
   * 模型 / 供应商集合变化后校正选中态。
   *
   * 三个 updater 都遵守同一条规矩：**没有实际变化就返回 `current`**。
   * 否则这里每次都返回新对象 / 新 Set / 新数组，而 `enabledModels`、`availableProviders`
   * 又会随父级重渲染（供应商轮询每 10s、模型轮询每 30s）而重建，
   * 于是「重渲染 → 重跑 effect → 写新 state → 再重渲染」会一直空转。
   */
  useEffect(() => {
    const isOpening = props.open && !previousOpen.current
    previousOpen.current = props.open
    if (!props.open) return

    setSelectedModelProtocols(current => {
      if (isOpening) return Object.keys(current).length === 0 ? current : {}
      let changed = false
      const next: Record<string, Set<Protocol>> = {}
      for (const model of enabledModels) {
        const kept = new Set([...(current[model.id] ?? [])].filter(protocol => getTestableProtocols(model).includes(protocol)))
        const previous = current[model.id]
        // `kept` 是 `previous` 的子集，长度相同就意味着一个都没被剔掉，可以沿用原 Set 引用。
        if (previous && previous.size === kept.size) next[model.id] = previous
        else {
          next[model.id] = kept
          changed = true
        }
      }
      if (Object.keys(next).length !== Object.keys(current).length) changed = true
      return changed ? next : current
    })
    setSelectedProviderIds(current => {
      if (isOpening) return current.size === 0 ? current : new Set()
      const next = new Set([...current].filter(providerId => availableProviders.some(provider => provider.id === providerId)))
      return next.size === current.size ? current : next
    })
    if (isOpening) {
      setTasks(current => (current.length === 0 ? current : []))
      setFailedOnly(false)
      // 每次重新打开都从默认模式开始：上次点到「速度诊断」后关掉面板，
      // 下次再进来时应该看到默认的连通性诊断，而不是一个没被注意到的长提示词诊断。
      setTestMode('connectivity')
      setRunning(false)
    }
  }, [props.open, enabledModels, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = selectedModelProtocols[model.id] ?? new Set(getTestableProtocols(model))
    return getTestableProtocols(model).filter(protocol => selectedProtocols.has(protocol)).map(protocol => ({
      id: `${model.id}:${protocol}`,
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      protocol,
      converted: supportsConvertedProtocol(model, protocol),
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds])

  const hasResults = tasks.length > 0
  /** 没有可测目标时「开始诊断」与右侧的模式箭头一起变灰：它是同一个控件的两半。 */
  const startDisabled = plannedTasks.length === 0
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const cancelledCount = tasks.filter(task => task.status === 'cancelled').length
  const completedCount = successCount + failureCount + cancelledCount
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)
  /**
   * 重测成功后失败数会归零，此时不能再停留在「只看失败」上——否则表格会空白，
   * 而失败行其实已经变绿了。所以筛选生效与否是推导出来的，不写回 state。
   */
  const showFailedOnly = failedOnly && failureCount > 0
  const visibleTasks = hasResults
    ? showFailedOnly ? tasks.filter(task => task.status === 'failed') : tasks
    : plannedTasks
  const visibleTotal = hasResults ? tasks.length : plannedTasks.length

  const clearTasks = () => {
    setTasks([])
    setFailedOnly(false)
  }
  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (running) return
    setSelectedModelProtocols(current => {
      const next = { ...current }
      const selectedProtocols = new Set(current[modelId] ?? [])
      if (selectedProtocols.has(protocol)) selectedProtocols.delete(protocol)
      else selectedProtocols.add(protocol)
      next[modelId] = selectedProtocols
      return next
    })
    clearTasks()
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    clearTasks()
  }

  const allTasksSelected = enabledModels.length > 0
    && enabledModels.every(model => selectedProviderIds.has(model.providerId)
      && getTestableProtocols(model).every(protocol => selectedModelProtocols[model.id]?.has(protocol)))

  const toggleAll = () => {
    if (running) return
    if (allTasksSelected) {
      setSelectedProviderIds(new Set())
      setSelectedModelProtocols(Object.fromEntries(enabledModels.map(model => [model.id, new Set<Protocol>()])))
    } else {
      setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
      setSelectedModelProtocols(Object.fromEntries(
        enabledModels.map(model => [model.id, new Set(getTestableProtocols(model))]),
      ))
    }
    clearTasks()
  }

  /**
   * 跑一批诊断任务。
   *
   * - `runningRef` 做同步闸门：诊断会真的请求上游并计费，任何时候都只允许一批在跑。
   * - 任务按 id 合并进结果表：整批开跑时表里通常是空的，重测时其它行的结论原样保留。
   * - 并发只在这里控制（`TEST_CONCURRENCY` 个 worker），服务端一次请求只测一个目标。
   */
  const runTasks = async (batch: TestTask[]) => {
    if (runningRef.current || batch.length === 0) return
    const pending = batch.map(task => ({ ...task, status: 'queued' as const, result: undefined, errorMessage: undefined }))
    const controller = new AbortController()
    runningRef.current = true
    abortControllerRef.current = controller
    setRunning(true)
    setTasks(current => {
      if (current.length === 0) return pending
      const byId = new Map(pending.map(task => [task.id, task]))
      return current.map(task => byId.get(task.id) ?? task)
    })
    let nextIndex = 0

    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < pending.length) {
        const task = pending[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        try {
          const response = await modelTestApi.run(task.protocol, testMode, {
            providerIds: [task.providerId],
            modelIds: [task.modelId],
          }, controller.signal)
          if (controller.signal.aborted) break
          const result = response.success
            ? response.data.results.find(item => item.modelId === task.modelId)
            : undefined
          const succeeded = Boolean(result?.success)
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: succeeded ? 'success' : 'failed',
            result,
            errorMessage: response.success
              ? result ? result.errorMessage : t('modelTest.error.missingEndpoint')
              : response.errorMessage,
          } : item))
        } catch (error) {
          if (controller.signal.aborted) break
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : t('modelTest.error.requestFailed'),
          } : item))
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, pending.length) }, () => worker()))
    } finally {
      if (controller.signal.aborted) {
        setTasks(current => current.map(task => task.status === 'queued' || task.status === 'running'
          ? { ...task, status: 'cancelled', errorMessage: undefined }
          : task))
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      runningRef.current = false
      setRunning(false)
    }
  }

  const startTests = () => {
    setFailedOnly(false)
    void runTasks(plannedTasks)
  }

  /** 重测不重新规划：直接拿表里失败的那几行重跑，结果就地刷新，其它行不动。 */
  const retryFailedTests = () => {
    void runTasks(tasks.filter(task => task.status === 'failed'))
  }

  const cancelTests = () => abortControllerRef.current?.abort()

  return (
    <Dialog open={props.open} onOpenChange={open => !running && props.onOpenChange(open)}>
      <DialogContent className="flex h-[min(780px,92vh)] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="bg-popover px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConical size={15} aria-hidden /></div>
            <div className="min-w-0">
              <DialogTitle>{t('modelTest.title')}</DialogTitle>
              <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">{t('modelTest.description')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
          <ModelSelection
            allTasksSelected={allTasksSelected}
            availableProviders={availableProviders}
            enabledModels={enabledModels}
            running={running}
            selectedModelProtocols={selectedModelProtocols}
            selectedProviderIds={selectedProviderIds}
            onToggleAll={toggleAll}
            onToggleModelProtocol={toggleModelProtocol}
            onToggleProvider={toggleProvider}
          />

          <div className="flex min-h-0 flex-col bg-card">
            <div className="px-4 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} aria-hidden className="text-text-quaternary" />
                    <div>
                      <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{plannedTasks.length}</div>
                      <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.tasks')}</div>
                    </div>
                  </div>
                  <div className="h-7 w-px bg-border" />
                  <div>
                    <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{selectedProviderIds.size}</div>
                    <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.channels')}</div>
                  </div>
                  <div className="h-7 w-px bg-border" />
                  <div>
                    <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{TEST_CONCURRENCY}</div>
                    <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.concurrency')}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {hasResults && !running && (
                    <Button variant="ghost" size="icon-sm" title={t('modelTest.action.clearResults')} aria-label={t('modelTest.action.clearResults')} onClick={clearTasks}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                  {failureCount > 0 && !running && (
                    <Button variant="outline" size="sm" onClick={retryFailedTests}>
                      <RotateCcw size={12} /> {t('modelTest.action.retryFailed')}
                    </Button>
                  )}
                  {running ? (
                    <Button variant="destructive" size="sm" onClick={cancelTests}>
                      <Square size={11} fill="currentColor" /> {t('modelTest.action.stop')}
                    </Button>
                  ) : (
                    /*
                      分裂按钮：左半是「用当前模式开始」，右半那枚箭头展开模式本身。
                      箭头紧贴在开始按钮右侧、与之同色同高，读起来是一个控件；
                      单独拿出一枚圆角按钮会把「选模式」说成另一件事。
                    */
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
                        {/* 浮层改成固定宽度：默认宽度跟随触发器（一枚 28px 的方块），两行文案会被挤成一列。 */}
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
                  )}
                </div>
              </div>
            </div>

            <TestProgress
              cancelledCount={cancelledCount}
              completedCount={completedCount}
              failureCount={failureCount}
              progress={progress}
              running={running}
              successCount={successCount}
              totalCount={visibleTotal}
            />

            <main className="min-h-0 flex-1 overflow-auto p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button variant={showFailedOnly ? 'ghost' : 'secondary'} size="xs" onClick={() => setFailedOnly(false)}>{t('modelTest.filter.all')}</Button>
                  <Button variant={showFailedOnly ? 'secondary' : 'ghost'} size="xs" disabled={!hasResults || failureCount === 0} onClick={() => setFailedOnly(true)}>
                    {failureCount > 0 ? `${t('modelTest.filter.failed')} · ${failureCount}` : t('modelTest.filter.failed')}
                  </Button>
                </div>
                <span className="font-mono system-2xs-regular tabular-nums text-text-quaternary">{visibleTasks.length} / {visibleTotal}</span>
              </div>
              {visibleTasks.length > 0 ? (
                <TableFrame>
                  <TableHeaderSurface className={cn('hidden gap-3 px-3 py-2 md:grid', TASK_GRID_COLUMNS)}>
                    <span />
                    <span>{t('modelTest.table.target')}</span>
                    <span>{t('modelTest.table.protocol')}</span>
                    <span>{t('modelTest.table.status')}</span>
                    <span className="text-right">{t('modelTest.table.ttft')}</span>
                    <span className="text-right">{t('modelTest.table.duration')}</span>
                    <span className="text-right">{t('modelTest.table.speed')}</span>
                    <span className="text-right">{t('modelTest.table.response')}</span>
                  </TableHeaderSurface>
                  {visibleTasks.map(task => <TestTaskRow key={task.id} task={task} />)}
                </TableFrame>
              ) : (
                <EmptyTestTasks hasEnabledModels={enabledModels.length > 0} />
              )}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
