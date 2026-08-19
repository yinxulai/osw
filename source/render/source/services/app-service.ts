/**
 * 全局应用服务：统一管理跨页面共享数据的获取、缓存和轮询。
 *
 * 设计原则：
 * 1. 单例模式，组件通过 hooks 订阅，不直接持有状态
 * 2. 后台静默刷新不触发 loading 状态，避免骨架屏闪烁
 * 3. 轮询按引用计数启停，无组件订阅时不发请求
 * 4. 写操作后自动失效相关缓存并刷新
 */

import { appStore } from '../store/app-store'
import {
  providerApi,
  healthApi,
  logicalModelApi,
  proxyApi,
  settingsApi,
} from '../api'
import type { ApiResponse, ProxyServerStatus } from '@common/schemas'

type PollingKey = 'proxyStatus' | 'providers' | 'health' | 'logicalModels' | 'settings'

interface PollingEntry {
  intervalMs: number
  timer: ReturnType<typeof setInterval> | null
  refCount: number
}

class AppService {
  private polling = new Map<PollingKey, PollingEntry>()
  private inflight = new Set<PollingKey>()
  private loaded = new Set<PollingKey>()

  // ========== 数据获取 ==========

  async fetchProxyStatus(silent = false): Promise<void> {
    if (!silent) appStore.setState({ proxyStatusLoading: true })
    const result = await proxyApi.status()
    if (result.success) {
      appStore.setState({ proxyStatus: result.data, proxyStatusLoading: false, lastError: null })
    } else {
      appStore.setState({ proxyStatusLoading: false, lastError: result.errorMessage })
    }
  }

  async fetchProviders(silent = false): Promise<void> {
    if (!silent) appStore.setState({ providersLoading: true })
    const result = await providerApi.list()
    if (result.success) {
      appStore.setState({ providers: result.data, providersLoading: false, lastError: null })
    } else {
      appStore.setState({ providersLoading: false, lastError: result.errorMessage })
    }
  }

  async fetchHealth(silent = false): Promise<void> {
    if (!silent) appStore.setState({ healthLoading: true })
    const result = await healthApi.list()
    if (result.success) {
      const healthMap = Object.fromEntries(result.data.map(h => [h.providerId, h]))
      appStore.setState({ health: healthMap, healthLoading: false, lastError: null })
    } else {
      appStore.setState({ healthLoading: false, lastError: result.errorMessage })
    }
  }

  async fetchLogicalModels(silent = false): Promise<void> {
    if (!silent) appStore.setState({ logicalModelsLoading: true })
    const result = await logicalModelApi.list()
    if (result.success) {
      appStore.setState({ logicalModels: result.data, logicalModelsLoading: false, lastError: null })
    } else {
      appStore.setState({ logicalModelsLoading: false, lastError: result.errorMessage })
    }
  }

  async fetchSettings(silent = false): Promise<void> {
    if (!silent) appStore.setState({ settingsLoading: true })
    const result = await settingsApi.get()
    if (result.success) {
      appStore.setState({ settings: result.data, settingsLoading: false, lastError: null })
    } else {
      appStore.setState({ settingsLoading: false, lastError: result.errorMessage })
    }
  }

  // ========== 代理操作 ==========

  async startProxy(): Promise<ApiResponse<ProxyServerStatus>> {
    const result = await proxyApi.start()
    if (result.success) {
      appStore.setState({ proxyStatus: result.data })
    } else {
      appStore.setState({ lastError: result.errorMessage })
    }
    return result
  }

  async stopProxy(): Promise<ApiResponse<ProxyServerStatus>> {
    const result = await proxyApi.stop()
    if (result.success) {
      appStore.setState({ proxyStatus: result.data })
    } else {
      appStore.setState({ lastError: result.errorMessage })
    }
    return result
  }

  async restartProxy(): Promise<ApiResponse<ProxyServerStatus>> {
    const result = await proxyApi.restart()
    if (result.success) {
      appStore.setState({ proxyStatus: result.data })
    } else {
      appStore.setState({ lastError: result.errorMessage })
    }
    return result
  }

  // ========== 缓存失效 ==========

  invalidateProviders(): void {
    void this.fetchProviders(true)
  }

  invalidateHealth(): void {
    void this.fetchHealth(true)
  }

  invalidateLogicalModels(): void {
    void this.fetchLogicalModels(true)
  }

  invalidateSettings(): void {
    void this.fetchSettings(true)
  }

  // ========== 轮询管理 ==========

  private startPolling(key: PollingKey, intervalMs: number): void {
    let entry = this.polling.get(key)
    if (entry) {
      entry.refCount++
      return
    }

    entry = { intervalMs, timer: null, refCount: 1 }
    this.polling.set(key, entry)

    // 首次加载显示 loading（如果尚未加载过），后续轮询静默刷新
    const isFirstLoad = !this.loaded.has(key)
    void this.fetchByKey(key, !isFirstLoad).then(() => this.loaded.add(key))

    entry.timer = setInterval(() => {
      void this.fetchByKey(key, true)
    }, intervalMs)
  }

  private stopPolling(key: PollingKey): void {
    const entry = this.polling.get(key)
    if (!entry) return
    entry.refCount--
    if (entry.refCount > 0) return
    if (entry.timer) {
      clearInterval(entry.timer)
      entry.timer = null
    }
    this.polling.delete(key)
  }

  private async fetchByKey(key: PollingKey, silent: boolean): Promise<void> {
    if (this.inflight.has(key)) return
    this.inflight.add(key)
    try {
      switch (key) {
        case 'proxyStatus': await this.fetchProxyStatus(silent); break
        case 'providers': await this.fetchProviders(silent); break
        case 'health': await this.fetchHealth(silent); break
        case 'logicalModels': await this.fetchLogicalModels(silent); break
        case 'settings': await this.fetchSettings(silent); break
      }
    } finally {
      this.inflight.delete(key)
    }
  }

  // 命令式订阅（供 hook 使用）
  subscribePolling(key: PollingKey, intervalMs: number): () => void {
    this.startPolling(key, intervalMs)
    return () => this.stopPolling(key)
  }
}

export const appService = new AppService()
export type { PollingKey }
