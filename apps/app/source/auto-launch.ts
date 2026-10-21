import { app } from 'electron'
import { getSettings, onSettingsChanged } from './server-host'
import type { Settings } from '@common/schemas'

export interface StartHiddenInput {
  platform: NodeJS.Platform
  argv: readonly string[]
  wasOpenedAtLogin: boolean
}

/**
 * 登录自启时要不要把主窗口留在隐藏状态。
 *
 * Windows / Linux 的登录项会带上 `--hidden`。macOS 13+ 的 SMAppService 不接收这组参数，
 * Electron 44 也删掉了 `wasOpenedAsHidden`；登录启动只能在 `app.ready` 之后看
 * `getLoginItemSettings().wasOpenedAtLogin`。两个信号都没有就是用户自己打开的，窗口要显示。
 */
export function shouldStartHidden(input: StartHiddenInput): boolean {
  if (input.argv.includes('--hidden')) return true
  return input.platform === 'darwin' && input.wasOpenedAtLogin
}

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
        // Windows / Linux 把 `--hidden` 写进登录项。macOS 13+ 的 SMAppService 会丢掉
        // args，隐藏与否改由启动时的 `wasOpenedAtLogin` 决定（见 `shouldStartHidden`）。
        args: ['--hidden'],
      })
      this.currentValue = enabled
      console.info(`[auto-launch] state updated enabled=${enabled}`)
    } catch (err) {
      console.error(`[auto-launch] failed to set login item enabled=${enabled}`, err)
    }
  }
}
