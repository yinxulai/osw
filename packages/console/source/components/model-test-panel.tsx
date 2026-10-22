import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  Gauge,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
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
import { useTranslation } from '@/i18n/provider'
import { formatPercent } from '@/lib/format-percent'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { clampConfigNumber } from '@/lib/model-test/config'
import {
  buildPlannedTasks,
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
  getVisibleTestTasks,
  summarizeTestTasks,
} from '@/lib/model-test/results'
import { useModelTestRunner } from '@/pages/model-management/hooks/use-model-test-runner'
import type { TestTask, TestTaskStatus } from '@/pages/model-management/lib/model-test-runner'
import { useModelTestConfigStore, type TestConfig } from '@/store/model-test-config'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: ProviderModelRoute[]
  providers: Provider[]
}

/**
 * 结果表列宽模板：表头与数据行共用一份，避免两处列宽只改一半。
 *
 * **一格只放一个事实。** 原先最后一格是「HTTP 404 ↓1234」：协议结论（上游回了什么）
 * 与产出量（出了多少 Token）是两个量纲，挤在一格里读起来像一句话，横向比对时又只能
 * 整格扫——两列数据都等于没有列。现在 HTTP 状态回到它自己的「状态」列，输出 Token
 * 单独一列，与首字、耗时、速度三列并排，四个数字右对齐、等宽数字，扫一眼就能竖着比。
 *
 * 协议**单独成列**：色条只能表达「这条是转出来的」，说不出「测的是哪个协议」。
 * 一行就是一个「模型 × 协议」，扫结果时最常见的提问就是「哪个协议挂了」，所以它值这一列。
 *
 * 最左边那 20px 是展开箭头：每行都能展开逐轮明细（轮次、成功率、错误原文）。
 * 箭头单独占一列而不是塞进状态格，是因为状态格要能一眼竖着扫下来，多一个交互形状就扫不动。
 *
 * 列对所有模式都在，且列数不跟着数据变：没有量到的格写 `—`，但表结构不动——
 * 同一张表在两种模式之间来回切时列宽就不该跳。
 *
 * 窄屏（< md）落回单列堆叠，那时行里每格自带标签（{@link TaskCell} 的 `labelKey`），
 * 因为表头整条藏起来了。
 */
const TASK_GRID_COLUMNS = 'md:grid-cols-[20px_minmax(150px,1.4fr)_minmax(120px,0.9fr)_66px_62px_64px_64px_64px]'

/**
 * 明细里逐轮的列宽模板：列名横条与每一轮共用一份。
 *
 * 原先每一轮是一串 `flex-wrap` 的「标签 值」：七组读数挤在左边、按可用宽度随意折行，
 * 第 1 轮与第 3 轮的同一个数根本不在同一列上——「这几轮 TPS 稳不稳」「是哪一轮的首字慢了」
 * 这种最常问的问题，反而没法竖着比出来。现在它与上面那张结果表用同一套做法：
 * 列名只说一次，数据按列右对齐、等宽数字。
 *
 * 宽度按**列名**留的（`HTTP 状态`、`输出 Token` 比 `429`、`1.2k` 宽）：列宽跟着数据走的话，
 * 一次失败把 `—` 换成 `429` 就会让整张明细横向跳一格。
 */
const ROUND_GRID_COLUMNS = 'md:grid-cols-[68px_56px_68px_80px_80px_76px_92px]'

const TEST_MODE_LABEL_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  streaming: 'modelTest.mode.streaming',
  speed: 'modelTest.mode.speed',
}

const TEST_MODE_HINT_KEYS: Record<ModelTestMode, UiCatalogKey> = {
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

/**
 * 协议分段控件的**底座**：一条凹槽（`bg-inset`），放这个模型的全部可测协议。
 *
 * 之所以从「各自独立的胶囊」改成一条槽里的分段：原来每个协议是一颗浅灰描边小方块，
 * 横着排开像三个不相干的标签；改成一条槽里的分段后，「这几个是同一个人身上的选项、
 * 只有几个能亮」才在形状上说清楚——这跟「渠道里的模型」是同一类多选关系。
 *
 * 槽本身会**换行**（`flex-wrap`）：协议名一律用正式写法（`OpenAI Completions`），
 * 三个满名并排在 340px 的侧栏里排不下，宁可多占一行，不减字——缩写会引出第二个叫法，
 * 而同一个概念有两种写法比多一行代价大得多（见 `PROTOCOL_DISPLAY_NAMES` 的说明）。
 *
 * 用 `bg-inset` 而不是描边：描边要画六条边，凹槽只画一层底色；同一屏里的灰盒子越少越好。
 */
const PROTOCOL_TRACK_CLASS = 'inline-flex flex-wrap items-stretch gap-0.5 rounded-md bg-inset p-0.5'

/**
 * 一个协议分段：`字形 + 协议正式名`（`OpenAI Completions`）。
 *
 * 名字不省：槽里排不下时就换行。以前这里印的是短名（`Completions`），理由是一个模型行
 * 里重复三遍厂商名太啰嗦；但省下那截以后，同屏里的协议就出现了两种写法——旁边列着
 * `OpenAI Responses`，这里写着 `Responses`，读者得自己判断它们是不是同一个东西。
 * 省字的地方用换行解决，不用减字。
 *
 * 三态（选中 / 未选中 / 转换）各自的长相与配色是一张纯映射表，住在
 * `@/lib/model-test/selection`：哪个状态长什么样，可以脱开渲染直接断言。
 */
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
  running: boolean
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
                    {/*
                     * 一行定一个模型。选中供应商之后，逐个点分段挑协议很费手（每段只有
                     * 二十来像素宽），于是补一个整行级别的勾选：勾选框本身、模型名、
                     * 右侧计数三处都走同一个开关。分段保留，它才是细粒度控制；
                     * 只是在「一个模型只想测一个协议」之前不必用它。
                     */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <Checkbox
                        checked={modelView.indeterminate ? 'indeterminate' : modelView.selected}
                        disabled={props.running}
                        aria-label={t('modelTest.selection.modelAria', { name: modelView.model.modelName })}
                        onCheckedChange={() => props.onToggleModel(modelView.model.id)}
                      />
                      <button
                        type="button"
                        disabled={props.running}
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
                          disabled={props.running}
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

interface TestTaskRowProps {
  task: TestTask
  expanded: boolean
  onToggleExpanded: () => void
}

/** 展开体只接一条已完成的结论：没有 `result` 的行没有逐轮可看。 */
interface TestTaskDetailProps {
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

interface TaskCellProps {
  /** 格子的窄屏标签 key。表头管着 md 及以上，所以它只在这之下渲染。 */
  labelKey: UiCatalogKey
  /**
   * `'end'` 的格子右对齐并走等宽数字：这一列是拿来纵向比大小的。
   * 文字格（渠道 / 模型、状态）留 `'start'`，读的是内容本身。
   */
  align?: 'start' | 'end'
  children: React.ReactNode
}

/**
 * 结果行里的一格数据。
 *
 * 窄屏堆叠时左边补一个标签：表头在 md 以下整条藏起来，`—` 与 `1.2k` 排成一串
 * 没有名字的读数时，读者只能靠第几行去猜哪个是耗时。md 及以上标签由表头统一说一次，
 * 这里就收起来，不在每行重复七遍（对比 `ClientRow` 的同一条理由）。
 */
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

/**
 * 展开体：一排指标块，下面一张带框的逐轮表。
 *
 * 这两段的形状不是这里发明的：它就是请求详情展开区的那两段。上一版给这个面板单独
 * 造了一套读数样式（描框 → 铺灰 → 只剩列间竖线），每一版都不对，因为同一屏里
 * 已经有一份经过验证的答案——**带框的指标芯片 + 带框的分块表**，靠的是同一套零件
 * （`MetricCard` / `TableHeaderSurface`）。
 *
 * 为什么两段都要：多轮诊断的结论是「全部轮次都成功才算成功」，所以只看逐轮列表
 * 读不出「这个渠道到底算不算能用」；而只看汇总又不知道失败的那轮究竟回了什么。
 * 指标在上、逐轮在下，先回答「能不能用」，再回答「哪一轮、为什么」。
 *
 * 汇总这里**故意用指标块而不是一句结论**：诊断要回答的是「这个渠道能不能用、
 * 首字多快、出字多快、缓存有没有被用上」这几件互相独立的事，写成一句话就只能挑
 * 一件说；摊成几块之后每个数各有各的位置。
 *
 * **四块，行内等分排满**。总耗时与输入 / 输出 Token 不进来：耗时在上面的结果行里
 * 已经有一格，Token 用量在逐轮表里逐行列出——汇总区再抄一份，同一批数字就有了第二个
 * 口径。缓存命中率不一样：它不是「用量」，而是「这个渠道的提示词缓存到底有没有被用上」
 * 的一个判断——逐轮表里没有、结果行里也没有，不放到这里就没有地方能回答它。
 * 四块用 `grid-cols-2 md:grid-cols-4` 而非 `auto-fill`：`auto-fill` 会把它们挤在左边
 * 一小段，右边拖出一条空灰带；窄屏两行两列，避免四个数在手机上各自断行。
 *
 * 明细里不重复「渠道 / 模型 / 协议」——它们就在正上面那一行，重复一遍只是把
 * 一张小表拉长。
 */
function TaskDetail(props: TestTaskDetailProps) {
  const t = useTranslation()
  const result = props.task.result!
  const rounds = getResultRounds(result)
  const successCount = rounds.filter(round => round.success).length
  const successRate = getRoundSuccessRate(rounds)
  // 汇总值一律取服务端的 `result`（`summarizeRounds` 是唯一定义处），不在这里重算——
  // 界面再算一遍，同一个渠道就会在服务端日志和这张卡上有两个数。
  const speed = formatOutputSpeed(result.tokensPerSecond)
  // 命中率不在这一层重算：服务端 `summarizeRounds` 已经把分子分母各自取了均值，
  // 这里只把「比率」交给 `@common/metrics` 的唯一定义算一次。任一值为 `null`
  // （上游压根没报缓存字段）就写 `—`，不能算成 `0%`——那是「一次都没命中」的说法。
  const hitRate = result.cachedInputTokens == null || result.inputTokens == null
    ? null
    : cacheHitRate(result.cachedInputTokens, result.inputTokens)
  const metrics: MetricCardProps[] = [
    {
      label: t('modelTest.detail.successRate'),
      value: `${successCount}/${rounds.length} · ${successRate}%`,
      // 只有「全过」算通过，所以没到 100% 就是失败：这个数的好坏本身就是结论。
      tone: successRate === 100 ? 'success' : 'destructive',
    },
    { label: t('modelTest.detail.ttft'), value: formatMilliseconds(result.ttftMilliseconds) },
    // 速度的单位跟着数值写在格子里：`t/s` 是这个数的一部分，不是一列需要被解释的标签。
    { label: t('modelTest.detail.tps'), value: speed === '—' ? '—' : `${speed} t/s` },
    { label: t('modelTest.detail.cacheHitRate'), value: hitRate == null ? '—' : formatPercent(hitRate) },
  ]
  return (
    /*
     * 两段各自成块：上面一排带框的指标芯片，下面一个带框的分块表，中间留 12px 间距。
     *
     * 上面那排**不再是**一排无缝读数：芯片自带一圈框、彼此留缝，与请求详情里那排
     * 一模一样（同一个 `MetricCard`）；只是那边指标多、走 `auto-fill`，这里固定四格、
     * 等分撑满（见上面 `grid-cols-2 md:grid-cols-4` 的理由）。
     *
     * 下面这个块也不靠「两段之间一条发丝线 + 一堆 `divide-y`」来分界：它跟请求详情
     * 的「路由 / 原始 Usage」一样，是一个圆角括起来的完整分块——表头铺 `bg-inset`、
     * 行间有分隔线、最后一行不画线。逐轮是这个块的**内容**，不是浮在页面上的一排小字。
     */
    <div className="col-span-full">
      {/* 固定四列（`grid-cols-*` 自带 `minmax(0,1fr)`，窄容器里也能收缩、不溢出）：
          四块平分整行，不留右侧空带。 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <section className="mt-3 overflow-hidden rounded-lg border border-module-border">
        {/* 逐轮的列名只说一次：七组读数按列对齐之后，「哪一轮的首字最慢」才扫得出来。
            窄屏上表头整条藏起来，每个格子自带标签（`TaskCell` 的 `labelKey`），
            与上面那张结果表用的是同一条降级规则，不另设一套。 */}
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
            {/* 窄屏回到两列网格，每个格子自带标签（`TaskCell` 的 `labelKey`），
                与上面那张结果表用的是同一条降级规则，不另设一套。 */}
            <div className={cn('grid grid-cols-2 gap-x-3 gap-y-1.5 system-2xs-regular md:items-baseline md:gap-y-0', ROUND_GRID_COLUMNS)}>
              {/* 轮次自带说明（「第 N 轮」本身就是一个标签），就不再给它加一格窄屏标签。 */}
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
            {/* 失败那一轮的原话单独占一行：它通常很长（上游把整个 JSON 错误体回过来），
                挤在指标后面会把那一行撑成乱码一样的窄柱。成功轮不印这一行，避免「无错误」刷屏。 */}
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

/**
 * 一行诊断结论。
 *
 * 整行是一枚按钮（`aria-expanded`）：协议色条与标题都不可点，会让「这条能不能点开」
 * 变成靠猜——诊断结果是查错入口，必须一眼看出还能往下钻。
 * 展开按钮放在最左一列，与状态列分开，是因为状态列要能竖着扫；一行里出现两个交互
 * 形状时，扫视最先坏掉的就是那种「像按钮又不像按钮」的格子。
 */
function TestTaskRow(props: TestTaskRowProps) {
  const { task } = props
  const t = useTranslation()
  const statusLabel = t(TASK_STATUS_LABEL_KEYS[task.status])
  const expanded = props.expanded
  const ProtocolIcon = PROTOCOL_ICONS[task.protocol]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? t('modelTest.detail.collapse') : t('modelTest.detail.expand')}
      className={cn(
        tableRowClass,
        'grid cursor-pointer grid-cols-1 gap-2.5 px-3 py-2.5 md:items-start md:gap-3',
        /*
         * 展开时**不铺灰底**。整行连同明细一起变灰，会把下面那排指标格的填色
         * 一起洗掉（灰上叠灰），看着就是「一大片灰」——而这正是展开区最需要
         * 让读数浮出来的时刻。展开与否由箭头转 90° 与明细本身说，不靠底色。
         */
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
        <ChevronRight size={13} aria-hidden className={cn('shrink-0 text-text-quaternary transition-transform', expanded && 'rotate-90')} />
      </div>
      {/* 渠道 / 模型一格定主体。 */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 md:block">
          {/* 窄屏表头不在这里，所以标签跟着主体走；md 及以上由表头统一说一次。 */}
          <span className="shrink-0 system-2xs-regular text-text-quaternary md:hidden">{t('modelTest.table.target')}</span>
          <div className="min-w-0">
            <div className="truncate system-xs-medium text-text-primary">{task.providerName}</div>
            <div className="mt-0.5 truncate font-mono system-2xs-regular text-text-tertiary">{task.modelName}</div>
          </div>
        </div>
      </div>
      {/* 协议列：转换出来的协议走 warning 色 + `Repeat`，与左侧栏那条槽用的是同一套语义。 */}
      <TaskCell labelKey="modelTest.table.protocol">
        <span className={cn('inline-flex min-w-0 items-center gap-1 system-2xs-regular', task.converted ? 'text-text-warning' : 'text-text-secondary')}>
          {task.converted ? <Repeat size={9} aria-hidden className="shrink-0" /> : <ProtocolIcon size={11} aria-hidden className="shrink-0" />}
          <span className="truncate">{PROTOCOL_DISPLAY_NAMES[task.protocol]}</span>
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.status">
        <span
          title={getTaskStatusTitle(task, statusLabel)}
          className={cn('inline-flex items-center gap-1 system-2xs-medium', getTaskStatusClassName(task.status))}
        >
          {statusLabel}
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.ttft" align="end">{getTaskTtftLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.duration" align="end">{getTaskDurationLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.speed" align="end">{getTaskSpeedLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.tokens" align="end">{getTaskTokenLabel(task)}</TaskCell>
      {/* 明细只在点开时挂了，收起时不渲染：一张几十行的表里每行都藏一份明细，滚动会变卡。 */}
      {expanded && task.result && <TaskDetail task={task} />}
      {/* 没有 `result`（例如请求整批失败）时只有错误原文，此时没有逐轮可展开。 */}
      {!expanded && task.errorMessage && <div className="col-span-full wrap-break-word rounded-lg border border-module-border bg-destructive/8 px-2.5 py-2 font-mono system-2xs-regular leading-4 text-text-destructive">{task.errorMessage}</div>}
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
  /** 下界是定义（轮次至少一轮），不是策略；上界故意不给，见上面的说明。 */
  min: number
  /** 数值单位。数字后面那个词必须说出来，否则 `3` 是 3 个并发还是 3 轮全看读者猜。 */
  unitKey: UiCatalogKey
  onChange: (value: number) => void
}

/**
 * 一个数字设置项。右上角的 `—` / `+` 比裸输入框好用：调一格就是一次点击。
 *
 * 输入框不设 `max`，加号也不封顶。写大了是用户自己的选择，唯一要做的是别让非法值
 * （空、负数、小数）混进配置里。
 *
 * 宽度是**固定但按大数留足**的（`w-20` ≈ 十位数）：不设上限之后，原先那点宽度会把
 * 2000000 截成 200000，看着像程序改了他的输入；而宽度跟着位数走，三行的 `−`/`+`
 * 又会各走各的、排不成一条竖线。宁可留白，也要两件事同时对。
 */
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
          {/* 单位槽要**固定宽度 + 不折行**，两个条件缺一不可：
              只给固定宽度，「个并发」会被按字断成两行；宽度跟着文字走，各行的
              `−`/`+` 就会横向错开（`轮` 11px vs `个并发` 33px vs `concurrent` 54px），
              三行读下来控件不成一条竖线。宽度按最长的英文单位留足余量。 */}
          <span className="w-16 shrink-0 whitespace-nowrap system-2xs-regular text-text-quaternary">{t(props.unitKey)}</span>
        </>
      }
    />
  )
}

/**
 * 测试配置页。
 *
 * 它是同一层弹窗里的**另一页**，不是嵌套弹窗：诊断本身已经压着页面，再叠一层会让人
 * 在关闭路径上犯迷糊（关一次以为退了，其实只是退到上一层）。
 *
 * 每一项都是一条朴素横排（标题 + 说明在左、控件在右、`divide-y` 分隔），不套灰盒子、
 * 行内不放图标——设置页的视觉噪音每多一分，读者就越难判断「这一项开没开」。
 * 提示词是唯一例外：它要写长句，控件换到标题下方占满整行。
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
          title={t('modelTest.config.concurrency')}
          description={t('modelTest.config.concurrencyHint')}
          value={config.concurrency}
          min={1}
          unitKey="modelTest.config.unit.concurrency"
          onChange={concurrency => props.onChange({ ...config, concurrency })}
        />
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

export function ModelTestPanel(props: ModelTestPanelProps) {
  const t = useTranslation()
  const enabledModels = useMemo(() => props.models.filter(model => model.enabled), [props.models])
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedModelProtocols, setSelectedModelProtocols] = useState<ModelProtocolSelection>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  /**
   * 结果表与执行器。
   *
   * 执行不在这里：任务怎么排队、并发怎么限、取消之后那几行怎么收尾，都在
   * `ModelTestRunner` 那个类里（`pages/model-management/lib/model-test-runner.ts`），
   * 队列语义由 `lib/task-queue` 提供。面板只负责渲染，以及把「用户点了什么」
   * 翻译成一批任务。
   */
  const { tasks, running, run, cancel, clear } = useModelTestRunner(t)
  const [failedOnly, setFailedOnly] = useState(false)
  /**
   * 右侧主体的两个视图。
   *
   * 配置做成「同一个弹窗里换一页」而不是第二个弹窗：诊断弹窗已经是叠在页面上的一层，
   * 再叠一层调用表，用户在关闭路径上会迷路。
   */
  const [view, setView] = useState<'results' | 'config'>('results')
  /**
   * 测试参数。存在本机（`store/model-test-config`），不是 `useState`。
   *
   * 关掉弹窗再打开，上一回填的轮次还在——「这次怎么测」填到第三遍还从 1 开始，
   * 每次都要重填一遍才叫莫名其妙。但它依然不进服务端配置：这是本机习惯，
   * 换台机器重新来一遍是对的（`apps/docs/specs/operations/diagnostics.md` §5）。
   */
  const config = useModelTestConfigStore(state => state.config)
  const setConfig = useModelTestConfigStore(state => state.setConfig)
  const resetConfig = useModelTestConfigStore(state => state.resetConfig)
  /** 展开的行。只存 id，收起时不渲染明细，几十行的表也不变卡。 */
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  /** 本轮诊断要问哪个问题。只影响「下一次开始」：已经有结论的行保留它自己跑的模式。 */
  const [testMode, setTestMode] = useState<ModelTestMode>('streaming')
  const previousOpen = useRef(false)

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
      return pruneModelProtocolSelection(enabledModels, current)
    })
    setSelectedProviderIds(current => {
      if (isOpening) return current.size === 0 ? current : new Set()
      return pruneProviderSelection(availableProviders, current)
    })
    if (isOpening) {
      clear()
      setFailedOnly(false)
      // 展开态跟着结果走：重开面板时表是空的，残留的展开 id 只会在下一批结果里随机命中。
      setExpandedTaskIds(current => (current.size === 0 ? current : new Set()))
      setView('results')
      // 测试参数**不在这里复位**：它记在本机，重开面板应该还看得见上一回填的值。
      // 每次重新打开都从默认模式开始：上次点到「速度诊断」后关掉面板，
      // 下次再进来时应该看到默认的流式诊断，而不是一个没被注意到的长提示词诊断。
      setTestMode('streaming')
    }
  }, [props.open, enabledModels, availableProviders, clear])

  const plannedTasks = useMemo<readonly TestTask[]>(
    () => buildPlannedTasks(enabledModels, props.providers, selectedProviderIds, selectedModelProtocols),
    [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds],
  )

  const hasResults = tasks.length > 0
  /** 没有可测目标时「开始诊断」与右侧的模式箭头一起变灰：它是同一个控件的两半。 */
  const startDisabled = plannedTasks.length === 0
  const { successCount, failureCount, cancelledCount, completedCount, progress } = summarizeTestTasks(tasks)
  /**
   * 可见行与「只看失败是否生效」都由 lib 推导：重测成功后失败数归零时筛选自动失效，
   * 而不是留一张空白表（`getVisibleTestTasks` 的注释里有完整理由）。
   */
  const { tasks: visibleTasks, total: visibleTotal, failedOnlyActive: showFailedOnly } = getVisibleTestTasks(tasks, plannedTasks, failedOnly)

  /** 清空结果表，并一并复位与结果绑定的视图状态（筛选、展开）。 */
  const clearTasks = () => {
    clear()
    setFailedOnly(false)
    setExpandedTaskIds(current => (current.size === 0 ? current : new Set()))
  }

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds(current => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }
  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (running) return
    setSelectedModelProtocols(current => toggleProtocolSelection(enabledModels, current, modelId, protocol))
    clearTasks()
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => toggleProviderSelection(current, providerId))
    clearTasks()
  }

  const toggleModel = (modelId: string) => {
    if (running) return
    setSelectedModelProtocols(current => toggleModelSelection(enabledModels, current, modelId))
    clearTasks()
  }

  const allTasksSelected = isEveryTaskSelected(enabledModels, selectedProviderIds, selectedModelProtocols)

  const toggleAll = () => {
    if (running) return
    const next = allTasksSelected
      ? clearAllTasks(enabledModels)
      : selectEveryTask(enabledModels, availableProviders)
    setSelectedProviderIds(next.providerIds)
    setSelectedModelProtocols(next.modelProtocols)
    clearTasks()
  }

  /**
   * 把当前参数与选择交给执行器。
   *
   * 面板只说「用什么参数跑哪一批」，排队、并发、取消收尾都在执行器里。
   * 参数是**开跑那一刻**的快照：跑的过程中改配置不该影响已经发出去的那一批。
   */
  const runTasks = (batch: readonly TestTask[]) => {
    void run(batch, {
      mode: testMode,
      concurrency: config.concurrency,
      rounds: config.rounds,
      prompt: config.prompt,
      inputLength: config.inputLength,
    })
  }

  const startTests = () => {
    setFailedOnly(false)
    runTasks(plannedTasks)
  }

  /** 重测不重新规划：直接拿表里失败的那几行重跑，结果就地刷新，其它行不动。 */
  const retryFailedTests = () => {
    runTasks(tasks.filter(task => task.status === 'failed'))
  }

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
                        <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{config.concurrency}</div>
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
                        <Button variant="destructive" size="sm" onClick={cancel}>
                          <Square size={11} fill="currentColor" /> {t('modelTest.action.stop')}
                        </Button>
                      ) : (
                        <>
                          {/*
                            设置按钮放在开始按钮**左边**：它是「开始之前先想一下」的前置动作，
                            不是开始之后的补丁。不塞进分裂按钮里——那会把「参数」说成「模式」的一部分。
                          */}
                          <Button
                            variant="outline"
                            size="icon-sm"
                            title={t('modelTest.action.settings')}
                            aria-label={t('modelTest.action.settings')}
                            onClick={() => setView('config')}
                          >
                            <Settings2 size={13} aria-hidden />
                          </Button>
                          {/*
                            分裂按钮：左半是「用当前模式开始」，右半那枚箭头展开模式本身。
                            箭头紧贴在开始按钮右侧、与之同色同高，读起来是一个控件；
                            单独拿出一枚圆角按钮会把「选模式」说成另一件事。
                          */}
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
                        </>
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
                      {/* 表头第一格空着：下面是展开箭头，给它一个 `aria-label` 就够，不需要列名。 */}
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
                      {visibleTasks.map(task => (
                        <TestTaskRow
                          key={task.id}
                          task={task}
                          expanded={expandedTaskIds.has(task.id)}
                          onToggleExpanded={() => toggleTaskExpanded(task.id)}
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
      </DialogContent>
    </Dialog>
  )
}
