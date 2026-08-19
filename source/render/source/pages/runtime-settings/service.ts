import { useCallback, useEffect, useState } from 'react'
import { proxyApi, settingsApi, configApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import type { Settings, ProxyServerStatus } from '@common/schemas'

export function useRuntimeSettingsService() {
  const toast = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [settingsResult, statusResult] = await Promise.all([settingsApi.get(), proxyApi.status()])
    if (!settingsResult.success || !statusResult.success) {
      toast.error(!settingsResult.success ? settingsResult.errorMessage : !statusResult.success ? statusResult.errorMessage : '加载失败')
      setLoading(false)
      return
    }
    setSettings(settingsResult.data)
    setProxyStatus(statusResult.data)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const updateField = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : null)
  }, [])

  const saveSettings = useCallback(async () => {
    if (!settings) return
    setSaving(true)
    setSaved(false)
    const updateResult = await settingsApi.update({
      listenHost: settings.listenHost,
      listenPort: settings.listenPort,
      logRetentionCount: settings.logRetentionCount,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
      autoLaunch: settings.autoLaunch,
    })
    if (!updateResult.success) {
      setSaving(false)
      toast.error(updateResult.errorMessage)
      return
    }
    // 代理相关配置变更才重启代理
    const needsRestart =
      settings.listenHost !== updateResult.data.listenHost ||
      settings.listenPort !== updateResult.data.listenPort
    if (needsRestart) {
      const restartResult = await proxyApi.restart()
      setSaving(false)
      if (!restartResult.success) {
        toast.error(`设置已保存，但代理重启失败：${restartResult.errorMessage}`)
        return
      }
      setProxyStatus(restartResult.data)
    } else {
      setSaving(false)
    }
    setSettings(updateResult.data)
    setSaved(true)
    toast.success('设置已保存')
    window.setTimeout(() => setSaved(false), 2000)
  }, [settings, toast])

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
        `导入成功：${result.data.imported.providers} 个供应商 / ${result.data.imported.logicalModels} 个模型 / ${result.data.imported.upstreamModels} 条绑定`,
      )
      await loadData()
    } catch (err) {
      toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadData, toast])

  const seedDevelopmentData = useCallback(async () => {
    if (!window.confirm('插入开发测试数据？已有配置不会被覆盖。')) return
    const result = await configApi.seedDevelopment()
    if (!result.success) {
      toast.error(`插入失败：${result.errorMessage}`)
      return
    }
    toast.success(result.data.inserted ? '测试数据已插入' : '测试数据已存在')
    await loadData()
  }, [loadData, toast])

  return {
    settings,
    proxyStatus,
    loading,
    saving,
    saved,
    updateField,
    saveSettings,
    reload: loadData,
    exportConfig,
    importConfig,
    seedDevelopmentData,
  }
}
