/// <reference types="vite/client" />

/** 构建时由 Vite 注入（见 `vite.config.ts` 与 `packages/toolkit/vitest.config.ts` 的 `define`）：`package.json` 的 `version`。 */
declare const __APP_VERSION__: string

type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
  /** 跨应用大版本的破坏性更新：不做自动更新，只能手动下载安装。 */
  requiresManualUpdate: boolean
}

interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfo | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

/** `download()` 的结果，与主进程 `apps/app/source/updater.ts` 的 `UpdateDownloadResult` 一致。 */
type UpdateDownloadResult =
  | 'downloading'
  | 'download-complete'
  | 'manual-download'
  | 'failed'

interface UpdaterAPI {
  getState: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateDownloadResult>
  install: () => Promise<void>
  openReleases: () => Promise<void>
  onStateChanged: (callback: (state: UpdateState) => void) => () => void
}

interface ScreenshotExportProgress {
  completed: number
  total: number
  current: string
}

interface ScreenshotExportResult {
  count: number
  outputDirectory: string
}

interface ScreenshotExportAPI {
  exportAll: () => Promise<ScreenshotExportResult>
  onProgress: (callback: (progress: ScreenshotExportProgress) => void) => () => void
}

interface ElectronAPI {
  platform: string
  /** 用系统默认方式打开外部链接。主进程只放行 `https:`。 */
  openExternal: (url: string) => void
  /** 用系统文件管理器打开数据目录。失败时 reject（例如系统没有默认文件管理器）。 */
  openDataDirectory: () => Promise<void>
  /** 把渲染层当前生效的亮暗主题告知主进程；老版本 preload 可能没有。 */
  setTheme?: (theme: 'light' | 'dark') => void
  /** 主窗口进入或退出原生全屏时通知渲染层。 */
  onFullScreenChanged?: (callback: (fullScreen: boolean) => void) => () => void
  getFullScreenState?: () => Promise<boolean>
  screenshots?: ScreenshotExportAPI
  updater: UpdaterAPI
}

/**
 * 宿主注入的运行时信息（`window.__OSW__`）。
 *
 * 回答一个问题：控制台这份产物只有一份，它怎么找到管理服务？Electron 形态从 `file://`
 * 加载页面，靠 URL 推不出管理服务在哪儿，所以由 preload 注入 `apiBase`；浏览器形态
 * 是 `undefined`，控制台按页面来源自己算（见 `api/client.ts`）。
 */
interface OswRuntime {
  apiBase?: string
}

/**
 * 托盘面板窗口的宿主桥（`apps/app/source/tray-panel-preload.ts`）。
 *
 * 刻意只剩「窗口自己才能做的事」：面板里显示的每一个数据都不在这里——那些走管理 API 与
 * 实时流，与控制台同一条通路。这里一旦多出 `getState` 之类的方法，就等于又开了一条
 * 「面板另拉一份数据」的路，那正是这次重构要拆掉的东西。
 *
 * 因此也没有代理开关：`useProxyToggle` 直接调管理 API，主进程每 2 秒读同一个服务来刷托盘
 * 菜单，两边看到的是同一份状态。
 */
interface TrayPanelAPI {
  /** 打开主界面，并收起面板。 */
  openMainWindow: () => Promise<void>
  /** 退出应用。 */
  quit: () => void
  /** 把面板内容高度报给宿主窗口：面板的高度由内容决定，窗口跟着走。 */
  resize: (height: number) => void
}

interface Window {
  /** 只有 Electron 形态（preload 注入）才有；浏览器形态是 `undefined` 。 */
  electronAPI?: ElectronAPI
  /** 只有托盘面板窗口使用；主控制台不依赖它。 */
  trayPanel?: TrayPanelAPI
  __OSW__?: OswRuntime
}
