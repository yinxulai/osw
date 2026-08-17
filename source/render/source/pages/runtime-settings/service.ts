import { useCallback, useEffect, useState } from 'react'
import { proxyApi, settingsApi, configApi } from '@/api'
import type { Settings, ProxyServerStatus } from '@common/schemas'

export interface ImportResult {
  success: boolean
  message: string
}

export function useRuntimeSettingsService() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [settingsResult, statusResult] = await Promise.all([settingsApi.get(), proxyApi.status()])
    if (!settingsResult.success || !statusResult.success) {
      setErrorMessage(!settingsResult.success ? settingsResult.errorMessage : !statusResult.success ? statusResult.errorMessage : '加载失败')
      setLoading(false)
      return
    }
    setSettings(settingsResult.data)
    setProxyStatus(statusResult.data)
    setLoading(false)
  }, [])

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
    setErrorMessage('')
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
      setErrorMessage(updateResult.errorMessage)
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
        setErrorMessage(`设置已保存，但代理重启失败：${restartResult.errorMessage}`)
        return
      }
      setProxyStatus(restartResult.data)
    } else {
      setSaving(false)
    }
    setSettings(updateResult.data)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }, [settings])

  // ========== 配置导入导出 ==========

  const exportConfig = useCallback(async () => {
    const result = await configApi.export()
    if (!result.success) {
      setImportSuccess(false)
      setImportMessage(`导出失败：${result.errorMessage}`)
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
    setImportSuccess(true)
    setImportMessage('配置已导出')
    window.setTimeout(() => setImportMessage(''), 3000)
  }, [])

  const importConfig = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const config = JSON.parse(text)
      const result = await configApi.import(config, 'merge')
      if (!result.success) {
        setImportSuccess(false)
        setImportMessage(`导入失败：${result.errorMessage}`)
        return
      }
      setImportSuccess(true)
      setImportMessage(
        `导入成功：${result.data.imported.providers} 个供应商 / ${result.data.imported.logicalModels} 个模型 / ${result.data.imported.upstreamModels} 条绑定`,
      )
      await loadData()
      window.setTimeout(() => setImportMessage(''), 5000)
    } catch (err) {
      setImportSuccess(false)
      setImportMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadData])

  return {
    settings,
    proxyStatus,
    loading,
    saving,
    errorMessage,
    saved,
    importMessage,
    importSuccess,
    updateField,
    saveSettings,
    reload: loadData,
    exportConfig,
    importConfig,
  }
}
