import type { ModelTestTaskItem, ModelTestTaskProgress, ModelTestTaskResult } from '@common/diagnostics'
import type { ModelTestMode, Protocol, Provider, ProviderModelRoute } from '@common/schemas'
import type { TaskRecord, TaskStatus } from '@common/tasks'
import { getTestableProtocols, supportsConvertedProtocol, type ModelProtocolSelection } from './selection'

/**
 * 诊断面板的**任务视图**：把服务端队列里那些 `kind === 'model-test'` 的任务翻译成表格能
 * 直接渲染的一行。
 *
 * 为什么这一层必须存在：队列是**通用**的，它的任务只带 `kind` / `key` / `status` /
 * `progress` / `result` 这些生命周期字段，没有任何「模型」「协议」——它是刻意不认识这些
 * 东西的（见 `@common/tasks`）。而面板要的是一张按「模型 × 协议」排开的表。把它们接起来
 * 的就是这里：用 `keyOf` 的同一口径（`${modelId}:${protocol}`）把任务对回本地目录里的
 * 模型与渠道。
 *
 * 这里只有纯函数，没有 React，也没有网络：口径能直接断言，不必先挂一棵组件树。
 */

/** 队列里诊断任务的 `kind`，与服务端 `MODEL_TEST_TASK_KIND` 同一个值。 */
export const MODEL_TEST_TASK_KIND = 'model-test'

/** 一行任务的状态；与服务端的 `TaskStatus` 同一个词表，界面不再造第二套。 */
export type TestRowStatus = TaskStatus

/** 结果表里的一行：一个「模型 × 协议」。 */
export interface TestRow {
  /** `${modelId}:${protocol}` —— 服务端 `keyOf` 的同一口径，也是去重与对号入座的凭据。 */
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  /** 这个协议是转出来的（模型自己没有它）。目录还没加载出来时按「不是转的」处理。 */
  converted: boolean
  status: TestRowStatus
  result?: ModelTestTaskResult
  /** 进行中的读数；终态项也可以带（服务端不会清掉它）。 */
  progress?: ModelTestTaskProgress
  errorMessage?: string
}

/** 队列的去重键口径：同一次诊断里同一个「模型 × 协议」只该有一个任务。 */
export function modelTestKeyOf(modelId: string, protocol: Protocol): string {
  return `${modelId}:${protocol}`
}

/** 把一个任务的 `key` 拆回「模型 + 协议」。协议词表是封闭的，从最后一段取即可。 */
function splitKey(key: string): { modelId: string; protocol: Protocol } {
  const separator = key.lastIndexOf(':')
  return {
    modelId: separator === -1 ? key : key.slice(0, separator),
    protocol: (separator === -1 ? '' : key.slice(separator + 1)) as Protocol,
  }
}

/** 把服务端的一条任务翻成一行；不属于诊断 kind 的返回 `null`。 */
export function toTestRow(task: TaskRecord, models: readonly ProviderModelRoute[], providers: readonly Provider[]): TestRow | null {
  if (task.kind !== MODEL_TEST_TASK_KIND) return null
  const { modelId, protocol } = splitKey(task.key)
  const progress = isProgress(task.progress) ? task.progress : undefined
  const result = isResult(task.result) ? task.result : undefined
  const model = models.find(candidate => candidate.id === modelId)
  const provider = providers.find(candidate => candidate.id === (progress?.providerId ?? result?.providerId ?? model?.providerId))
  return {
    id: task.key,
    modelId,
    modelName: progress?.modelName ?? result?.modelName ?? model?.modelName ?? modelId,
    providerId: provider?.id ?? progress?.providerId ?? result?.providerId ?? model?.providerId ?? '',
    providerName: provider?.name ?? progress?.providerName ?? result?.providerName ?? '',
    protocol,
    converted: model ? supportsConvertedProtocol(model, protocol) : false,
    status: task.status,
    result,
    progress,
    errorMessage: task.errorMessage,
  }
}

/** 只在 `progress` 真的是诊断进度时才认它（队列的另一头可能是别的 kind，复用同一条流）。 */
function isProgress(value: unknown): value is ModelTestTaskProgress {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ModelTestTaskProgress>
  return typeof candidate.modelId === 'string' && typeof candidate.round === 'number' && typeof candidate.totalRounds === 'number'
}

/** 断 `result` 的形状：至少得是一条诊断结论（有 `success` 与 `modelId`）。 */
function isResult(value: unknown): value is ModelTestTaskResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ModelTestTaskResult>
  return typeof candidate.modelId === 'string' && typeof candidate.success === 'boolean'
}

/**
 * 把服务端的任务叠到本地计划上。
 *
 * 计划（{@link buildPlannedRows}）是**骨架**：它给出用户这次打算测的每一行，因此
 * 排队中的行（还没有任何 `progress`，只有 `key`）也有名字可显示。服务端的任务按
 * `key` 覆盖骨架上的那一行——状态、进度、结论都从服务端来，界面不自己编。
 *
 * 服务端有、计划里没有的（换了选择之后留下的旧任务）追加在后面：它们是真实存在的任务，
 * 藏起来只会让「面板上少了一行」变得不可解释。
 */
export function mergeTestRows(plan: readonly TestRow[], tasks: readonly TaskRecord[], models: readonly ProviderModelRoute[], providers: readonly Provider[]): TestRow[] {
  const rows = new Map(plan.map(row => [row.id, row]))
  const extras: TestRow[] = []
  for (const task of tasks) {
    const row = toTestRow(task, models, providers)
    if (!row) continue
    if (rows.has(row.id)) rows.set(row.id, row)
    else extras.push(row)
  }
  return [...rows.values(), ...extras]
}

/** 这一批要发出去的任务载荷。`prompt` 留空就是不指定，由服务端按模式取默认。 */
export interface TestRunOptions {
  mode: ModelTestMode
  rounds: number
  prompt: string
  inputLength: number
}

/** 把计划行翻成队列载荷。参数是**开跑那一刻**的快照：跑的过程中改设置不影响已经发出去的那一批。 */
export function toModelTestItems(rows: readonly TestRow[], options: TestRunOptions): ModelTestTaskItem[] {
  return rows.map(row => ({
    modelId: row.modelId,
    providerId: row.providerId,
    protocol: row.protocol,
    mode: options.mode,
    rounds: options.rounds,
    // 空提示词不发：不发与服务端会回退到该模式的默认提示词，两边口径一致。
    prompt: options.prompt.trim() || undefined,
    inputLength: options.inputLength,
  }))
}

/**
 * 计划行：模型 × 已勾选的协议，状态一律 `queued`。
 *
 * `id` 用 `keyOf` 的同一口径（`模型 id:协议`），所以重测时必须命中同一行——服务端那边
 * 也是按这个键去重的，两边说的是同一件事。
 */
export function buildPlannedRows(models: readonly ProviderModelRoute[], providers: readonly Provider[], providerIds: ReadonlySet<string>, modelProtocols: ModelProtocolSelection): TestRow[] {
  return models.flatMap(model => {
    if (!providerIds.has(model.providerId)) return []
    const provider = providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = modelProtocols[model.id] ?? new Set(getTestableProtocols(model))
    return getTestableProtocols(model)
      .filter(protocol => selectedProtocols.has(protocol))
      .map(protocol => ({
        id: modelTestKeyOf(model.id, protocol),
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        protocol,
        converted: supportsConvertedProtocol(model, protocol),
        status: 'queued' as const,
      }))
  })
}

export interface TestRowSummary {
  successCount: number
  failureCount: number
  cancelledCount: number
  /** 已经在跑的行数（同一个 kind 串行时最多一行，调大并发后会更多）。 */
  runningCount: number
  /** 已经有结局的行数（成功 + 失败 + 取消）。排队中与进行中都不算。 */
  completedCount: number
  /** 0–100 的整数百分比；还没有任务时是 0，不是 NaN。 */
  progress: number
}

/** 一行一个计数，全部从同一份行列表推导，避免「进度条 80% 但成功数 0」这类对不上。 */
export function summarizeTestRows(rows: readonly TestRow[]): TestRowSummary {
  const successCount = rows.filter(row => row.status === 'success').length
  const failureCount = rows.filter(row => row.status === 'failed').length
  const cancelledCount = rows.filter(row => row.status === 'cancelled').length
  const runningCount = rows.filter(row => row.status === 'running').length
  const completedCount = successCount + failureCount + cancelledCount
  return {
    successCount,
    failureCount,
    cancelledCount,
    runningCount,
    completedCount,
    progress: rows.length === 0 ? 0 : Math.round((completedCount / rows.length) * 100),
  }
}

/** 有没有任何一行不再是「排队中」——用它区分「还没开跑」与「已经有结论」。 */
export function hasSettledOrRunning(rows: readonly TestRow[]): boolean {
  return rows.some(row => row.status !== 'queued')
}

export interface VisibleTestRows {
  rows: readonly TestRow[]
  /** 分母：全部行数。它**不跟随筛选**。 */
  total: number
  /** 「只看失败」是否真的生效。 */
  failedOnlyActive: boolean
}

/**
 * 结果表当前应该渲染哪些行。
 *
 * 筛选是否生效是**推导**出来的：重测成功后失败数归零，此时不能再停留在「只看失败」上
 * ——否则表格会空白，而失败行其实已经变绿了。所以它不写回 state。
 */
export function getVisibleTestRows(rows: readonly TestRow[], failedOnly: boolean): VisibleTestRows {
  const failureCount = rows.filter(row => row.status === 'failed').length
  const failedOnlyActive = failedOnly && failureCount > 0
  return {
    rows: failedOnlyActive ? rows.filter(row => row.status === 'failed') : rows,
    total: rows.length,
    failedOnlyActive,
  }
}

/**
 * 角标上那行「第 N/M 轮」。
 *
 * 取**在跑的那些行里最大的那一格**：串行时只有一行在跑，它就是「现在跑到哪了」；
 * 调大并发之后取最大值，读出来仍是「这一批最多推进到了第几轮」，不会因为多行并行
 * 而回退。还没有任何一行在跑时返回 `null`——那时该说的是「已完成/总数」，不是「第 0 轮」。
 */
export function getCurrentRoundLabel(rows: readonly TestRow[]): { round: number; totalRounds: number } | null {
  const active = rows.filter(row => row.status === 'running' && row.progress)
  if (active.length === 0) return null
  let best = { round: 0, totalRounds: 0 }
  for (const row of active) {
    const progress = row.progress!
    if (progress.round >= best.round) best = { round: progress.round, totalRounds: progress.totalRounds }
  }
  return best
}
