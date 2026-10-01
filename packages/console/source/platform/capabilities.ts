/**
 * 宿主能力。
 *
 * 控制台有两种运行形态：Electron 窗口里（`window.electronAPI` 由 preload 注入）和浏览器里
 * （命令行形态托管，或 Vite dev server）。形态差异只在这一层判断一次，别处一律用
 * `getPlatformCapabilities()`——业务组件里不该再出现 `window.electronAPI` 字面量
 * （见 `apps/docs/product/packaging.md` §5.4）。
 *
 * 拿不到的能力就是 `null`：界面按「正常但不可用」渲染，不换一套简化排版。
 */

export type PlatformName = 'electron' | 'web'
export type PlatformOs = 'darwin' | 'win32' | 'linux' | 'unknown'

export interface PlatformCapabilities {
  name: PlatformName
  /** 宿主操作系统。只有 Electron 形态拿得到准确值，浏览器形态按 UA 猜。 */
  os: PlatformOs
  /** 应用内更新。浏览器形态没有这个概念（产物是托管在本地服务上的静态文件）。 */
  updater: UpdaterAPI | null
  /** 开发版自动导出官网截图。仅 macOS Electron 开发态提供。 */
  screenshotExport: ScreenshotExportAPI | null
  /** 把渲染层当前生效的主题模式告知宿主：`'system'` 时宿主保持跟随操作系统。浏览器形态不需要。 */
  setTheme: ((theme: 'light' | 'dark' | 'system') => void) | null
  /** 订阅原生窗口全屏状态；系统窗口按钮会随全屏状态改变位置或隐藏。 */
  onFullScreenChanged: ((callback: (fullScreen: boolean) => void) => () => void) | null
  /** 读取当前是否处于原生全屏，保证订阅建立前已经进入全屏时也能得到正确状态。 */
  getFullScreenState: (() => Promise<boolean>) | null
  /** 用系统默认方式打开外部链接。 */
  openExternal: (url: string) => void
  /**
   * 用系统文件管理器打开数据目录。浏览器形态没有这个概念（目录在那台机器上，
   * 不在这台机器上），所以是 `null`；界面照常渲染，只是按钮不可用。
   */
  openDataDirectory: (() => Promise<void>) | null
}

let cached: PlatformCapabilities | null = null

export function getPlatformCapabilities(): PlatformCapabilities {
  if (!cached) cached = detectCapabilities()
  return cached
}

function detectCapabilities(): PlatformCapabilities {
  const electronApi = typeof window === 'undefined' ? undefined : window.electronAPI
  if (electronApi) {
    const { getFullScreenState, onFullScreenChanged, setTheme } = electronApi

    return {
      name: 'electron',
      os: normalizeOs(electronApi.platform),
      // `?? null`：老版本的 preload 可能没暴露 updater，缺能力不代表崩。
      updater: electronApi.updater ?? null,
      screenshotExport: electronApi.screenshots ?? null,
      setTheme: setTheme ? theme => setTheme(theme) : null,
      onFullScreenChanged: onFullScreenChanged ? callback => onFullScreenChanged(callback) : null,
      getFullScreenState: getFullScreenState ? () => getFullScreenState() : null,
      openExternal: url => electronApi.openExternal(url),
      // 同理：preload 与渲染层是两份产物，版本能对不上。
      openDataDirectory: electronApi.openDataDirectory
        ? () => electronApi.openDataDirectory()
        : null,
    }
  }
  return {
    name: 'web',
    os: detectBrowserOs(),
    updater: null,
    screenshotExport: null,
    setTheme: null,
    onFullScreenChanged: null,
    getFullScreenState: null,
    openExternal: url => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
    },
    openDataDirectory: null,
  }
}

function normalizeOs(platform: string | undefined): PlatformOs {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return 'unknown'
}

function detectBrowserOs(): PlatformOs {
  if (typeof navigator === 'undefined') return 'unknown'
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase()
  if (source.includes('mac')) return 'darwin'
  if (source.includes('win')) return 'win32'
  if (source.includes('linux') || source.includes('x11')) return 'linux'
  return 'unknown'
}
