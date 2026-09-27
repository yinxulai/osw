import { BrowserWindow, clipboard, ipcMain, nativeTheme, screen, type Tray } from 'electron'
import path from 'node:path'
import type { TrayPanelState, TrayPanelTheme } from '@common/tray-panel'
import trayPanelHtml from './tray-panel.html?raw'
import iconPng from '../build/icon.png?url'
import { nativeLocale, nativeTranslator, onNativeLocaleChanged } from './i18n'
import { resolveProxyOrigin } from '@common/proxy-origin'
import { TRAY_ENDPOINTS, type TrayProxySnapshot } from './tray-menu'

const PANEL_WIDTH = 382
const PANEL_HEIGHT = 444
const PANEL_GAP = 8

export interface TrayPanelActions {
  getSnapshot: () => TrayProxySnapshot
  toggleProxy: () => Promise<void>
  openMainWindow: () => Promise<void>
  quit: () => void
}

function currentTheme(): TrayPanelTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function buildTrayPanelState(snapshot: TrayProxySnapshot, theme: TrayPanelTheme): TrayPanelState {
  const t = nativeTranslator()
  const origin = resolveProxyOrigin(snapshot.host, snapshot.port)
  return {
    running: snapshot.running,
    address: origin === null ? '—' : origin.replace(/^https?:\/\//, ''),
    theme,
    locale: nativeLocale(),
    iconUrl: iconPng,
    labels: {
      subtitle: t('native.tray.panel.subtitle'),
      running: t('native.tray.panel.running'),
      stopped: t('native.tray.panel.stopped'),
      listeningAddress: t('native.tray.panel.listeningAddress'),
      ready: t('native.tray.panel.ready'),
      unavailable: t('native.tray.panel.unavailable'),
      quickCopy: t('native.tray.panel.quickCopy'),
      baseUrl: t('native.tray.panel.baseUrl'),
      openApp: t('native.tray.openWindow'),
      footnote: t('native.tray.panel.footnote'),
      copied: t('native.tray.copyEndpointDone'),
      startProxy: t('native.tray.panel.startProxy'),
      stopProxy: t('native.tray.panel.stopProxy'),
      quit: t('native.tray.quit'),
      opening: t('native.tray.panel.opening'),
      actionFailed: t('native.tray.panel.actionFailed'),
    },
    endpoints: origin === null
      ? []
      : TRAY_ENDPOINTS.map(endpoint => ({
          id: endpoint.id,
          label: endpoint.label,
          url: `${origin}${endpoint.path}`,
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
  private rendererTheme: TrayPanelTheme | null = null
  private rendererThemeReceived = false
  private lastBlurTime = 0

  constructor(private readonly tray: Tray, private readonly actions: TrayPanelActions) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true
    ipcMain.handle('tray-panel:get-state', () => this.state())
    ipcMain.handle('tray-panel:toggle', async () => {
      await this.actions.toggleProxy()
      return this.state()
    })
    ipcMain.handle('tray-panel:copy', (_event, endpoint: unknown) => {
      if (endpoint !== 'openai' && endpoint !== 'anthropic') return
      const resolved = this.state().endpoints.find(item => item.id === endpoint)
      if (!resolved) return
      clipboard.writeText(resolved.url)
      console.info(`[tray] endpoint copied id=${endpoint}`)
    })
    ipcMain.handle('tray-panel:open-main-window', () => this.actions.openMainWindow())
    ipcMain.handle('tray-panel:quit', () => this.actions.quit())
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
    this.removeThemeListener?.()
    this.removeThemeListener = null
    ipcMain.removeHandler('tray-panel:get-state')
    ipcMain.removeHandler('tray-panel:toggle')
    ipcMain.removeHandler('tray-panel:copy')
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
    this.panel.webContents.send('tray-panel:state-changed', this.state())
  }

  private ensurePanel(): BrowserWindow {
    if (this.panel && !this.panel.isDestroyed()) return this.panel

    const panel = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
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

  private state(): TrayPanelState {
    return buildTrayPanelState(this.actions.getSnapshot(), this.rendererTheme ?? currentTheme())
  }

  private position(panel: BrowserWindow): void {
    const bounds = this.tray.getBounds()
    const targetX = Math.round(bounds.x + bounds.width / 2 - PANEL_WIDTH / 2)
    const targetY = process.platform === 'darwin'
      ? Math.round(bounds.y + bounds.height + PANEL_GAP)
      : Math.round(bounds.y - PANEL_HEIGHT - PANEL_GAP)

    // Keep the panel on the display that holds the tray icon by clamping the final
    // position there rather than by centering it on the window's current display.
    const workArea = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
    const x = Math.min(Math.max(targetX, workArea.x + PANEL_GAP), workArea.x + workArea.width - PANEL_WIDTH - PANEL_GAP)
    const y = Math.min(Math.max(targetY, workArea.y + PANEL_GAP), workArea.y + workArea.height - PANEL_HEIGHT - PANEL_GAP)
    panel.setPosition(x, y, false)
  }
}
