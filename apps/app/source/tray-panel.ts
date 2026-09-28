import { BrowserWindow, ipcMain, nativeTheme, screen, type Tray } from 'electron'
import path from 'node:path'
import type { TrayLogicalModelSummary, TrayPanelState, TrayPanelTheme } from '@common/tray-panel'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import trayPanelHtml from './tray-panel.html?raw'
import iconPng from '../build/icon.png?url'
import { nativeLocale, nativeTranslator, onNativeLocaleChanged } from './i18n'
import type { TrayProxySnapshot } from './tray-menu'

// 窗口比内容卡片多一圈透明留白，CSS 阴影不再被窗口边界裁断。宽度按
// `PANEL_PADDING` 反推，卡片本体宽度仍保持原来的 366px。
const PANEL_WIDTH = 422
const PANEL_MIN_HEIGHT = 380
const PANEL_MAX_HEIGHT = 680
const PANEL_INITIAL_HEIGHT = 560
const PANEL_GAP = 8
const PANEL_PADDING = 28

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
  getSnapshot: () => TrayProxySnapshot
  getLogicalModels: () => Promise<TrayLogicalModelSummary[]>
  toggleProxy: () => Promise<void>
  openMainWindow: () => Promise<void>
  quit: () => void
}

function currentTheme(): TrayPanelTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function buildTrayPanelState(snapshot: TrayProxySnapshot, theme: TrayPanelTheme, logicalModels: TrayLogicalModelSummary[] = []): TrayPanelState {
  const t = nativeTranslator()
  return {
    running: snapshot.running,
    theme,
    locale: nativeLocale(),
    iconUrl: iconPng,
    labels: {
      subtitle: t('native.tray.panel.subtitle'),
      running: t('native.tray.panel.running'),
      stopped: t('native.tray.panel.stopped'),
      openApp: t('native.tray.openWindow'),
      footnote: t('native.tray.panel.footnote'),
      startProxy: t('native.tray.panel.startProxy'),
      stopProxy: t('native.tray.panel.stopProxy'),
      quit: t('native.tray.quit'),
      opening: t('native.tray.panel.opening'),
      actionFailed: t('native.tray.panel.actionFailed'),
      logicalModels: t('native.tray.panel.logicalModels'),
      logicalModelsCount: t('native.tray.panel.logicalModelsCount', { count: logicalModels.length }),
      logicalModelsEmpty: t('native.tray.panel.logicalModelsEmpty'),
      logicalModelsEmptyHint: t('native.tray.panel.logicalModelsEmptyHint'),
      logicalModelTabs: t('native.tray.panel.logicalModelTabs'),
      modelConversion: t('native.tray.panel.modelConversion'),
      providerModelsEmpty: t('logicalModels.card.empty.title'),
      providerModelsEmptyHint: t('logicalModels.card.empty.description'),
      modelStandby: t('logicalModels.row.standby'),
      modelCooling: t('logicalModels.row.cooling'),
      modelBindingDisabled: t('common.state.disabled'),
      modelDisabled: t('logicalModels.row.modelDisabled'),
      unknownProvider: t('logicalModels.row.unknownProvider'),
    },
    protocolNames: PROTOCOL_DISPLAY_NAMES,
    logicalModels: logicalModels.map(model => ({
      id: model.id,
      name: model.name,
      models: model.models.map(({ avgTps, avgTtftMilliseconds, ...item }) => ({
        ...item,
        tps: formatOutputSpeed(avgTps),
        ttft: formatMilliseconds(avgTtftMilliseconds),
      })),
    })),
  }
}

export function createTrayPanelPath(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(trayPanelHtml)}`
}

export class TrayPanelManager {
  private panel: BrowserWindow | null = null
  private initialized = false
  private unsubscribeLocale: (() => void) | null = null
  private unsubscribeTheme: (() => void) | null = null
  private removeThemeListener: (() => void) | null = null
  private removeResizeListener: (() => void) | null = null
  private rendererTheme: TrayPanelTheme | null = null
  private rendererThemeReceived = false
  private lastBlurTime = 0
  private stateRequest = 0
  private panelHeight = PANEL_INITIAL_HEIGHT

  constructor(private readonly tray: Tray, private readonly actions: TrayPanelActions) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true
    ipcMain.handle('tray-panel:get-state', () => this.state())
    ipcMain.handle('tray-panel:toggle', async () => {
      await this.actions.toggleProxy()
      return this.state()
    })
    ipcMain.handle('tray-panel:open-main-window', () => this.actions.openMainWindow())
    ipcMain.handle('tray-panel:quit', () => this.actions.quit())
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
    const onThemeChanged = (_event: Electron.IpcMainEvent, theme: unknown) => {
      if (theme !== 'light' && theme !== 'dark') return
      this.rendererThemeReceived = true
      this.rendererTheme = theme
      this.refresh()
    }
    ipcMain.on('appearance:set-theme', onThemeChanged)
    this.removeThemeListener = () => ipcMain.off('appearance:set-theme', onThemeChanged)

    this.unsubscribeLocale = onNativeLocaleChanged(() => this.refresh())
    this.unsubscribeTheme = (() => {
      const listener = () => {
        if (!this.rendererThemeReceived) this.refresh()
      }
      nativeTheme.on('updated', listener)
      return () => nativeTheme.off('updated', listener)
    })()
  }

  destroy(): void {
    this.initialized = false
    this.unsubscribeLocale?.()
    this.unsubscribeLocale = null
    this.unsubscribeTheme?.()
    this.unsubscribeTheme = null
    this.removeResizeListener?.()
    this.removeResizeListener = null
    this.removeThemeListener?.()
    this.removeThemeListener = null
    ipcMain.removeHandler('tray-panel:get-state')
    ipcMain.removeHandler('tray-panel:toggle')
    ipcMain.removeHandler('tray-panel:open-main-window')
    ipcMain.removeHandler('tray-panel:quit')
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
    this.refresh()
  }

  hide(): void {
    this.panel?.hide()
  }

  refresh(): void {
    if (!this.panel || this.panel.isDestroyed()) return
    const request = ++this.stateRequest
    void this.state().then(next => {
      if (request !== this.stateRequest || !this.panel || this.panel.isDestroyed()) return
      this.panel.webContents.send('tray-panel:state-changed', next)
    }).catch(error => {
      console.warn('[tray] failed to refresh panel state', error)
    })
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
        // The panel is a main-process-controlled data URL with no Node access and a
        // deliberately tiny IPC surface (see `tray-panel-preload.ts`). Loading the
        // main preload here would hand the page the whole updater/runtime bridge.
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
    panel.webContents.on('did-finish-load', () => this.refresh())
    void panel.loadURL(createTrayPanelPath()).catch(error => {
      console.error('[tray] failed to load panel', error)
    })
    this.panel = panel
    return panel
  }

  private async state(): Promise<TrayPanelState> {
    let logicalModels: TrayLogicalModelSummary[] = []
    try {
      logicalModels = await this.actions.getLogicalModels()
    } catch (error) {
      console.warn('[tray] failed to load logical models', error)
    }
    return buildTrayPanelState(this.actions.getSnapshot(), this.rendererTheme ?? currentTheme(), logicalModels)
  }

  private position(panel: BrowserWindow): void {
    const height = panel.getContentSize()[1]
    this.setPanelBounds(panel, height)
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
