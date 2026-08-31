import { getSettings, onSettingsChanged } from '@server/database/settings-store'
import { listFreeModelSources } from './registry'
import { findManagedProvider, getSourceSyncState, syncFreeModelSource } from './sync-engine'

const TICK_INTERVAL_MS = 30 * 60 * 1000
const STARTUP_DELAY_MS = 10 * 1000

/**
 * 免费模型源后台同步调度器。
 *
 * 通用：遍历所有已注册源，对已启用（存在托管 provider）的源，
 * 若距上次成功同步超过配置间隔，则自动同步一次。
 * 单个源失败不影响其他源。
 */
export class FreeModelSyncScheduler {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private running = false

  start(): void {
    if (this.timer) return
    this.running = true
    this.startupTimer = setTimeout(() => { void this.tick('startup') }, STARTUP_DELAY_MS)
    this.timer = setInterval(() => { void this.tick('interval') }, TICK_INTERVAL_MS)
    // 设置变化时立即重新评估（例如打开开关或缩短间隔）
    onSettingsChanged(() => { void this.tick('settings-change') })
    console.info('[free-models] sync scheduler started')
  }

  stop(): void {
    this.running = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null }
    console.info('[free-models] sync scheduler stopped')
  }

  private async tick(reason: string): Promise<void> {
    if (!this.running) return
    const settings = await getSettings().catch(() => null)
    if (!settings || !settings.freeModelAutoSyncEnabled) return

    const intervalMs = settings.freeModelSyncIntervalHours * 60 * 60 * 1000
    const now = Date.now()

    for (const source of listFreeModelSources()) {
      try {
        const managed = await findManagedProvider(source.key)
        if (!managed) continue
        const state = await getSourceSyncState(managed.id)
        // 从未同步过，或距上次同步已超过间隔，则同步
        if (state && state.status === 'success' && now - state.time < intervalMs) continue
        console.info(`[free-models] auto sync triggered source=${source.key} reason=${reason}`)
        await syncFreeModelSource(source.key)
      } catch (error) {
        console.error(`[free-models] auto sync failed source=${source.key}`, error instanceof Error ? error.message : error)
      }
    }
  }
}

export const freeModelSyncScheduler = new FreeModelSyncScheduler()
