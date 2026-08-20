import { useCallback, useEffect, useRef, useState } from 'react'
import { settingsApi, configApi, requestLogApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import { useAsyncFn } from '@/services/use-async'
import {
  useSettings,
  useSettingsLoading,
  useProxyStatus,
  useAppPolling,
  useAppActions,
} from '@/services/app-hooks'
import type { Settings } from '@common/schemas'

export function useRuntimeSettingsService() {
  const toast = useToast()
  const appActions = useAppActions()
  const globalSettings = useSettings()
  const proxyStatus = useProxyStatus()
  const settingsLoading = useSettingsLoading()

  // 本地编辑副本
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const initializedRef = useRef(false)

  useAppPolling('settings', 15000)

  // 全局 settings 首次加载后同步到本地编辑副本
  useEffect(() => {
    if (initializedRef.current) return
    if (settingsLoading || !globalSettings) return
    initializedRef.current = true
    setSettings(globalSettings)
    setLoading(false)
  }, [settingsLoading, globalSettings])

  const updateField = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : null)
  }, [])

  const saveSettings = useCallback(async () => {
    if (!settings) return
    const previousListenHost = proxyStatus?.host ?? settings.listenHost
    const previousListenPort = proxyStatus?.port ?? settings.listenPort
    setSaved(false)
    const updateResult = await settingsApi.update({
      listenHost: settings.listenHost,
      listenPort: settings.listenPort,
      logRetentionCount: settings.logRetentionCount,
      logRetentionDays: settings.logRetentionDays,
      captureRequestContent: settings.captureRequestContent,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
      autoLaunch: settings.autoLaunch,
    })
    if (!updateResult.success) {
      toast.error(updateResult.errorMessage)
      return
    }
    // 代理相关配置变更才重启代理
    const needsRestart =
      previousListenHost !== updateResult.data.listenHost ||
      previousListenPort !== updateResult.data.listenPort
    if (needsRestart) {
      const restartResult = await appActions.restartProxy()
      if (!restartResult.success) {
        toast.error(`设置已保存，但代理重启失败：${restartResult.errorMessage}`)
        return
      }
    }
    setSettings(updateResult.data)
    appActions.invalidateSettings()
    setSaved(true)
    toast.success('设置已保存')
    window.setTimeout(() => setSaved(false), 2000)
  }, [proxyStatus, settings, appActions, toast])

  const { loading: saving, run: runSaveSettings } = useAsyncFn(saveSettings)

  const pruneLogs = useCallback(async (retentionDays: number): Promise<number | null> => {
    const result = await requestLogApi.prune(retentionDays)
    if (!result.success) {
      toast.error(`清理日志失败：${result.errorMessage}`)
      return null
    }
    toast.success(`已清理 ${result.data.deleted} 条请求日志`)
    return result.data.deleted
  }, [toast])

  // ========== 配置导入导出 ==========

  const exportConfig = useCallback(async () => {
    const result = await configApi.export()
    if (!result.success) {
      toast.error(`导出失败：${result.errorMessage}`)
      return
    }
    const blob = new Blob([result.data.content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `one-switch-config-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('配置已导出')
  }, [toast])

  const reload = useCallback(async () => {
    appActions.invalidateSettings()
    appActions.invalidateProviders()
    appActions.invalidateLogicalModels()
  }, [appActions])

  const importConfig = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const config = JSON.parse(text)
      const result = await configApi.import(config, 'merge')
      if (!result.success) {
        toast.error(`导入失败：${result.errorMessage}`)
        return
      }
      toast.success(
        `导入成功：${result.data.imported.providers} 个供应商 / ${result.data.imported.upstreamModels} 个上游模型`,
      )
      await reload()
    } catch (err) {
      toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [reload, toast])

  const seedDevelopmentData = useCallback(async () => {
    if (!window.confirm('插入开发测试数据？已有配置不会被覆盖。')) return
    const result = await configApi.seedDevelopment()
    if (!result.success) {
      toast.error(`插入失败：${result.errorMessage}`)
      return
    }
    toast.success(result.data.inserted ? '测试数据已插入' : '测试数据已存在')
    await reload()
  }, [reload, toast])

  return {
    settings,
    proxyStatus,
    loading,
    saving,
    saved,
    updateField,
    saveSettings: runSaveSettings,
    pruneLogs,
    reload,
    exportConfig,
    importConfig,
    seedDevelopmentData,
  }
}
