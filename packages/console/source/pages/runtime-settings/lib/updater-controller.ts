/**
 * 自动更新的**领域层**——一个普通类，零 React。
 *
 * 更新器本身是主进程经 contextBridge 暴露的跨进程对象（`UpdaterAPI`，预览形态下为 `undefined`）。
 * 这个控制器把「检查 / 下载 / 安装 / 跟随状态变化」这套状态机收在一处：用 `subscribe`/`getSnapshot`
 * 对外（与 `routing/url-overrides` 同一套约定），React 侧只用 `useSyncExternalStore` 薄绑定接入。
 *
 * 它不认识 toast 也不认识 i18n：各操作把「发生了什么」作为结构化结果（{@link UpdateCheckOutcome}
 * 等）返回，由绑定层翻译成提示。这样整台状态机能脱离渲染单测，也能搬到别的宿主。
 */

/** `getSnapshot` 的返回：上游状态 + 一个「检查进行中」标志（已下载态不会回到 checking）。 */
export interface UpdaterSnapshot extends UpdateState {
  readonly checkPending: boolean
}

/** `check()` 的结果；绑定层据此决定提示哪一句。`none` = 不提示（checking/downloading/idle）。 */
export type UpdateCheckOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'update-available'; version: string }
  | { kind: 'ready-to-install'; version: string }
  | { kind: 'ready-with-error'; message: string }
  | { kind: 'error'; message: string | null }
  | { kind: 'failed'; message: string | null }
  | { kind: 'none' }
  | { kind: 'busy' }

/** `download()` 的结果；`quiet` = 正在下 / 已替用户打开下载页，不必再提示。 */
export type UpdateDownloadOutcome =
  | { kind: 'failed'; message: string | null }
  | { kind: 'downloaded' }
  | { kind: 'quiet' }

const IDLE_STATE: UpdateState = {
  status: 'idle',
  info: null,
  errorMessage: null,
  downloadProgress: null,
  downloadedFile: null,
}

/**
 * 跨进程传回来的状态对象每次都是新实例，值没变就不该触发重渲染。
 * 字段不多但 `info.assets` 是数组，逐字段比容易漏，直接序列化比。
 */
function isSameState(a: UpdateState, b: UpdateState): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

type Listener = () => void

export class UpdaterController {
  private upstream: UpdateState = IDLE_STATE
  private snapshot: UpdaterSnapshot = { ...IDLE_STATE, checkPending: false }
  private readonly listeners = new Set<Listener>()
  private checkInFlight = false

  constructor(private readonly updater: UpdaterAPI | undefined) {}

  /** 是否存在可用的更新器（预览形态下没有）。 */
  get available(): boolean {
    return this.updater !== undefined
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): UpdaterSnapshot => this.snapshot

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private applyState(next: UpdateState): void {
    if (isSameState(this.upstream, next)) return
    this.upstream = next
    this.snapshot = { ...next, checkPending: this.snapshot.checkPending }
    this.emit()
  }

  private setCheckPending(pending: boolean): void {
    if (this.snapshot.checkPending === pending) return
    this.snapshot = { ...this.snapshot, checkPending: pending }
    this.emit()
  }

  /** 拉一次当前状态，并订阅后续变化。返回退订函数。 */
  readonly start = (): (() => void) => {
    const updater = this.updater
    if (!updater) return () => {}
    void updater.getState().then(state => this.applyState(state))
    return updater.onStateChanged(state => this.applyState(state))
  }

  /** 主动检查更新。自带在途去重：已下载态不会回到 checking，按钮靠 `checkPending` 转圈。 */
  readonly check = async (): Promise<UpdateCheckOutcome> => {
    const updater = this.updater
    if (!updater || this.checkInFlight) return { kind: 'busy' }
    this.checkInFlight = true
    this.setCheckPending(true)
    try {
      const next = await updater.check()
      this.applyState(next)
      switch (next.status) {
        case 'up-to-date':
          return { kind: 'up-to-date' }
        case 'update-available':
          return { kind: 'update-available', version: next.info?.latestVersion ?? '' }
        case 'downloaded':
          return next.errorMessage
            ? { kind: 'ready-with-error', message: next.errorMessage }
            : { kind: 'ready-to-install', version: next.info?.latestVersion ?? '' }
        case 'error':
          return { kind: 'error', message: next.errorMessage }
        default:
          return { kind: 'none' }
      }
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : null }
    } finally {
      this.checkInFlight = false
      this.setCheckPending(false)
    }
  }

  readonly download = async (): Promise<UpdateDownloadOutcome> => {
    const updater = this.updater
    if (!updater) return { kind: 'quiet' }
    const result = await updater.download()
    if (result === 'failed') return { kind: 'failed', message: this.snapshot.errorMessage }
    if (result === 'download-complete') return { kind: 'downloaded' }
    return { kind: 'quiet' }
  }

  /** 安装已下载的更新。失败原样抛出，由绑定层提示。 */
  readonly install = async (): Promise<void> => {
    await this.updater?.install()
  }

  readonly openReleases = async (): Promise<void> => {
    await this.updater?.openReleases()
  }
}
