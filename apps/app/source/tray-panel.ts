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
import { TRAY_PANEL_GUTTER } from '@common/tray-panel'

// 窗口比内容卡片多一圈透明留白，CSS 阴影不再被窗口边界裁断。宽度按
// `TRAY_PANEL_GUTTER` 反推，卡片本体宽度仍保持原来的 366px。
const PANEL_WIDTH = 422
const PANEL_MIN_HEIGHT = 380
const PANEL_MAX_HEIGHT = 680
const PANEL_INITIAL_HEIGHT = 560
const PANEL_GAP = 8
// 与渲染层共用的那个常量：留白两边都有份，谁都不能只改自己这一侧。
const PANEL_PADDING = TRAY_PANEL_GUTTER

interface TrayPanelRectangle {
  x: number
  y: number
  width: number
  height: number
}

interface ResolveTrayPanelPositionInput {
  trayBounds: TrayPanelRectangle
  workArea: TrayPanelRectangle
  height: number
  platform: NodeJS.Platform
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

export interface TrayPanelActions {
  openMainWindow: () => Promise<void>
  quit: () => void
}

export class TrayPanelManager {
  private panel: BrowserWindow | null = null
  private initialized = false
  private removeResizeListener: (() => void) | null = null
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
  }

  destroy(): void {
    this.initialized = false
    this.removeResizeListener?.()
    this.removeResizeListener = null
    ipcMain.removeHandler('tray-panel:open-main-window')
    ipcMain.removeAllListeners('tray-panel:quit')
    ipcMain.removeAllListeners('tray-panel:resize')
    this.panel?.destroy()
    this.panel = null
  }

  show(): void {
    // Clicking the tray icon while the panel is focused arrives after `blur` on
    // macOS. A tiny guard treats that same physical click as a close instead of a
    // close-then-reopen flicker. The panel is shown again on the next click.
    if (this.panel?.isVisible()) {
      this.hide()
      this.lastBlurTime = Date.now()
      return
    }
    if (this.panel?.isVisible() === false && Date.now() - this.lastBlurTime < 160) return
    const panel = this.ensurePanel()
    this.position(panel)
    panel.show()
    panel.focus()
  }

  hide(): void {
    this.panel?.hide()
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
        preload: path.join(import.meta.dirname, 'tray-panel-preload.js'),
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
      this.lastBlurTime = Date.now()
      panel.hide()
    })
    panel.webContents.on('before-input-event', (event, input) => {
      if (input.key !== 'Escape') return
      event.preventDefault()
      panel.hide()
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
    const trayBounds = this.tray.getBounds()
    const workArea = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea
    const { x, y } = resolveTrayPanelPosition({ trayBounds, workArea, height, platform: process.platform })
    panel.setBounds({ x, y, width: PANEL_WIDTH, height }, false)
  }

  private maxPanelHeight(): number {
    const trayBounds = this.tray.getBounds()
    const workArea = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea
    return Math.max(240, Math.min(PANEL_MAX_HEIGHT, workArea.height - PANEL_GAP * 2))
  }
}
