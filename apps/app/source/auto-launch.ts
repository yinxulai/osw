import { app } from 'electron'
import { getSettings, onSettingsChanged } from './server-host'
import type { Settings } from '@common/schemas'

/**
 * 开机自启管理器
 * 同步设置中的 autoLaunch 到系统登录项
 */
export class AutoLaunchManager {
  private currentValue = false

  async init(): Promise<void> {
    // 读取当前设置并应用
    try {
      const settings = await getSettings()
      this.apply(settings.autoLaunch)
    } catch (err) {
      console.error('[auto-launch] failed to read settings', err)
    }

    // 监听设置变更
    onSettingsChanged((settings: Settings) => {
      if (settings.autoLaunch !== this.currentValue) {
        this.apply(settings.autoLaunch)
      }
    })
  }

  private apply(enabled: boolean): void {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        // Windows / Linux 通过启动参数控制静默启动；新版本 Electron 的类型里不再声明
        // `openAsHidden`，而主进程读取 `--hidden` 仍然是正确的实现方式。
        args: ['--hidden'],
      })
      this.currentValue = enabled
      console.info(`[auto-launch] state updated enabled=${enabled}`)
    } catch (err) {
      console.error(`[auto-launch] failed to set login item enabled=${enabled}`, err)
    }
  }
}
