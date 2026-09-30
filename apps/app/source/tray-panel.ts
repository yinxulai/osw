/**
 * 托盘面板窗口。
 *
 * 面板本身**不是这里画的**：它是控制台那份产物里的第二个 HTML 入口
 * （`packages/console/tray.html`），与主界面共用同一份组件、查询、实时流与推导。这个文件
 * 只负责「窗口」这件事——摆在哪、多高、怎么关，以及把三个只有宿主才做得到的动作
 * （打开主界面、退出、按内容高度改窗口尺寸）递给页面。
 *
 * 于是这里**没有**任何数据读取：没有数据库快照，也没有「面板状态」这类需要跟着业务字段
 * 一起演进的 IPC 载荷。面板要显示什么，是渲染层自己的事。
 */

import { BrowserWindow, ipcMain, screen, type Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRAY_PANEL_GUTTER } from '@common/tray-panel'

// 面板的 preload 产物就在主进程旁边（`apps/app/output/command/`），名字由
// `vite.tray-panel.config.ts` 钉死。定位方式沿用 `packages/core/source/database/index.ts`
// 与 `apps/cli/source/host.ts` 的那一套：按 `import.meta.url` 反推目录，不用
// `import.meta.dirname`——两者都是「产物平铺在同一层」这条假设的写法，但这套在别处
// 已经有注释解释过原因，不在这里换一种。
const preloadBundlePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tray-panel-preload.js')

// 窗口比内容卡片多一圈透明留白，CSS 阴影不再被窗口边界裁断。宽度按
// `TRAY_PANEL_GUTTER` 反推，卡片本体宽度仍保持原来的 366px。
const PANEL_WIDTH = 422
const PANEL_MIN_HEIGHT = 380
const PANEL_MAX_HEIGHT = 680
const PANEL_INITIAL_HEIGHT = 560
const PANEL_GAP = 8
// 与渲染层共用的那个常量：留白两边都有份，谁都不能只改自己这一侧。
const PANEL_PADDING = TRAY_PANEL_GUTTER
// 「这一击是用来关面板的」判定的有效期。只覆盖 blur 与 click 之间的那几十毫秒。
// 时间戳用完即清零（见 `show()`），所以这个窗口只对「紧跟 blur 的那一次」生效，
// 不会顺延吃掉用户真正的下一击。也不能更短，否则会出现「点了关不掉」。
const PANEL_BLUR_TOGGLE_WINDOW = 160

interface TrayPanelRectangle {
  x: number
  y: number
  width: number
  height: number
}

interface TrayPanelPoint {
  x: number
  y: number
}

interface TrayPanelDisplay {
  workArea: TrayPanelRectangle
}

/** 面板要挂在哪：托盘图标的矩形，加上它所在显示器的工作区。 */
interface TrayPanelAnchor {
  trayBounds: TrayPanelRectangle
  workArea: TrayPanelRectangle
}

interface ResolveTrayPanelPositionInput {
  trayBounds: TrayPanelRectangle
  workArea: TrayPanelRectangle
  height: number
  platform: NodeJS.Platform
}

interface ResolveTrayPanelAnchorInput {
  trayBounds: TrayPanelRectangle
  cursor: TrayPanelPoint
  platform: NodeJS.Platform
  displayAt: (point: TrayPanelPoint) => TrayPanelDisplay
  primaryDisplay: () => TrayPanelDisplay
}

/**
 * 托盘图标矩形与工作区都不可信时用光标兜底。
 *
 * 光标一定在用户正在看的那块屏上，而状态项刚创建 / 被 macOS 因菜单栏溢出收起 /
 * 显示器热插拔之后，这两个东西都会给出上一套配置里的坐标。`{ 0, 0, 0, 0 }` 尤其危险：
 * 它是个「看起来合法」的点，`getDisplayNearestPoint` 会老老实实返回主屏，
 * 面板就被摆到另一台显示器上去了。
 */
function isUsableRectangle(rectangle: TrayPanelRectangle): boolean {
  return rectangle.width > 0 && rectangle.height > 0
}

export function resolveTrayPanelPosition(input: ResolveTrayPanelPositionInput): { x: number; y: number } {
  const targetX = Math.round(input.trayBounds.x + input.trayBounds.width / 2 - PANEL_WIDTH / 2)
  const targetY = input.platform === 'darwin'
    ? Math.round(input.trayBounds.y + input.trayBounds.height + PANEL_GAP - PANEL_PADDING)
    : Math.round(input.trayBounds.y - input.height - PANEL_GAP + PANEL_PADDING)

  const minX = input.workArea.x + PANEL_GAP - PANEL_PADDING
  const maxX = input.workArea.x + input.workArea.width - PANEL_WIDTH + PANEL_PADDING - PANEL_GAP
  const minY = input.workArea.y + PANEL_GAP - PANEL_PADDING
  const maxY = input.workArea.y + input.workArea.height - PANEL_GAP - input.height + PANEL_PADDING

  return {
    x: Math.min(Math.max(targetX, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(targetY, minY), Math.max(minY, maxY)),
  }
}

/**
 * 解析面板的落位。
 *
 * 这里**不读**光标：位置必须是稳定的输入，光标是会随手一滑就变的东西，
 * 而面板的其余部分（高度、内容）都跟着状态走——只有「哪块屏」这件事可以借光标兜底。
 */
export function resolveTrayPanelAnchor(input: ResolveTrayPanelAnchorInput): TrayPanelAnchor {
  const trayIsUsable = isUsableRectangle(input.trayBounds)
  const anchored = input.displayAt(trayIsUsable ? { x: input.trayBounds.x, y: input.trayBounds.y } : input.cursor)
  const workArea = isUsableRectangle(anchored.workArea) ? anchored.workArea : input.primaryDisplay().workArea

  // 图标矩形不可用时不能拿它去算水平中点：宽度为 0 会让面板落在工作区最左边而不是图标下。
  // 此时退回工作区水平居中，至少保证面板整块都在用户正看着的那块屏上；纵向则按平台
  // 摆在「菜单栏下方 / 任务栏上方」——和图标可用时面板出现的方向一致。
  const fallbackY = input.platform === 'darwin'
    ? workArea.y - PANEL_GAP
    : workArea.y + workArea.height + PANEL_GAP
  const trayBounds = trayIsUsable
    ? input.trayBounds
    : { x: workArea.x + Math.round((workArea.width - PANEL_WIDTH) / 2), y: fallbackY, width: PANEL_WIDTH, height: 0 }

  return { trayBounds, workArea }
}

export interface TrayPanelActions {
  openMainWindow: () => Promise<void>
  quit: () => void
}

export class TrayPanelManager {
  private panel: BrowserWindow | null = null
  private initialized = false
  private removeResizeListener: (() => void) | null = null
  private removeDisplayMetricsListener: (() => void) | null = null
  private lastBlurTime = 0
  private panelHeight = PANEL_INITIAL_HEIGHT

  constructor(private readonly tray: Tray, private readonly actions: TrayPanelActions) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true
    ipcMain.handle('tray-panel:open-main-window', () => this.actions.openMainWindow())
    ipcMain.on('tray-panel:quit', () => this.actions.quit())
    const onResize = (event: Electron.IpcMainEvent, requestedHeight: unknown) => {
      if (!this.panel || this.panel.isDestroyed() || event.sender !== this.panel.webContents) return
      if (typeof requestedHeight !== 'number' || !Number.isFinite(requestedHeight)) return
      const maxHeight = this.maxPanelHeight()
      const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight)
      const height = Math.max(minHeight, Math.min(maxHeight, Math.ceil(requestedHeight)))
      if (height === this.panelHeight && this.panel.getContentSize()[1] === height) return
      this.panelHeight = height
      this.setPanelBounds(this.panel, height)
    }
    ipcMain.on('tray-panel:resize', onResize)
    this.removeResizeListener = () => ipcMain.off('tray-panel:resize', onResize)

    // 插拔显示器 / 改分辨率 / 改缩放都会让已经算好的坐标失效：面板是常驻窗口，
    // 它不会因为外接屏拔掉而自己回到主屏，只会留在原来的坐标上——那块地方现在
    // 可能已经不在任何显示器里了。
    const onDisplayMetricsChanged = () => this.reanchor()
    screen.on('display-metrics-changed', onDisplayMetricsChanged)
    this.removeDisplayMetricsListener = () => screen.off('display-metrics-changed', onDisplayMetricsChanged)
  }

  destroy(): void {
    this.initialized = false
    this.removeResizeListener?.()
    this.removeResizeListener = null
    this.removeDisplayMetricsListener?.()
    this.removeDisplayMetricsListener = null
    ipcMain.removeHandler('tray-panel:open-main-window')
    ipcMain.removeAllListeners('tray-panel:quit')
    ipcMain.removeAllListeners('tray-panel:resize')
    this.panel?.destroy()
    this.panel = null
  }

  show(): void {
    const panel = this.ensurePanel()
    if (panel.isVisible()) {
      // 面板还开着，这一击就是「收起」。收起后不盖时间戳：blur 只会再 hide 一次，
      // 没有需要被屏蔽的后续事件，盖了反而会把用户紧接着的下一击一起吃掉。
      this.hide()
      return
    }
    // macOS 上「点托盘图标」可能先到达 blur 再到达 click：面板已经因为 blur 自己收起了，
    // 紧接着到来的 click 属于同一次点击，不该再打开一次（否则变成关了立刻又弹开）。
    // 这个判定只针对「紧跟失焦的那一次」，用完立刻清零——否则同一击之后的每一击都会
    // 一直落在窗口里，表现成「点不动，得点好几下」。
    if (Date.now() - this.lastBlurTime < PANEL_BLUR_TOGGLE_WINDOW) {
      this.lastBlurTime = 0
      return
    }
    // 每次打开都重新落位，而不是只在创建窗口时算一次：托盘图标会被系统搬走，
    // 显示器会换，窗口不会自己跟着动。
    this.position(panel)
    panel.show()
    panel.focus()
  }

  hide(): void {
    this.panel?.hide()
  }

  /** 显示器配置变了：把已经存在的面板重新夹回可用工作区里。 */
  private reanchor(): void {
    if (!this.panel || this.panel.isDestroyed()) return
    const height = Math.min(this.panelHeight, this.maxPanelHeight())
    this.panelHeight = height
    this.setPanelBounds(this.panel, height)
  }

  private ensurePanel(): BrowserWindow {
    if (this.panel && !this.panel.isDestroyed()) return this.panel

    const initialHeight = Math.min(PANEL_INITIAL_HEIGHT, this.maxPanelHeight())
    this.panelHeight = initialHeight
    const panel = new BrowserWindow({
      width: PANEL_WIDTH,
      height: initialHeight,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      ...(process.platform === 'win32' ? { roundedCorners: false } : {}),
      backgroundColor: '#00000000',
      webPreferences: {
        // The panel shares the console bundle but not the console's bridge: the main
        // preload would hand a floating popover the whole updater/screenshots surface.
        // See `tray-panel-preload.ts` for what is exposed instead.
        preload: preloadBundlePath,
        nodeIntegration: false,
        contextIsolation: true,
        // Keep the preload sandboxed. With `sandbox: false`, Electron resolves the
        // `.js` preload under the package's `"type": "module"` and our CJS bridge
        // fails before it can expose anything.
        sandbox: true,
      },
    })

    panel.setAlwaysOnTop(true, 'pop-up-menu')
    panel.on('blur', () => {
      // 只有「面板还开着时失焦」才是需要记时间戳的那一次：它后面会跟着同一个物理
      // 点击的 click。面板已经收起时的 blur 只是之前那一击的余波，记下来只会误伤下一击。
      if (!panel.isVisible()) return
      this.lastBlurTime = Date.now()
      this.hide()
    })
    panel.webContents.on('before-input-event', (event, input) => {
      if (input.key !== 'Escape') return
      event.preventDefault()
      this.hide()
    })
    panel.on('closed', () => {
      if (this.panel === panel) this.panel = null
    })

    // 与控制台主窗口同一套地址规则（见 `index.ts`）：开发期从 Vite dev server 取
    // `tray.html`，打包后从产物目录里读同级的那个文件。两个 HTML 入口都在 Vite 根目录下，
    // 所以这里只差一个文件名。
    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    const load = devServerUrl
      ? panel.loadURL(`${devServerUrl.replace(/\/+$/, '')}/tray.html`)
      : panel.loadFile(path.join(process.env.OUTPUT!, 'render', 'tray.html'))
    void load.catch(error => {
      console.error('[tray] failed to load panel', error)
    })

    this.panel = panel
    return panel
  }

  private position(panel: BrowserWindow): void {
    this.setPanelBounds(panel, panel.getContentSize()[1])
  }

  private setPanelBounds(panel: BrowserWindow, height: number): void {
    const { trayBounds, workArea } = this.anchor()
    const { x, y } = resolveTrayPanelPosition({ trayBounds, workArea, height, platform: process.platform })
    panel.setBounds({ x, y, width: PANEL_WIDTH, height }, false)
  }

  private anchor(): TrayPanelAnchor {
    return resolveTrayPanelAnchor({
      trayBounds: this.tray.getBounds(),
      cursor: screen.getCursorScreenPoint(),
      platform: process.platform,
      displayAt: point => screen.getDisplayNearestPoint(point),
      primaryDisplay: () => screen.getPrimaryDisplay(),
    })
  }

  private maxPanelHeight(): number {
    return Math.max(240, Math.min(PANEL_MAX_HEIGHT, this.anchor().workArea.height - PANEL_GAP * 2))
  }
}
