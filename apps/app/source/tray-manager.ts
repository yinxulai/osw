import { app, Tray, Menu, BrowserWindow, clipboard } from 'electron'
import { generateTrayIcon } from './tray-icon'
import { buildTrayMenuTemplate, type TrayProxySnapshot } from './tray-menu'
import { nativeTranslator, onNativeLocaleChanged } from './i18n'
import {
  getProxyServerStatus,
  startProxyServer,
  stopProxyServer,
} from './server-host'

/**
 * 「已复制」的回执只能借用 tooltip：菜单项点完就关，没有别的地方能显示反馈。
 * 时长与引导页复制按钮（`CopyButton`）保持一致。
 */
const COPY_FEEDBACK_MS = 1500

/** 只有 running/host/port 三个字段会影响菜单内容，用它挡掉无意义的重建。 */
function snapshotSignature(snapshot: TrayProxySnapshot): string {
  return `${snapshot.running}|${snapshot.host ?? ''}|${snapshot.port ?? ''}`
}

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private snapshot: TrayProxySnapshot = { running: false, host: null, port: null }
  /** 当前菜单渲染自哪份快照；`null` 表示还没渲染过（首次读状态后必定渲染一次）。 */
  private renderedSignature: string | null = null
  private statusPoller: NodeJS.Timeout | null = null
  private copyFeedbackTimer: NodeJS.Timeout | null = null
  private isQuitting = false
  private statusReadFailed = false
  private unsubscribeLocale: (() => void) | null = null

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    console.info('[tray] initialization started')

    // 创建初始托盘图标。状态读出来之前 tooltip 只放应用名：
    // 宁可空着，也不要先报一个还没读到的「已停止」。
    const icon = generateTrayIcon()
    this.tray = new Tray(icon)
    this.tray.setToolTip(nativeTranslator()('app.windowTitle'))

    // 菜单由首次状态读取渲染，不在 `init` 里先铺一份占位菜单——
    // 否则「已停止 / 启动代理服务」会先闪一下再翻成真实状态。
    // 这个窗口只有一次数据库读取的时间。
    void this.startStatusPolling()

    // 语言变了要重建菜单：菜单文案是构建期快照，不会自己跟着走。
    this.unsubscribeLocale = onNativeLocaleChanged(() => {
      this.refreshTooltip()
      this.renderMenu()
    })

    // macOS 会直接展示关联菜单；其他平台也允许左键打开菜单。
    if (process.platform !== 'darwin') {
      this.tray.on('click', () => {
        this.tray?.popUpContextMenu()
      })
    }

    // 窗口关闭时隐藏到托盘
    mainWindow.on('close', (event) => {
      // 如果不是退出应用，只是关闭窗口，则隐藏到托盘
      if (!this.isQuitting) {
        event.preventDefault()
        this.hideWindow()
      }
    })
    console.info('[tray] initialization completed')
  }

  destroy(): void {
    this.unsubscribeLocale?.()
    this.unsubscribeLocale = null
    if (this.statusPoller) {
      clearInterval(this.statusPoller)
      this.statusPoller = null
    }
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer)
      this.copyFeedbackTimer = null
    }
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
    console.info('[tray] destroyed')
  }

  /**
   * 标记即将退出，防止窗口关闭时被拦截到托盘
   */
  prepareForQuit(): void {
    this.isQuitting = true
  }

  /**
   * 按快照渲染菜单。
   *
   * 菜单内容是纯函数算出来的（见 `tray-menu.ts`），这里只负责把它挂到托盘上。
   */
  private renderMenu(): void {
    if (!this.tray) return

    const template = buildTrayMenuTemplate({
      snapshot: this.snapshot,
      t: nativeTranslator(),
      platform: process.platform,
      actions: {
        copyEndpoint: endpoint => this.copyEndpoint(endpoint),
        toggleProxy: () => {
          void this.toggleProxy()
        },
        openWindow: () => {
          void this.showWindow()
        },
        quit: () => this.quitApp(),
      },
    })

    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  private copyEndpoint(endpoint: string): void {
    if (!this.tray) return

    clipboard.writeText(endpoint)
    console.info(`[tray] endpoint copied endpoint=${endpoint}`)
    this.tray.setToolTip(nativeTranslator()('native.tray.copyEndpointDone'))

    if (this.copyFeedbackTimer) clearTimeout(this.copyFeedbackTimer)
    this.copyFeedbackTimer = setTimeout(() => {
      this.copyFeedbackTimer = null
      this.refreshTooltip()
    }, COPY_FEEDBACK_MS)
  }

  /**
   * 状态一次都没读到过时的兜底菜单。
   *
   * 宁可只给「打开主界面 / 退出」两条永远成立的操作，也不编造一个状态行：
   * 否则一旦读状态持续失败，托盘就成了死路——窗口关掉后用户连退都退不掉。
   */
  private renderFallbackMenu(): void {
    if (!this.tray) return
    const t = nativeTranslator()
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: t('native.tray.openWindow'),
        click: () => {
          void this.showWindow()
        },
      },
      { type: 'separator' },
      {
        label: t('native.tray.quit'),
        click: () => this.quitApp(),
      },
    ]))
  }

  private async toggleProxy(): Promise<void> {
    try {
      const status = await getProxyServerStatus()
      if (status.running) {
        await stopProxyServer()
      } else {
        await startProxyServer()
      }
      await this.refreshStatus()
    } catch (error) {
      console.error('[tray] toggle proxy failed', error)
    }
  }

  async showWindow(): Promise<void> {
    if (!this.mainWindow) return

    if (process.platform === 'darwin') {
      try {
        await app.dock?.show()
      } catch (error) {
        console.error('[tray] failed to show Dock icon', error)
      }
    }
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  private hideWindow(): void {
    if (!this.mainWindow) return

    this.mainWindow.hide()
    if (process.platform === 'darwin') {
      app.dock?.hide()
    }
  }

  private quitApp(): void {
    // 设置标志让窗口关闭事件知道是真的要退出
    this.isQuitting = true
    app.quit()
  }

  private async startStatusPolling(): Promise<void> {
    // 每 2 秒检查一次状态
    this.statusPoller = setInterval(() => {
      void this.refreshStatus()
    }, 2000)

    // 立即刷新一次
    await this.refreshStatus()
  }

  private async refreshStatus(): Promise<void> {
    if (!this.tray) return

    try {
      const status = await getProxyServerStatus()
      if (this.statusReadFailed) {
        this.statusReadFailed = false
        console.info('[tray] proxy status polling recovered')
      }

      const next: TrayProxySnapshot = { running: status.running, host: status.host, port: status.port }
      const signature = snapshotSignature(next)
      // 只在状态真变了才重建菜单：托盘菜单是常驻的，每 2 秒重建一次只会白费功夫，
      // 菜单正开着的时候还会把它顶掉。
      if (signature === this.renderedSignature) return

      console.info(`[tray] proxy status changed running=${next.running} host=${next.host} port=${next.port}`)
      this.snapshot = next
      this.renderedSignature = signature
      this.refreshTooltip()
      this.renderMenu()
    } catch (error) {
      if (!this.statusReadFailed) {
        this.statusReadFailed = true
        console.warn('[tray] proxy status polling failed; repeated failures will be suppressed', error)
      }
      // 读失败时保留上一份快照：菜单继续显示最后一次读到的真实状态。
      // 但若一次都没读到过，就连状态行也没有，只挂兜底菜单。
      if (this.renderedSignature === null) this.renderFallbackMenu()
    }
  }

  /** tooltip 只读快照，状态变化或语言切换时都能直接重算。 */
  private refreshTooltip(): void {
    if (!this.tray) return
    const t = nativeTranslator()
    const status = this.snapshot.running
      ? t('native.tray.status.running', { port: this.snapshot.port ?? 0 })
      : t('native.tray.status.stopped')
    this.tray.setToolTip(`${t('app.windowTitle')} · ${status}`)
  }
}
