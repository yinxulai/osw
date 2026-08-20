import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'

const GITHUB_RELEASES_PAGE = 'https://github.com/yinxulai/one-switch/releases/latest'

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
 * 基于 electron-updater 的官方自动更新实现。
 *
 * 更新源由 electron-builder.config.cjs 的 publish 配置决定（GitHub Releases）。
 * 打包时 electron-builder 会生成 app-update.yml 并嵌入应用，autoUpdater 自动读取。
 *
 * 事件流：
 *   checking-for-update → update-available → download-progress → update-downloaded
 *                       → update-not-available
 *                       → error
 *
 * 前端通过 IPC 触发 check/download/install，状态变化通过监听器广播。
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
    // 不自动安装，由用户点击"立即安装"触发
    autoUpdater.autoInstallOnAppQuit = false
    // 允许预发布版本（pre-release 阶段）
    autoUpdater.allowPrerelease = true

    // macOS 应用为 ad-hoc 签名（无开发者证书），每次构建的 CDHash 都不同，
    // ShipIt 校验 designated requirement 必然失败（"代码未能满足指定的代码要求"）。
    // 因此关闭更新包的代码签名校验；zip 内的完整性由 latest-mac.yml 的 sha512 保证。
    if (process.platform === 'darwin') {
      // electron-updater 类型定义未暴露该属性，运行时实际存在（MacUpdater 支持）
      ;(autoUpdater as unknown as { verifyUpdateCodeSignature: boolean }).verifyUpdateCodeSignature = false
    }

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', errorMessage: null })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'update-available',
        info: this.mapInfo(info),
        errorMessage: null,
        downloadProgress: null,
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
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
      this.setState({
        status: 'downloaded',
        info: this.mapInfo(info),
        downloadProgress: 1,
        // electron-updater 内部管理下载缓存，不暴露文件路径
        downloadedFile: null,
      })
    })

    autoUpdater.on('error', (error: Error) => {
      const message = app.isPackaged
        ? error.message
        : `开发环境无法检查更新：${error.message}`
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
      releaseUrl: GITHUB_RELEASES_PAGE,
      assets,
      preferredAsset: assets[0],
    }
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return this.state
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // autoUpdater 的 error 事件已处理，这里兜底防止未捕获异常
      if (this.state.status !== 'error') {
        this.setState({
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return this.state
  }

  async downloadUpdate(): Promise<string | null> {
    if (this.state.status === 'downloading') return null
    if (this.state.status !== 'update-available') {
      this.setState({
        status: 'error',
        errorMessage: '当前没有可下载的更新',
      })
      return null
    }
    try {
      this.setState({ status: 'downloading', downloadProgress: 0, errorMessage: null })
      await autoUpdater.downloadUpdate()
      // 下载完成由 update-downloaded 事件处理
      return null
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        downloadProgress: null,
      })
      return null
    }
  }

  /**
   * 安装已下载的更新。electron-updater 会退出应用并启动安装程序。
   * Windows 下运行 NSIS 安装包；macOS 下替换 .app 后重启。
   */
  async installUpdate(): Promise<void> {
    if (this.state.status !== 'downloaded') {
      // 没有已下载的更新时，打开发布页
      await shell.openExternal(this.state.info?.releaseUrl ?? GITHUB_RELEASES_PAGE)
      return
    }
    // isSilent=false 显示安装界面，isForceRunAfter=true 安装后重启应用
    autoUpdater.quitAndInstall(false, true)
  }

  async openReleasesPage(): Promise<void> {
    await shell.openExternal(this.state.info?.releaseUrl ?? GITHUB_RELEASES_PAGE)
  }
}
