/**
 * 匿名使用统计的入口（默认开启、界面上不提供开关，见 `docs/product/telemetry.md`）。
 *
 * 对外只有四件事：
 *
 * - `startTelemetry`：监听成功后调一次，返回 stop 函数（与实例锁心跳同一套写法）；
 * - `reportTelemetryEvent`：埋点。同步、无返回值、失败无反馈——埋点不接受「上报失败」这个分支；
 * - `reportTelemetryStartFailure`：启动最终失败时的**一次性**补发，那时队列还没起来；
 * - `previewTelemetry`：管理接口的「预览即将发送的内容」（自查入口，设置页不展示）。
 *
 * 三条不动摇的约束：
 *
 * 1. **默认开启。** `telemetryEnabled` 默认 `true`，采集随正式版安装自然开启；标识文件仍然只在
 *    真要上报时才创建（开发档、已被关闭时不创建），不因为「装了应用」就先留一份痕迹。
 * 2. **开发档永远不上报**，与开关无关：开发期产生的启动次数会污染真实数据。
 * 3. **core 不感知下游。** 这里只知道「往一个自有域名 POST 一批 JSON」，不知道谁来收、存到哪——
 *    那是 Worker 侧适配器的事（见 `packages/contracts/source/telemetry.ts`）。
 */

import { resolveLocale } from '@common/i18n'
import type { RuntimeConfig } from '@common/runtime-config'
import type { Settings } from '@common/schemas'
import type {
  TelemetryEnvelope,
  TelemetryEvent,
  TelemetryEventInput,
  TelemetryPreview,
  TelemetryServiceFailureReason,
} from '@common/telemetry'
import { TELEMETRY_ENDPOINT } from '@common/telemetry'
import { getSettings, onSettingsChanged } from '../database/settings-store'
import { loadOrCreateTelemetryId } from './install-id'
import { createTelemetryQueue, type TelemetryQueue } from './queue'
import { createTelemetrySender } from './sender'

/**
 * 当前活着的队列；没在跑时为 `null`（开发档、开关关着、标识不可用、还没启动完）。
 *
 * 是模块级单例，而不是交给调用方持有的句柄：埋点散落在各处（供应商、路由、工作流、管理接口），
 * 让每个埋点点都拿一个句柄，等于把这个模块的生命周期抄到几十个调用点上。
 */
let active: TelemetryQueue | null = null
let runtimeConfig: RuntimeConfig | null = null
let settings: Settings | null = null
let installId: string | null = null
let unsubscribe: (() => void) | null = null

/**
 * 宿主平台的取值；认不出来时为 `null`，那时整个模块不上报（见 `resolveHostFields`）。
 * 它一旦算出来就不会变，所以只算一次。
 */
let host: HostFields | null = null

export function startTelemetry(config: RuntimeConfig): () => void {
  // 开发档直接返回空操作：调用方不需要知道这个判断，也不该在调用点上散落环境判断。
  if (config.environment !== 'production') return () => undefined

  runtimeConfig = config
  let cancelled = false
  void start(config, () => cancelled)

  return () => {
    cancelled = true
    unsubscribe?.()
    unsubscribe = null
    active?.stop()
    active = null
    runtimeConfig = null
    settings = null
    installId = null
    host = null
  }
}

async function start(config: RuntimeConfig, isCancelled: () => boolean): Promise<void> {
  const loaded = await getSettings().catch(() => null)
  // 启动过程中就被停掉时不要再往后走：否则会把监听留在数组里，成为一个没人取消的订阅。
  if (isCancelled()) return
  settings = loaded

  // 开关关着也要把监听挂上：管理接口随时可以改写它，那不重启就该生效。
  //
  // 判断的是**设置项的这一次翻转**，而不是 `isEnabled()`：后者还要求队列存在，而队列恰恰
  // 是「刚被打开」那一刻才需要补建的东西——用它做判断，打开开关会永远等不到任何动作。
  unsubscribe = onSettingsChanged(next => {
    const wasEnabled = settings?.telemetryEnabled === true
    settings = next
    if (next.telemetryEnabled === wasEnabled) return
    void reportToggle(next.telemetryEnabled)
  })

  if (loaded === null || !loaded.telemetryEnabled) return

  const fields = resolveHostFields()
  if (fields === null) {
    console.debug(`[telemetry] disabled for this run: unsupported host ${process.platform}/${process.arch}`)
    return
  }
  host = fields

  const id = await loadOrCreateTelemetryId(config.dataDir)
  if (isCancelled()) return
  if (id === null) {
    // 标识落不了盘就不上报：否则每次启动都长出一个新安装，把「活跃安装数」变成「启动次数」。
    console.debug('[telemetry] disabled for this run: the install id is not available')
    return
  }

  installId = id
  active = createQueue(config, loaded, id, fields)

  // `app_started` 也走同一条队列：它不是特殊路径，只是「启动后的第一条事件」。
  active.report({ name: 'app_started' })
}

/**
 * 上报一条事件。
 *
 * 任何一处「没在跑」都静默返回：开关关着、开发档、平台认不出、标识不可用、还没启动完。
 * 调用点因此可以无条件埋点，不必各自判断一遍——那会把同一个条件抄到几十处。
 */
export function reportTelemetryEvent(input: TelemetryEventInput): void {
  if (!isEnabled()) return
  active?.report(input)
}

/**
 * 启动最终失败时的一次性上报。
 *
 * 单独一个入口而不是复用队列，因为失败路径上队列还没起来、设置也可能读不出来。读不出来就
 * **不上报**：拿不到「采集是被允许的」这个前提，宁可不发。它不抛错，失败即丢弃。
 */
export async function reportTelemetryStartFailure(config: RuntimeConfig, reason: TelemetryServiceFailureReason): Promise<void> {
  if (config.environment !== 'production') return

  try {
    const loaded = await getSettings()
    if (!loaded.telemetryEnabled) return
    const fields = resolveHostFields()
    if (fields === null) return
    const id = await loadOrCreateTelemetryId(config.dataDir)
    if (id === null) return

    const event: TelemetryEvent = {
      ...commonFields(config, id, fields, loaded.language),
      name: 'service_start_failed',
      reason,
    }
    await createTelemetrySender()(resolveEndpoint(loaded), { events: [event] })
  } catch (error) {
    console.debug('[telemetry] start failure report dropped', error)
  }
}

/** 管理接口的「预览即将发送的内容」（自查入口，设置页不展示）。 */
export function previewTelemetry(): TelemetryPreview {
  const enabled = settings?.telemetryEnabled ?? false
  const endpoint = settings === null ? TELEMETRY_ENDPOINT : resolveEndpoint(settings)
  const language = settings?.language
  const queue = active
  const config = runtimeConfig
  const fields = host
  const id = installId
  const running = queue !== null && config !== null && fields !== null && id !== null

  if (!running) {
    return { enabled, running, endpoint, installId: id, events: [], source: 'sample' }
  }

  const pending = queue.pending()
  if (pending.length > 0) {
    return { enabled, running, endpoint, installId: id, events: pending, source: 'queue' }
  }

  // 队列空着时给一条真样例：走的是同一个组装路径，只是这条 `app_started` 没有真的发生过。
  return {
    enabled,
    running,
    endpoint,
    installId: id,
    events: [{ ...commonFields(config, id, fields, language), name: 'app_started' }],
    source: 'sample',
  }
}

/**
 * 开关翻转时的最后一次机会。没有它，我们只能看到「某个安装从某天起不再出现」，而那既可能是
 * 关了统计，也可能是卸载或断网——区分不了就等于没这条数据（telemetry.md §13）。
 *
 * 它绕过开关本身（`queue.report` 不看开关），并且立刻发出、不等批量也不等间隔。开启时也
 * 发一条，这样服务端能看到「开了又关」的完整来回。
 */
async function reportToggle(enabled: boolean): Promise<void> {
  // 启动时开关是关的，所以队列没建；刚被改写为开启——这里补建。
  if (enabled && (active === null || installId === null)) {
    const config = runtimeConfig
    const loaded = settings
    if (config === null || loaded === null) return
    const id = await loadOrCreateTelemetryId(config.dataDir)
    const fields = resolveHostFields()
    if (id === null || fields === null) return
    installId = id
    host = fields
    active = createQueue(config, loaded, id, fields)
  }

  const queue = active
  if (queue === null) return
  queue.report({ name: 'telemetry_toggled', enabled })
  queue.flush()
}

function isEnabled(): boolean {
  return active !== null && settings?.telemetryEnabled === true
}

/**
 * 建一个上报队列。
 *
 * 端点、发送器、信封字段的组装方式只有这一处：`start` 与「开关被改写为开启」两条入口共用，
 * 免得两处各写一份、日后改了一处漏了另一处。
 */
function createQueue(config: RuntimeConfig, loaded: Settings, id: string, fields: HostFields): TelemetryQueue {
  return createTelemetryQueue({
    endpoint: resolveEndpoint(loaded),
    sender: createTelemetrySender(),
    createCommonFields: () => commonFields(config, id, fields, loaded.language),
  })
}

function commonFields(config: RuntimeConfig, id: string, fields: HostFields, language: string | null | undefined): TelemetryEnvelope {
  return {
    occurredAt: Date.now(),
    installId: id,
    version: config.appVersion,
    os: fields.os,
    arch: fields.arch,
    locale: resolveLocale(language, systemLocale()),
    runtime: config.runtime,
  }
}

interface HostFields {
  os: 'win32' | 'darwin' | 'linux'
  arch: 'x64' | 'arm64' | 'ia32'
}

const SUPPORTED_OPERATING_SYSTEMS = ['win32', 'darwin', 'linux'] as const
const SUPPORTED_ARCHITECTURES = ['x64', 'arm64', 'ia32'] as const

/**
 * 把 `process.platform` / `process.arch` 收敛到事件目录的枚举。
 *
 * 认不出来时返回 `null` 并**放弃上报**，不挑一个「最像的」顶上：报一个 `linux` 给一台 FreeBSD
 * 机器，会让「平台构成」这张图永远对不上，而排查的人不会怀疑到这一层。
 */
function resolveHostFields(): HostFields | null {
  const os = SUPPORTED_OPERATING_SYSTEMS.find(candidate => candidate === process.platform)
  const arch = SUPPORTED_ARCHITECTURES.find(candidate => candidate === process.arch)
  if (os === undefined || arch === undefined) return null
  return { os, arch }
}

/**
 * 系统语言。core 跑在 `utilityProcess` 里，拿不到 `app.getLocale()` 也拿不到
 * `navigator.language`；`Intl` 在三个平台上读的都是系统区域设置，对「用户没选过语言」
 * 这个场景足够用。
 */
function systemLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale
}

/** 设置里的端点只在开发档有意义（指向本地 Worker）；正式构建下为空即用常量。 */
function resolveEndpoint(loaded: Settings): string {
  return loaded.telemetryEndpoint.trim() || TELEMETRY_ENDPOINT
}
