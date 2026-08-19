/**
 * 全局应用状态 hooks。
 * 组件通过这些 hooks 订阅全局 store 的切片，仅当切片变化时重渲染。
 */

import { useEffect } from 'react'
import { appStore } from '../store/app-store'
import { useStoreSelector } from '../store/create-store'
import { appService, type PollingKey } from './app-service'

// ========== 轮询 hook ==========

/**
 * 在组件挂载期间启动指定数据的轮询，卸载时自动停止。
 * 多个组件同时订阅同一 key 时共享同一个轮询定时器（引用计数）。
 */
export function useAppPolling(key: PollingKey, intervalMs: number): void {
  useEffect(() => {
    const unsubscribe = appService.subscribePolling(key, intervalMs)
    return unsubscribe
  }, [key, intervalMs])
}

// ========== 状态选择器 hooks ==========

export function useProxyStatus() {
  return useStoreSelector(appStore, s => s.proxyStatus)
}

export function useProxyStatusLoading() {
  return useStoreSelector(appStore, s => s.proxyStatusLoading)
}

export function useProviders() {
  return useStoreSelector(appStore, s => s.providers)
}

export function useProvidersLoading() {
  return useStoreSelector(appStore, s => s.providersLoading)
}

export function useHealth() {
  return useStoreSelector(appStore, s => s.health)
}

export function useHealthLoading() {
  return useStoreSelector(appStore, s => s.healthLoading)
}

export function useLogicalModels() {
  return useStoreSelector(appStore, s => s.logicalModels)
}

export function useLogicalModelsLoading() {
  return useStoreSelector(appStore, s => s.logicalModelsLoading)
}

export function useSettings() {
  return useStoreSelector(appStore, s => s.settings)
}

export function useSettingsLoading() {
  return useStoreSelector(appStore, s => s.settingsLoading)
}

export function useAppError() {
  return useStoreSelector(appStore, s => s.lastError)
}

// ========== 操作 hooks ==========

export function useAppActions() {
  return appService
}
