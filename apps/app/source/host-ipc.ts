/**
 * 宿主 IPC 面：渲染层通过 preload 声明的那些具名方法，落到主进程这一侧的实现。
 *
 * 这里只放**「应用能做什么」的最小面**——运行时基地址、外部链接、数据目录、原生外观、
 * 窗口全屏。它与 `source/preload.ts` 是一对：preload 声明通道名，这里提供另一端。
 *
 * 为什么单独一个模块而不是散在 `index.ts` 里：除了主窗口，还有一个**无头补拍入口**
 * （`screenshot-export-entry.ts`）也会开一个渲染窗口去加载控制台。宿主能力缺一个，
 * 渲染层在那一侧的行为就与用户手里那个窗口不同——`sendSync` 的通道少一个监听者，
 * 渲染进程会**永久阻塞**（错误只写成控制台里的一行 `without listeners`），
 * 表现成「截图脚本卡住」。两处各写一遍必然漂移，于是把实现收在这里共用。
 *
 * 只放共用实现，不放**应用级**的东西：单实例锁、托盘、更新器、服务进程、退出流程
 * 都仍归 `index.ts`——无头入口不需要，也不该需要它们。
 */

import { BrowserWindow, app, ipcMain, nativeTheme, shell } from 'electron'

/**
 * 原生窗口外观的取色。
 *
 * Electron 主进程没有「Vite 会把少用的导出从某个产物里摇掉」或「某侧用不到就别编」的问题：
 * 两份产物都是 ESM 全量引入本模块，所以放这里不会有形态差异。
 */
export const WINDOW_BACKGROUND = {
  light: '#f5f5f5',
  dark: '#0d0d0d',
} as const

/**
 * 非 macOS 用 `setTitleBarOverlay` 画标题栏，高度要与渲染层的 `WindowTitlebar`（`h-9`）一致。
 *
 * 与上一项同理导出：`applyWindowChrome` 在这里用它重建自己的窗口，`index.ts` 在构造
 * *主窗口* 时也要用同一个高度——后者的 options 在 `applyWindowChrome` 之外，重复写一遍
 * 字面量就等于留了一个「改了这里忘了那里」的口子。取值必须一致。
 */
export const WINDOW_TITLEBAR_HEIGHT = 36

/**
 * 内部状态：由**本模块注册的那些监听者**改写，`index.ts` 那边不再各自维护一份
 * 「主窗口是哪个」。只用于 `window:get-full-screen-state`——全屏状态只能从窗口上问。
 */
let primaryWindow: BrowserWindow | null = null

/**
 * 模块级「已注册」标记。
 *
 * `ipcMain` 的监听者存在主进程里：同一通道再注册一次，后一个会**静静盖掉**前一个，
 * 于是「主进程与无头入口谁先谁后」会决定行为，而这种差异只会在很怪的复现步骤里炸。
 * 标记让重复注册变成一条明确日志并跳过，注册是幂等的。
 */
const registered = {
  runtimeConfig: false,
  externalLink: false,
  openDataDirectory: false,
  windowTheme: false,
  nativeThemeSync: false,
  windowFullScreen: false,
}

/**
 * 渲染进程取运行时信息。
 *
 * preload 里是 `sendSync`，所以必须用 `event.returnValue` 而不是 `ipcMain.handle`：
 * 渲染进程从 `file://` 加载，靠页面 URL 推不出管理服务在哪儿，得在第一个请求之前拿到基地址。
 * **注册必须早于任何窗口创建**，否则渲染进程会在这一行上永久等下去。
 */
export function registerRuntimeConfigIpc(managementApiUrl: string): void {
  if (registered.runtimeConfig) {
    console.warn('[osw] runtime:get-config handler already registered; skipping')
    return
  }
  registered.runtimeConfig = true

  ipcMain.on('runtime:get-config', event => {
    event.returnValue = { apiBase: managementApiUrl }
  })
}

/**
 * 控制台请求用系统默认方式打开外部链接（`PlatformCapabilities.openExternal`）。
 *
 * 只放行 `https:`：渲染进程发过来的字符串不能直接交给 `shell.openExternal`，
 * 否则 `file:` / 自定义协议会被当成命令执行。
 */
export function registerExternalLinkIpc(): void {
  if (registered.externalLink) return
  registered.externalLink = true

  ipcMain.on('open-external', (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      console.warn('[osw] refused to open external url', url)
      return
    }
    void shell.openExternal(url).catch(error => {
      console.error('[osw] failed to open external url', error)
    })
  })
}

/**
 * 用系统文件管理器打开数据目录（`PlatformCapabilities.openDataDirectory`）。
 *
 * 目录**不带参数**、由这里自己取 `app.getPath('userData')`：渲染进程送过来的路径不能直接
 * 交给 `shell.openPath`，那等于把「打开任意目录」这个能力交回给了页面。这也是唯一正确的
 * 来源——数据目录就落在 userData 上（见 `index.ts` 顶部的 `app.setPath`）。
 *
 * 失败用 reject 回去而**不是**吞掉：调用方要能告诉用户「没打开」，否则按钮看起来像是点了没反应。
 */
export function registerOpenDataDirectoryIpc(): void {
  if (registered.openDataDirectory) return
  registered.openDataDirectory = true

  ipcMain.handle('open-data-directory', async () => {
    const target = app.getPath('userData')
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
  })
}

/** 把当前生效亮暗落到窗口底色 / 标题栏 overlay 上。 */
export function applyWindowChrome(target: BrowserWindow): void {
  // 具体亮暗一律从 `shouldUseDarkColors` 解析：`themeSource` 写入的瞬间它就已同步成目标值
  // （跟随系统时即操作系统当前值），不需要按模式分支。
  const dark = nativeTheme.shouldUseDarkColors
  const background = dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
  target.setBackgroundColor(background)
  if (process.platform !== 'darwin') {
    target.setTitleBarOverlay({
      color: background,
      symbolColor: dark ? '#f5f5f5' : '#171717',
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
export function applyWindowTheme(target: BrowserWindow, mode: 'light' | 'dark' | 'system'): void {
  nativeTheme.themeSource = mode
  applyWindowChrome(target)
}

/** 渲染层把生效主题模式推上来（`PlatformCapabilities.setTheme`），只改推上来的那个窗口。 */
export function registerWindowThemeIpc(): void {
  if (registered.windowTheme) return
  registered.windowTheme = true

  ipcMain.on('appearance:set-theme', (event, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target) applyWindowTheme(target, mode)
  })
}

/**
 * 「跟随系统」时操作系统切换亮暗，主进程只能从这里得知；手选亮暗走 `appearance:set-theme`
 * （`applyWindowTheme` 自带同步），themeSource 不是 system 档，这里直接跳过。
 *
 * `getTarget` 由调用方给：本模块不认识托盘面板，也不知道主窗口是哪个——那是应用级概念。
 * 返回 `null` 就跳过这一轮（例如无头补拍入口根本没有常驻窗口）。
 */
export function registerNativeThemeSync(getTarget: () => BrowserWindow | null): void {
  if (registered.nativeThemeSync) return
  registered.nativeThemeSync = true

  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource !== 'system') return
    const target = getTarget()
    if (target && !target.isDestroyed()) applyWindowChrome(target)
  })
}

/**
 * 原生全屏状态。
 *
 * 主窗口调 `registerWindowFullScreenEvents(win)` 把窗口登记进来并转发进出全屏事件；
 * 无头补拍入口不登记——它的窗口永远不是全屏，`window:get-full-screen-state` 回 `false`
 * 即可，正好就是 Electron 侧缺省时的正确值。
 */
export function registerWindowFullScreenEvents(target: BrowserWindow): void {
  primaryWindow = target
  const notify = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('window:full-screen-changed', target.isFullScreen())
    }
  }
  target.on('enter-full-screen', notify)
  target.on('leave-full-screen', notify)
}

export function registerWindowFullScreenIpc(): void {
  if (registered.windowFullScreen) return
  registered.windowFullScreen = true

  ipcMain.handle('window:get-full-screen-state', () => {
    if (!primaryWindow || primaryWindow.isDestroyed()) return false
    return primaryWindow.isFullScreen()
  })
}
