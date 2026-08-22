import { useCallback, useEffect, useRef, useState } from 'react'
import { settingsApi } from '@/api/runtime'
import { useToast } from '@/components/ui/toast'
import { useAsyncFn } from '@/services/use-async'
import { useSettings, useSettingsActions, useSettingsLoading } from '@/features/settings/hooks'
import { useProxyStatus, useProxyActions } from '@/features/proxy/hooks'
import type { Settings } from '@common/schemas'

export function useSettingsForm() {
  const toast = useToast()
  const globalSettings = useSettings()
  const settingsActions = useSettingsActions()
  const proxyActions = useProxyActions()
  const proxyStatus = useProxyStatus()
  const settingsLoading = useSettingsLoading()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current || settingsLoading || !globalSettings) return
    initializedRef.current = true
    setSettings(globalSettings)
    setLoading(false)
  }, [globalSettings, settingsLoading])

  const hydrate = useCallback((nextSettings: Settings) => {
    initializedRef.current = true
    setSettings(nextSettings)
    setLoading(false)
  }, [])

  const updateField = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : null)
  }, [])

  const saveSettings = useCallback(async () => {
    if (!settings) return
    const previousListenHost = proxyStatus?.host ?? settings.listenHost
    const previousListenPort = proxyStatus?.port ?? settings.listenPort
    setSaved(false)
    const result = await settingsApi.update({
      listenHost: settings.listenHost,
      listenPort: settings.listenPort,
      logRetentionDays: settings.logRetentionDays,
      captureRequestContent: settings.captureRequestContent,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
      autoLaunch: settings.autoLaunch,
    })
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    const needsRestart = previousListenHost !== result.data.listenHost || previousListenPort !== result.data.listenPort
    if (needsRestart) {
      const restartResult = await proxyActions.restart()
      if (!restartResult.success) {
        toast.error(`设置已保存，但代理重启失败：${restartResult.errorMessage}`)
        return
      }
    }
    setSettings(result.data)
    settingsActions.refresh()
    setSaved(true)
    toast.success('设置已保存')
    window.setTimeout(() => setSaved(false), 2000)
  }, [proxyActions, proxyStatus, settings, settingsActions, toast])

  const { loading: saving, run: runSaveSettings } = useAsyncFn(saveSettings)

  return { settings, proxyStatus, loading, saving, saved, updateField, hydrate, saveSettings: runSaveSettings }
}
