import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { nativeTranslator } from './i18n'

const GITHUB_RELEASES_PAGE = 'https://github.com/yinxulai/osw/releases/latest'

/**
 * 产物名里的平台 / 架构标记，用来在 `latest*.yml` 的 `files` 里认出「本机要下的那个」。
 *
 * 用「出现即命中」的关键字而不是拼一个精确文件名：产物名的架构段在平台之间本来就不统一
 * （Windows 写 `x64`，Linux 写 `x86_64`），多列几个别名比猜一种写法稳。
 */
const RELEASE_ASSET_PLATFORM_TOKENS: Partial<Record<string, string[]>> = {
  win32: ['win'],
  darwin: ['mac'],
  linux: ['linux', 'appimage'],
}

const RELEASE_ASSET_ARCH_TOKENS: Partial<Record<string, string[]>> = {
  x64: ['x64', 'x86_64', 'amd64'],
  arm64: ['arm64', 'aarch64'],
}

/**
 * `downloadUpdate()` 的结果。
 *
 * 不用 `boolean`：macOS 上「转去下载页」既不是失败也不是下载成功，用 `false` 表示会被界面
 * 渲染成「下载失败」——和 2026-08-25「下载成功却提示失败」是同一类毛病（让调用方去猜一个
 * 二值信号的含义）。四种结果各自对应界面上一句确定的话。
 */
export type UpdateDownloadResult =
  | 'downloading'
  | 'download-complete'
  | 'manual-download'
  | 'failed'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

export interface UpdateInfoView {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
  /** 跨应用大版本：只能手动下载安装，不做自动更新。见 `isMajorUpgrade`。 */
  requiresManualUpdate: boolean
}

export interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfoView | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

type Listener = (state: UpdateState) => void

/**
 * 从更新元数据的 `files` 里挑出本机真正会下载的那个。
 *
 * `files` 是 electron-builder 写进 `latest*.yml` 的产物清单，**第一项不等于「本机的那个」**：
 * Windows 第一项是不带架构段的 Windows 安装包，macOS 第一项是 arm64 的 zip（Intel 机器要的是 x64）。
 * 直接取第一项，用户看到的就是一个别人要下的文件名。
 * 打分而不是精确匹配（架构段本身平台相关，见上方常量），全都不命中时退回第一项。
 */
function pickPreferredAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  if (assets.length === 0) return undefined

  const platformTokens = RELEASE_ASSET_PLATFORM_TOKENS[process.platform] ?? []
  const archTokens = RELEASE_ASSET_ARCH_TOKENS[process.arch] ?? []
  // macOS 只能手动装 DMG，指向 DMG 比指向 zip 更贴近用户接下来要做的事。
  const wantsDmg = process.platform === 'darwin'

  let best = assets[0]
  let bestScore = -1
  for (const asset of assets) {
    const name = asset.name.toLowerCase()
    const score =
      (platformTokens.some(token => name.includes(token)) ? 4 : 0) +
      (archTokens.some(token => name.includes(token)) ? 2 : 0) +
      (wantsDmg && name.endsWith('.dmg') ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = asset
    }
  }
  return best
}

/** 从版本串里读大版本号；读不出来时返回 `null`，不猜。 */
function readMajorVersion(version: string): number | null {
  const matched = version.trim().match(/^v?(\d+)\./)
  return matched ? Number(matched[1]) : null
}

/**
 * 这次更新是不是跨了应用大版本。
 *
 * 大版本变更是**破坏性**的：数据库换代（文件名里的 schema 版本加一，旧库不再被读）、
 * 配置结构可能整体重做。自动更新会在用户毫无准备时把配置甩在一张空表旁边，所以跨大版本
 * **只能手动更新**——由用户自己决定什么时候换、先把配置导出走。
 *
 * 版本串解析不出来时保守返回 `true`：拿不准的更新宁可让用户多点一下，也不要赌它不破坏。
 */
export function isMajorUpgrade(currentVersion: string, latestVersion: string): boolean {
  const current = readMajorVersion(currentVersion)
  const latest = readMajorVersion(latestVersion)
  if (current === null || latest === null) return true
  return latest !== current
}

/**
 * 基于 electron-updater 的更新检查与安装实现。
 *
 * 更新源由 electron-builder.config.cjs 的 publish 配置决定（GitHub Releases）。
 * 打包时 electron-builder 会生成 app-update.yml 并嵌入应用，autoUpdater 自动读取。
 * macOS 的 ad-hoc 签名不满足 Squirrel.Mac 自动安装要求，因此只检查更新并引导用户
 * 前往对应 GitHub Release 下载 DMG。
 *
 * 其余平台的更新能力是完整的：手动触发下载、下载完点「立即安装」走 `quitAndInstall`，
 * 或者什么都不点，退出应用时由 electron-updater 静默装上（`autoInstallOnAppQuit`）。
 * 除了 macOS 那两处手动安装分支，这个类里不该再出现平台判断。
 */
export class UpdaterManager {
  private state: UpdateState = {
    status: 'idle',
    info: {
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
      releaseNotes: '',
      releaseDate: '',
      releaseUrl: GITHUB_RELEASES_PAGE,
      assets: [],
      requiresManualUpdate: false,
    },
    errorMessage: null,
    downloadProgress: null,
    downloadedFile: null,
  }
  private listeners = new Set<Listener>()
  private initialized = false

  constructor() {
    this.initialize()
  }

  private initialize() {
    if (this.initialized) return
    this.initialized = true

    // 不自动下载，由用户在设置页点击"下载更新"触发
    autoUpdater.autoDownload = false
    // 下载完的包：用户可以点"立即安装"，也可以直接退出应用、由 electron-updater 静默装上。
    // 关掉它，退出就什么都不做——安装器路径只活在当前进程里，磁盘缓存里的包不会自己装
    // 上去；下次启动又回到「有可用更新」，用户得把下载再点一遍才拿回已经要过的东西。
    // macOS 只能手动装 DMG，所以只有它不注册退出安装。
    autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin'
    // 允许预发布版本（pre-release 阶段）
    autoUpdater.allowPrerelease = true

    autoUpdater.on('checking-for-update', () => {
      console.info(`[updater] check started currentVersion=${app.getVersion()} packaged=${app.isPackaged}`)
      // 下载已经结束之后再检查，electron-updater 仍会发这条事件：它只按版本号判断，
      // 不记得包在不在磁盘上。这里若降到 checking，「立即安装」会消失，而安装包还在。
      if (this.state.status === 'downloaded') return
      this.setState({ status: 'checking', errorMessage: null })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.info(`[updater] update available currentVersion=${app.getVersion()} latestVersion=${info.version}`)
      // 下载结束时 downloadPromise 会被清掉，同版本再检查仍会走到 update-available。
      // 版本没变就留在 downloaded，否则更新的版本会被已经下完的旧包挡住。
      // 顺手清掉上一次检查失败留下的错误，否则成功的复查仍会显示旧的失败原因。
      if (this.state.status === 'downloaded' && this.state.info?.latestVersion === info.version) {
        if (this.state.errorMessage) this.setState({ errorMessage: null })
        return
      }
      this.setState({
        status: 'update-available',
        info: this.mapInfo(info),
        errorMessage: null,
        downloadProgress: null,
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.info(`[updater] already up to date currentVersion=${app.getVersion()} latestVersion=${info.version}`)
      this.setState({
        status: 'up-to-date',
        info: this.mapInfo(info),
        errorMessage: null,
        downloadProgress: null,
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        downloadProgress: progress.percent / 100,
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.info(`[updater] download completed version=${info.version}`)
      this.setState({
        status: 'downloaded',
        info: this.mapInfo(info),
        downloadProgress: 1,
        // electron-updater 内部管理下载缓存，不暴露文件路径
        downloadedFile: null,
      })
    })

    autoUpdater.on('error', (error: Error) => {
      // 未打包时 electron-updater 取不到 app-update.yml，报错是预期的，
      // 补一句上下文避免用户把开发环境的报错当故障。
      const message = app.isPackaged
        ? error.message
        : nativeTranslator()('native.update.devCheckFailed', { message: error.message })
      console.error(`[updater] operation failed status=${this.state.status} message=${message}`, error)
      // 检查失败只说明这次没问到服务器。包已经在磁盘上时，把状态改成 error 会收掉
      // 「立即安装」，下一次同版本的成功检查也不再被当成已下载，按钮又变回「下载更新」。
      if (this.state.status === 'downloaded') {
        this.setState({ errorMessage: message })
        return
      }
      this.setState({
        status: 'error',
        errorMessage: message,
        downloadProgress: null,
      })
    })
  }

  getState(): UpdateState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private mapInfo(info: UpdateInfo): UpdateInfoView {
    const releaseNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map(n => n.note || n.version).join('\n')
        : ''
    const assets: ReleaseAsset[] = (info.files ?? []).map(f => ({
      name: f.url.split('/').pop() ?? f.url,
      size: f.size ?? 0,
      downloadUrl: f.url,
    }))
    return {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseNotes,
      releaseDate: info.releaseDate ?? new Date().toISOString(),
      releaseUrl: `https://github.com/yinxulai/osw/releases/tag/v${info.version}`,
      assets,
      preferredAsset: pickPreferredAsset(assets),
      requiresManualUpdate: isMajorUpgrade(app.getVersion(), info.version),
    }
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return this.state
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // 已下载时 error 事件只记下原因、不改状态。这里若再写成 error，会把上面的保留盖掉。
      // 事件没来（promise 直接拒绝）时补上原因，状态仍然留在 downloaded。
      if (this.state.status === 'downloaded') {
        if (!this.state.errorMessage) {
          this.setState({
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (this.state.status !== 'error') {
        // autoUpdater 的 error 事件已处理，这里兜底防止未捕获异常
        this.setState({
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return this.state
  }

  async downloadUpdate(): Promise<UpdateDownloadResult> {
    if (process.platform === 'darwin') {
      // macOS 装不了 electron-updater 的更新包，这里只把用户送到下载页。
      // 返回 `manual-download` 而不是 `false`：它不是失败，界面不该报「下载失败」。
      await this.openReleasesPage()
      return 'manual-download'
    }
    if (this.state.info?.requiresManualUpdate) {
      // 跨大版本：不下载、不自动装，只把用户送到发布页。
      // 自动装上去的代价是用户的配置在没有任何预告的情况下不再被读（见 `isMajorUpgrade`）。
      console.info(`[updater] manual update required currentVersion=${app.getVersion()} latestVersion=${this.state.info.latestVersion}`)
      await this.openReleasesPage()
      return 'manual-download'
    }
    // 已经在下就别重入：autoUpdater 会并排起第二次下载。
    if (this.state.status === 'downloading') return 'downloading'
    if (this.state.status !== 'update-available') {
      this.setState({
        status: 'error',
        errorMessage: nativeTranslator()('native.update.noneDownloadable'),
      })
      return 'failed'
    }
    try {
      console.info(`[updater] download started version=${this.state.info?.latestVersion ?? 'unknown'}`)
      this.setState({ status: 'downloading', downloadProgress: 0, errorMessage: null })
      await autoUpdater.downloadUpdate()
      // 下载成功由 update-downloaded 事件把 status 置为 downloaded；
      // 这里的返回值只回答「这次调用做了什么」。
      return 'download-complete'
    } catch (error) {
      console.error('[updater] download failed', error)
      this.setState({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        downloadProgress: null,
      })
      return 'failed'
    }
  }

  /**
   * 安装已下载的更新。macOS 打开发布页进行 DMG 手动安装，
   * 其他平台由 electron-updater 退出应用并启动安装程序。
   */
  async installUpdate(): Promise<void> {
    if (
      process.platform === 'darwin'
      || this.state.status !== 'downloaded'
      || Boolean(this.state.info?.requiresManualUpdate)
    ) {
      // macOS 使用 DMG 手动覆盖安装；跨大版本不走自动安装（即使包里已经躺着一个）；
      // 其他平台无已下载更新时也回退到发布页。
      console.info(`[updater] opening release page reason=${resolveManualInstallReason(this.state)}`)
      await this.openReleasesPage()
      return
    }
    console.info(`[updater] installing version=${this.state.info?.latestVersion ?? 'unknown'}`)
    // isSilent=false 显示安装界面，isForceRunAfter=true 安装后重启应用
    autoUpdater.quitAndInstall(false, true)
  }

  async openReleasesPage(): Promise<void> {
    await shell.openExternal(this.state.info?.releaseUrl ?? GITHUB_RELEASES_PAGE)
  }
}

/** 日志里那一行「为什么转去发布页」的原因码——三个分支各自可辨认。 */
function resolveManualInstallReason(state: UpdateState): string {
  if (process.platform === 'darwin') return 'manual-macos-install'
  if (state.info?.requiresManualUpdate) return 'major-version-manual-update'
  return 'update-not-downloaded'
}
