import { app, BrowserWindow, Menu, nativeImage, nativeTheme, ipcMain, dialog, session, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, onServerStateChanged, stopServer, forwardRuntimeLog } from './server-host'
import { installLogForwarding, setLogSink } from './log-forwarder'
import {
  appendMainLog,
  getQuitReason,
  installMainLogCapture,
  mainLogFilePath,
  noteQuitReason,
  startMainHeartbeat,
  stopMainHeartbeat,
} from './main-log'
import { listCurrentDatabaseFileNames } from '@common/database-file'
import { createRuntimeConfig } from '@common/runtime-config'
import { getRuntimeProfile } from '@common/runtime-profile'
import { ElectronSecretStore } from './secret-store'
import { TrayManager } from './tray-manager'
import { AutoLaunchManager } from './auto-launch'
import { UpdaterManager, type UpdateState } from './updater'
import { nativeTranslator, startNativeLanguageSync } from './i18n'
import { installWindowShortcuts } from './window-actions'
import { exportWebsiteScreenshots, type ScreenshotExportProgress } from './screenshot-export'
// Vite 将 build/icon.png 打包为 data URL，避免运行时路径解析问题。
// Windows 任务栏/窗口图标需要位图，PNG 可被 nativeImage 直接识别。
import windowIconPng from '../build/icon.png?url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬ output
// │ ├─┬ command
// │ │ ├── index.js          > Electron Main
// │ │ ├── preload.js        > Preload
// │ │ └── service-main.mjs  > Core service process（同步 SQLite 在里面，见 issue #9）
// │ └─┬ render
// │     ...
//
// 服务进程**必须在 `command` 目录里**：`packages/core/source/database/index.ts`
// 从 `import.meta.url` 往上找 `packages/core/drizzle`，只有这一层的上两层
// 在开发态（仓库根）与打包态（asar 根）都成立。

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const runtimeProfile = getRuntimeProfile(isDevelopment ? 'development' : 'production')

// `app.name` 是 macOS `safeStorage` 的钥匙串命名空间（`<name> Safe Storage`）。
// 它由运行档决定：生产 `OSW`，开发 `OSW Development`——两条环境各占一个命名空间，
// 互不干扰。必须在任何一次 `safeStorage` 调用之前设好；`setName` 之后已有密钥
// 仍按各自的名字存取，所以开发态反复重置数据目录不会碰到生产态的密文。
// 历史上 `app.name` 曾随包名（`@osw/app`）漂移，旧命名空间的残留在钥匙串里，
// 见 `apps/docs/product/packaging.md` §5.1。
app.setName(runtimeProfile.applicationName)

process.env.OUTPUT = path.join(__dirname, '..')

// 数据目录固定落在用户主目录，与命令行形态同一处（见 `apps/docs/product/packaging.md` §5.5）：两种形态
// 共用同一份配置与同一对数据库文件，所以「先用命令行跑起来、再开桌面端」不会看到两套空数据。
// Electron 自己的缓存与凭据也跟着搬过去——`app.getPath('userData')` 是它们的唯一落点。
app.setPath('userData', path.join(os.homedir(), runtimeProfile.dataDirectoryName))

// 主进程自己的落盘日志：必须比**任何一行输出**都早装上（早于 `installLogForwarding()`），
// 否则启动横幅——启动期唯一一组「服务之外」的信息——就只能走数据库那条通道，而服务
// 进程不在时那条通道没有落点。理由与取舍见 `main-log.ts`。
installMainLogCapture(app.getPath('userData'))

let win: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let autoLaunchManager: AutoLaunchManager | null = null
let updaterManager: UpdaterManager | null = null
let fatalErrorShown = false

/**
 * 开机自启时隐藏启动（`auto-launch.ts` 里声明了 `openAsHidden`）。
 *
 * macOS 有 `app.wasOpenedAsHidden`；Windows 通过登录项参数 `--hidden` 表达，Linux 的登录项
 * 由打包产物生成，同样按参数传。两者都没有时按正常启动——用户双击图标就是要看窗口。
 */
const startHidden = readWasOpenedAsHidden() || process.argv.includes('--hidden')

/** `app.wasOpenedAsHidden` 只存在于 macOS，且不在当前 Electron 的类型定义里。 */
function readWasOpenedAsHidden(): boolean {
  return (app as unknown as { wasOpenedAsHidden?: boolean }).wasOpenedAsHidden === true
}

// Windows 任务栏图标依赖 AppUserModelID；必须在创建任何窗口前设置，
// 否则系统会把进程归到默认 Electron 应用，导致显示默认图标。
if (process.platform === 'win32') {
  app.setAppUserModelId('com.yinxulai.osw')
}

function broadcastUpdateState(state: UpdateState) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:state-changed', state)
  }
}

function registerUpdaterIpc() {
  const updater = new UpdaterManager()
  updater.subscribe(broadcastUpdateState)
  updaterManager = updater

  ipcMain.handle('updater:get-state', () => updater.getState())
  ipcMain.handle('updater:check', () => updater.checkForUpdates())
  ipcMain.handle('updater:download', () => updater.downloadUpdate())
  ipcMain.handle('updater:install', () => updater.installUpdate())
  ipcMain.handle('updater:open-releases', () => updater.openReleasesPage())
}

/**
 * 控制台请求用系统默认方式打开外部链接（`PlatformCapabilities.openExternal`）。
 *
 * 只放行 `https:`：渲染进程发过来的字符串不能直接交给 `shell.openExternal`，
 * 否则 `file:` / 自定义协议会被当成命令执行。
 */
function registerExternalLinkIpc(): void {
  ipcMain.on('open-external', (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      console.warn('[osw] refused to open external url', url)
      return
    }
    void shell.openExternal(url).catch(error => {
      console.error('[osw] failed to open external url', formatError(error))
    })
  })
}

/**
 * 渲染进程取运行时信息。
 *
 * 预加载脚本用 `sendSync` 读一次，所以这里必须用 `event.returnValue` 而不是 `ipcMain.handle`：
 * 渲染进程从 `file://` 加载，靠页面 URL 推不出管理服务在哪儿，得在第一个请求之前拿到基地址。
 * handler 在模块顶层注册，早于任何窗口创建，同步调用不会死等。
 */
function registerRuntimeConfigIpc(): void {
  ipcMain.on('runtime:get-config', event => {
    event.returnValue = {
      apiBase: runtimeProfile.managementApiUrl,
    }
  })
}

/**
 * 用系统文件管理器打开数据目录（`PlatformCapabilities.openDataDirectory`）。
 *
 * 目录**不带参数**、由这里自己取 `app.getPath('userData')`：渲染进程送过来的路径不能直接
 * 交给 `shell.openPath`，那等于把「打开任意目录」这个能力交回给了页面。这也是唯一正确的
 * 来源——数据目录就落在 userData 上（见文件顶部的 `app.setPath`）。
 *
 * 失败用 reject 回去而**不是**吞掉：调用方要能告诉用户「没打开」，否则按钮看起来像是点了没反应。
 */
function registerOpenDataDirectoryIpc(): void {
  ipcMain.handle('open-data-directory', async () => {
    const target = app.getPath('userData')
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
  })
}

let screenshotExportPromise: Promise<{ count: number; outputDirectory: string }> | null = null

/**
 * 开发版截图导出。
 *
 * 单独开一个受控窗口逐页导航，主窗口和当前工作状态不参与，因此导出过程中
 * 用户仍可以继续操作主窗口。截图由 macOS 的 `screencapture -l` 抓完整原生窗口，
 * 而不是 `webContents.capturePage()`；后者拿不到标题栏、交通灯和窗口圆角。
 */
function registerScreenshotExportIpc(): void {
  if (!isDevelopment) return

  ipcMain.handle('screenshots:export', async event => {
    if (screenshotExportPromise) return screenshotExportPromise

    const outputDirectory = path.resolve(app.getAppPath(), '..', '..', 'snapshot')
    const sendProgress = (progress: ScreenshotExportProgress) => {
      if (!event.sender.isDestroyed()) event.sender.send('screenshots:export-progress', progress)
    }

    screenshotExportPromise = exportWebsiteScreenshots({
      baseUrl: process.env.VITE_DEV_SERVER_URL!,
      outputDirectory,
      preloadPath: path.join(__dirname, 'preload.js'),
      onProgress: sendProgress,
    }).finally(() => {
      screenshotExportPromise = null
    })

    return screenshotExportPromise
  })
}

// 这一层**不是**数据目录那把锁，而是操作系统级的「应用实例」：它把第二次启动变成一个
// 「聚焦已有窗口」的事件（见 `second-instance` / `focusExistingInstance`），并且必须在
// 任何窗口存在之前就判定。数据目录的互斥是 core 的事（`runtime/instance-lock.ts`），
// 两者不重复也不替代：没有这一层，双击两次图标会先弹一个「启动失败」的报错框再退出。
const isPrimaryInstance = app.requestSingleInstanceLock()

if (isPrimaryInstance) {
  registerUpdaterIpc()
  registerExternalLinkIpc()
  registerRuntimeConfigIpc()
  registerOpenDataDirectoryIpc()
  registerScreenshotExportIpc()
  registerWindowThemeIpc()
  registerNativeThemeSync()
  registerWindowFullScreenIpc()
} else {
  console.info('[osw] another instance already owns this profile; exiting')
}

function reportFatalError(error: unknown, title = nativeTranslator()('native.error.fatalTitle')): void {
  if (fatalErrorShown) return
  fatalErrorShown = true
  // 先记原因再做事：哪怕弹框或 `app.quit()` 卡住，落盘日志里也已经留下「为什么退」。
  // 原因通常由调用方用 `noteQuitReason()` 先写好，没写就退回这个默认值。
  if (getQuitReason() === null) noteQuitReason('fatal-error')

  const detail = formatError(error)
  console.error(`[osw] ${title}`, detail)

  const showDialog = () => {
    dialog.showErrorBox(title, `${detail}\n\n${nativeTranslator()('native.error.fatalDetail')}`)
  }

  if (app.isReady()) {
    showDialog()
    app.quit()
  } else {
    void app.whenReady().then(() => {
      showDialog()
      app.quit()
    })
  }
}

process.on('uncaughtException', error => {
  noteQuitReason('uncaught-exception')
  reportFatalError(error)
})

/**
 * 被信号终止也记一笔。
 *
 * 装了监听器就会吞掉 Node 默认的「收到即退出」，所以这里显式还原：先走一次正常退出（让
 * `before-quit` 去释放实例锁与数据库），再用一个兜底定时器保证清理卡住时进程仍然会结束。
 * 闪退若是外部所杀（注销、`kill`），这几行常常是事后唯一的线索。
 */
const SIGNAL_NUMBERS: ReadonlyArray<readonly [string, number]> = [
  ['SIGHUP', 1],
  ['SIGINT', 2],
  ['SIGTERM', 15],
]

for (const [signal, signalNumber] of SIGNAL_NUMBERS) {
  process.on(signal, () => {
    noteQuitReason(`signal-${signal}`)
    app.quit()
    const fallback = setTimeout(() => app.exit(128 + signalNumber), 5_000)
    fallback.unref()
  })
}

/**
 * 未处理的 Promise 拒绝不当作致命错误。
 *
 * 主进程里任何一个没接住的 `await` 都会走到这里。原来一律弹框退出——托盘常驻的应用
 * 因为这个原因突然消失，用户看到的是「闪退」，而我们连是哪一处拒绝都不知道（对话框里
 * 只有堆栈，日志也到不了）。现在只记日志：真正不可恢复的问题会在实际使用路径上暴露，
 * 而不是靠一次偶发拒绝把整个进程带走。
 */
process.on('unhandledRejection', reason => {
  console.error('[osw] unhandled rejection', formatError(reason))
})

function formatUptime(): string {
  const seconds = Math.floor(process.uptime())
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

function showStartupError(error: unknown): void {
  if (fatalErrorShown) return
  fatalErrorShown = true

  const detail = formatError(error)
  console.error('[osw] startup failed', detail)

  // 启动阶段还没有可用的渲染窗口，必须使用原生对话框告知用户，
  // 否则 app.quit() 会让应用看起来像是“启动后直接关闭”。
  const t = nativeTranslator()
  dialog.showErrorBox(
    t('native.error.startupTitle'),
    `${t('native.error.startupDetail')}\n\n${detail}`,
  )
}

function logStartupBanner() {
  const versions = process.versions
  const platformMap: Record<string, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  }
  const archMap: Record<string, string> = {
    x64: 'x64 (64-bit)',
    ia32: 'ia32 (32-bit)',
    arm64: 'arm64 (64-bit)',
    arm: 'arm (32-bit)',
  }

  const lines = [
    '',
    '  ╔══════════════════════════════════════════════════╗',
    '  ║               OSW is starting...                ║',
    '  ╚══════════════════════════════════════════════════╝',
    '',
    `  Application :  ${app.getName()} v${app.getVersion()}`,
    `  Environment :  ${runtimeProfile.environment}`,
    `  Electron    :  v${versions.electron}`,
    `  Node.js     :  ${versions.node}`,
    `  Chromium    :  ${versions.chrome}`,
    `  V8          :  ${versions.v8}`,
    `  Platform    :  ${platformMap[process.platform] ?? process.platform} (${archMap[process.arch] ?? process.arch})`,
    `  OS Release  :  ${os.type()} ${os.release()}`,
    `  Hostname    :  ${os.hostname()}`,
    `  CPU Cores   :  ${os.cpus().length} (${os.cpus()[0]?.model ?? 'unknown'})`,
    `  Memory      :  ${Math.round(os.totalmem() / 1024 / 1024)} MB total`,
    `  User Data   :  ${app.getPath('userData')}`,
    `  Main Log    :  ${mainLogFilePath() ?? '(unavailable)'}`,
    `  Databases   :  ${listCurrentDatabaseFileNames().join(', ')}`,
    `  Proxy Port  :  ${runtimeProfile.proxyPort}`,
    `  Admin Port  :  ${runtimeProfile.managementPort}`,
    `  PID         :  ${process.pid}`,
    `  Uptime      :  ${formatUptime()}`,
    '',
  ]

  console.log(lines.join('\n'))
}

function resolveWindowIcon() {
  // Vite 把 ?url 解析为 data URL，开发/打包后均可直接使用，
  // 避免生产环境下 build/ 目录未被复制到 output 的路径问题。
  // Windows 任务栏/窗口图标接受 PNG；exe/安装包图标由 electron-builder 使用 icon.ico。
  return nativeImage.createFromDataURL(windowIconPng)
}

const WINDOW_BACKGROUND = {
  light: '#f5f5f5',
  dark: '#0d0d0d',
} as const

// 与 renderer 里的 `WindowTitlebar` (`h-9`) 保持一致。
const WINDOW_TITLEBAR_HEIGHT = 36
const MAC_TRAFFIC_LIGHT_Y = 12

function applyWindowChrome(target: BrowserWindow): void {
  // 具体亮暗一律从 `shouldUseDarkColors` 解析：`themeSource` 写入的瞬间它就已同步成目标值
  // （跟随系统时即操作系统当前值），不需要按模式分支。
  const background = nativeTheme.shouldUseDarkColors
    ? WINDOW_BACKGROUND.dark
    : WINDOW_BACKGROUND.light
  target.setBackgroundColor(background)
  if (process.platform !== 'darwin') {
    target.setTitleBarOverlay({
      color: background,
      symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f5' : '#171717',
      height: WINDOW_TITLEBAR_HEIGHT,
    })
  }
}

/**
 * `'system'` 必须原样进 `themeSource`，不能在这里解析成具体亮暗：`themeSource` 是整个应用
 * 的开关，一旦写成 `'light'` / `'dark'`，`shouldUseDarkColors` 和渲染层的
 * `prefers-color-scheme` 都被钉死在设置那一刻，操作系统后续怎么切换都不再更新——
 * 「跟随系统」就只剩启动那一瞬。留在 system 档，Electron 会自己跟随，渲染层的
 * `matchMedia` 订阅也因此保持有效。
 */
function applyWindowTheme(target: BrowserWindow, mode: 'light' | 'dark' | 'system'): void {
  nativeTheme.themeSource = mode
  applyWindowChrome(target)
}

/**
 * macOS 不允许应用完全移除菜单栏，系统至少会保留应用菜单。
 * 窗口动作不再通过系统菜单提供，这里只注册快捷键，不再安装
 * File/Edit/View/Window 这组默认菜单，只保留系统要求存在的应用菜单。
 */
function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          {
            label: runtimeProfile.applicationName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ])
      : null,
  )
}

function registerWindowThemeIpc(): void {
  ipcMain.on('appearance:set-theme', (event, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target) applyWindowTheme(target, mode)
  })
}

function registerNativeThemeSync(): void {
  // 「跟随系统」时操作系统切换亮暗，主进程只能从这里得知；手选亮暗走 `appearance:set-theme`
  // （applyWindowTheme 自带同步），themeSource 不是 system 档，这里直接跳过。
  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource !== 'system') return
    // 只补主窗口的原生外观：托盘面板是透明窗口（backgroundColor '#00000000'），
    // setBackgroundColor 会把透明底换成实色，砸掉面板的浮层观感。面板的亮暗由渲染层的
    // `prefers-color-scheme` 跟着变，不依赖这里的底色。
    if (win && !win.isDestroyed()) applyWindowChrome(win)
  })
}

function registerWindowFullScreenEvents(target: BrowserWindow): void {
  const notify = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('window:full-screen-changed', target.isFullScreen())
    }
  }
  target.on('enter-full-screen', notify)
  target.on('leave-full-screen', notify)
}

function registerWindowFullScreenIpc(): void {
  ipcMain.handle('window:get-full-screen-state', () => win?.isFullScreen() ?? false)
}

function createWindow() {
  win = new BrowserWindow({
    title: 'OSW',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: resolveWindowIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? WINDOW_BACKGROUND.dark
      : WINDOW_BACKGROUND.light,
    ...(process.platform === 'darwin'
        ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: MAC_TRAFFIC_LIGHT_Y },
        }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: nativeTheme.shouldUseDarkColors
              ? WINDOW_BACKGROUND.dark
              : WINDOW_BACKGROUND.light,
            symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f5' : '#171717',
            height: WINDOW_TITLEBAR_HEIGHT,
          },
        }),
    // 开机自启时不闪窗口；窗口仍然创建（托盘要挂着它接 close 事件），等托盘点开再 show。
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  installWindowShortcuts(win, { enableDevTools: isDevelopment })
  // 渲染层加载后会把真实偏好的生效模式推上来（`appearance:set-theme`）；在那之前先停在
  // system 档按操作系统解析，别把启动那一刻的值钉死（见 `applyWindowTheme` 注释）。
  applyWindowTheme(win, 'system')
  registerWindowFullScreenEvents(win)

  win.setMenuBarVisibility(false)

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    const failed = nativeTranslator()('native.error.rendererLoadFailed', {
      code: errorCode,
      description: errorDescription,
    })
    showStartupError(new Error(failed))
    void stopServer().catch(stopError => {
      console.error('[osw] failed to stop server after renderer load failure', formatError(stopError))
    })
    noteQuitReason('renderer-load-failed')
    app.quit()
  })

  // 窗口无响应/恢复。长时间无响应往往是被某个同步操作卡死的前兆。
  win.on('unresponsive', () => {
    appendMainLog('warn', '[lifecycle] window became unresponsive')
  })
  win.on('responsive', () => {
    appendMainLog('info', '[lifecycle] window became responsive again')
  })

  if (isDevelopment) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!).catch(error => {
      showStartupError(error)
      noteQuitReason('dev-server-load-failed')
      app.quit()
    })
    win.webContents.openDevTools()
  } else {
    void win.loadFile(path.join(process.env.OUTPUT!, 'render', 'index.html')).catch(error => {
      showStartupError(error)
      noteQuitReason('renderer-file-load-failed')
      app.quit()
    })
  }
}

/**
 * 第二个实例启动时，把它叫到已有窗口前面来。
 *
 * 只在窗口已经存在时才有意义：第一个实例可能还在启动过程里，此时什么都不做——
 * 用户看到的是第一个实例的启动过程，比弹一个「已经在运行」的报错框要好。
 */
function focusExistingInstance(): void {
  if (!win) {
    console.info('[osw] second instance launched while still starting up; ignoring')
    return
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  app.setAboutPanelOptions({
    applicationName: runtimeProfile.applicationName,
    applicationVersion: app.getVersion(),
  })
  // 渲染层不再绘制窗口菜单；系统菜单栏只保留 macOS 必须存在的应用菜单。
  installApplicationMenu()

  // 先接管 console 再输出任何东西：横幅是启动期唯一一组「服务之外」的信息
  // （Electron 版本、数据目录、进程号），漏掉它就等于这次转发没做。
  // 这时服务进程还没起来，所以 `log-forwarder` 先把行攒着，等服务就绪再补送。
  installLogForwarding()
  logStartupBanner()

  // 服务进程崩溃重启的预算也会用尽。到那一步应用已经没什么可做的了：
  // 有窗口的显示错误，没窗口的弹原生对话框，然后退出。
  onServerStateChanged(state => {
    if (state.kind === 'failed') {
      noteQuitReason('service-restart-exhausted')
      reportFatalError(state.error)
    }
  })

  const userDataDir = app.getPath('userData')
  const runtimeConfig = createRuntimeConfig({
    environment: runtimeProfile.environment,
    // 版本号只有一个来源（打包出来的清单），主进程已经拿得到，不再让服务进程自己猜一遍。
    appVersion: app.getVersion(),
    runtime: 'desktop',
    dataDir: userDataDir,
    // 桌面形态的窗口直接 loadFile 加载控制台产物，不由管理服务托管静态文件。
    serveWeb: false,
  })
  try {
    await startServer({
      runtimeConfig,
      secretStore: new ElectronSecretStore(path.join(userDataDir, 'secrets.json')),
      systemProxyResolver: targetUrl => session.defaultSession.resolveProxy(targetUrl),
    })
  } catch (error) {
    showStartupError(error)
    noteQuitReason('server-start-failed')
    app.quit()
    return
  }

  // 服务起来了，把 console 的落点接上：`installLogForwarding()` 之后攒下的行
  // （横幅及启动期的报错）在这里一次性补送，之后逐行实时过去。
  setLogSink(forwardRuntimeLog)

  // 托盘与原生对话框的语言真相源仍是 settings.language；数据库还读不出来时退回系统语言。
  await startNativeLanguageSync()

  try {
    createWindow()
  } catch (error) {
    showStartupError(error)
    await stopServer().catch(stopError => {
      console.error('[osw] failed to stop server after startup failure', formatError(stopError))
    })
    noteQuitReason('window-create-failed')
    app.quit()
    return
  }

  // 初始化系统托盘
  try {
    trayManager = new TrayManager()
    trayManager.init(win!)
  } catch (error) {
    trayManager = null
    console.error('[osw] failed to initialize tray', error)
  }

  // 开发环境不应修改系统登录项。
  if (runtimeProfile.environment === 'production') {
    autoLaunchManager = new AutoLaunchManager()
    void autoLaunchManager.init()
  } else {
    console.debug('[auto-launch] initialization skipped reason=development')
  }

  // 启动 10 秒后静默检查一次更新，避免阻塞启动。
  // 仅在生产环境执行，开发环境下版本号无意义。
  if (runtimeProfile.environment === 'production' && updaterManager) {
    setTimeout(() => {
      void updaterManager!.checkForUpdates()
    }, 10_000)
  }

  console.info(`[osw] ready startupDuration=${formatUptime()}`)

  // 心跳：闪退最缺的就是时间线，有了它才能从日志最后一行判断进程死在哪一刻。
  startMainHeartbeat()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (trayManager) void trayManager.showWindow()
  })
}

/**
 * 单实例判定放在最后：`bootstrap` 是函数声明会提升，但读起来顺序更清楚——
 * 非主实例根本走不到启动流程。
 */
if (isPrimaryInstance) {
  app.on('second-instance', focusExistingInstance)
  void bootstrap()
} else {
  noteQuitReason('secondary-instance')
  app.quit()
}

app.on('window-all-closed', () => {
  // 不退出应用，保持在托盘运行
  // if (process.platform !== 'darwin') app.quit()
  appendMainLog('info', '[lifecycle] all windows closed; staying resident in tray')
})

/**
 * 进程级崩溃兜底。这几类事件此前完全没有监听：渲染进程崩了、GPU/工具进程崩了，主进程在用户
 * 眼里只是「窗口突然白了」，日志里一个字也没有。`reason` 是 Electron 给出的原始分类，
 * 没有它就只能对着现象猜。
 */
app.on('render-process-gone', (_event, contents, details) => {
  appendMainLog(
    'error',
    `[lifecycle] render process gone type=${contents.getType()} reason=${details.reason} exitCode=${details.exitCode}`,
  )
})

app.on('child-process-gone', (_event, details) => {
  appendMainLog(
    'error',
    `[lifecycle] child process gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} serviceName=${details.serviceName ?? '-'}`,
  )
})

app.on('will-quit', () => {
  appendMainLog('info', `[lifecycle] will-quit reason=${getQuitReason() ?? 'unknown'}`)
})

app.on('quit', (_event, exitCode) => {
  appendMainLog(
    'info',
    `[lifecycle] quit exitCode=${exitCode} reason=${getQuitReason() ?? 'unknown'}`,
  )
})

let quitting = false

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * 退出清理。
 *
 * `before-quit` 不看 `await`，所以先拦下这次退出，清理完再 `app.quit()` 一次
 * （`quitting` 保证第二次不会被再拦）。清理里最要紧的是 `stopServer()`：它释放实例锁、
 * 关掉数据库连接；原来这里只是 `void stopServer()`，没人等它，进程经常在释放锁之前就没了。
 */
async function shutdown(): Promise<void> {
  stopMainHeartbeat()
  appendMainLog('info', `[lifecycle] shutdown started reason=${getQuitReason() ?? 'unknown'}`)

  // 托盘先拆：它的状态轮询每 2 秒打一次管理 API，服务关掉之后它就只是一台报错机器。
  trayManager?.destroy()
  trayManager = null

  try {
    // 服务端本身带关闭握手，这里再兜一个上限，别让某个挂住的连接把退出拖住。
    await Promise.race([stopServer(), delay(5_000)])
  } catch (error) {
    console.error('[osw] failed to stop the server during quit', formatError(error))
  }
  appendMainLog('info', '[lifecycle] shutdown completed')
}

app.on('before-quit', event => {
  appendMainLog('info', `[lifecycle] before-quit reason=${getQuitReason() ?? 'unknown'}`)
  // 无论是谁触发的退出，都要先让托盘别再拦窗口关闭。
  trayManager?.prepareForQuit()
  if (quitting || !isPrimaryInstance) return
  event.preventDefault()
  quitting = true
  void shutdown().finally(() => app.quit())
})
