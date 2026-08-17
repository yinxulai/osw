import { app } from 'electron'
import { getSettings, onSettingsChanged } from '@server/index'
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
        openAsHidden: true, // 开机时隐藏启动，只显示托盘
      })
      this.currentValue = enabled
      console.log(`[auto-launch] ${enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      console.error('[auto-launch] failed to set login item', err)
    }
  }
}
