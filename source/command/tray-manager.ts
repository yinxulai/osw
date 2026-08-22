import { app, Tray, Menu, BrowserWindow } from 'electron'
import { generateTrayIcon, type TrayIconStatus } from './tray-icon'
import {
  getProxyServerStatus,
  startProxyServer,
  stopProxyServer,
} from '@server/proxy/server'
import type { ProxyServerStatus } from '@common/schemas'

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private status: TrayIconStatus | null = null
  private statusPort: number | null = null
  private statusPoller: NodeJS.Timeout | null = null
  private isQuitting = false

  constructor() {}

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    // 创建初始托盘图标
    const icon = generateTrayIcon('stopped')
    this.tray = new Tray(icon)
    this.tray.setToolTip('One Switch')

    // 初始菜单
    void this.updateMenu()

    // macOS 会直接展示关联菜单；其他平台也允许左键打开菜单。
    if (process.platform !== 'darwin') {
      this.tray.on('click', () => {
        this.tray?.popUpContextMenu()
      })
    }

    // 轮询代理状态更新图标
    this.startStatusPolling()

    // 窗口关闭时隐藏到托盘
    mainWindow.on('close', (event) => {
      // 如果不是退出应用，只是关闭窗口，则隐藏到托盘
      if (!this.isQuitting) {
        event.preventDefault()
        this.hideWindow()
      }
    })
  }

  destroy(): void {
    if (this.statusPoller) {
      clearInterval(this.statusPoller)
      this.statusPoller = null
    }
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  /**
   * 标记即将退出，防止窗口关闭时被拦截到托盘
   */
  prepareForQuit(): void {
    this.isQuitting = true
  }

  private async updateMenu(): Promise<void> {
    if (!this.tray) return

    let proxyStatus: ProxyServerStatus | null = null
    try {
      proxyStatus = await getProxyServerStatus()
    } catch {
      proxyStatus = null
    }

    const isRunning = proxyStatus?.running ?? false
    const port = proxyStatus?.port ?? 0

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: isRunning ? `代理服务运行中 · 端口 ${port}` : '代理服务已停止',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '打开主界面',
        click: () => {
          void this.showWindow()
        },
      },
      {
        label: isRunning ? '停止代理服务' : '启动代理服务',
        click: () => {
          void this.toggleProxy()
        },
      },
      { type: 'separator' },
      {
        label: '退出 One Switch',
        click: () => {
          this.quitApp()
        },
      },
    ]

    const menu = Menu.buildFromTemplate(template)
    this.tray.setContextMenu(menu)
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

  private startStatusPolling(): void {
    // 每 2 秒检查一次状态
    this.statusPoller = setInterval(() => {
      void this.refreshStatus()
    }, 2000)

    // 立即刷新一次
    void this.refreshStatus()
  }

  private async refreshStatus(): Promise<void> {
    if (!this.tray) return

    try {
      const status = await getProxyServerStatus()
      const newStatus: TrayIconStatus = status.running ? 'running' : 'stopped'

      if (newStatus !== this.status || status.port !== this.statusPort) {
        this.status = newStatus
        this.statusPort = status.port
        const icon = generateTrayIcon(newStatus)
        this.tray.setImage(icon)
        this.tray.setToolTip(
          status.running
            ? `One Switch · 代理运行中 (端口 ${status.port})`
            : 'One Switch · 代理已停止',
        )
        await this.updateMenu()
      }
    } catch {
      // 忽略错误
    }
  }
}
