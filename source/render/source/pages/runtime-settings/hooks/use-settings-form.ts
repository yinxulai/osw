import { useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { settingsKeys, useSettings, useSettingsLoading } from '@/features/settings/hooks'
import { useProxyStatus, useProxyActions } from '@/features/proxy/hooks'
import { useRuntimeSettingsUiStore } from '../store'

export function useSettingsForm() {
  const toast = useToast()
  const client = useQueryClient()
  const globalSettings = useSettings()
  const proxyActions = useProxyActions()
  const proxyStatus = useProxyStatus()
  const settingsLoading = useSettingsLoading()
  const settings = useRuntimeSettingsUiStore(state => state.draft)
  const saved = useRuntimeSettingsUiStore(state => state.saved)
  const isDirty = useRuntimeSettingsUiStore(state => state.isDirty)
  const hydrate = useRuntimeSettingsUiStore(state => state.hydrate)
  const updateField = useRuntimeSettingsUiStore(state => state.updateField)
  const resetSettings = useRuntimeSettingsUiStore(state => state.resetDraft)
  const setSaved = useRuntimeSettingsUiStore(state => state.setSaved)

  useEffect(() => { if (!settings && globalSettings) hydrate(globalSettings) }, [globalSettings, hydrate, settings])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!settings) throw new Error('设置尚未加载')
      const previousListenHost = proxyStatus?.host ?? settings.listenHost
      const previousListenPort = proxyStatus?.port ?? settings.listenPort
      const updated = await unwrap(settingsApi.update({ listenHost: settings.listenHost, listenPort: settings.listenPort, logRetentionDays: settings.logRetentionDays, captureRequestContent: settings.captureRequestContent, cooldownBaseSeconds: settings.cooldownBaseSeconds, cooldownMaxSeconds: settings.cooldownMaxSeconds, consecutiveFailureThreshold: settings.consecutiveFailureThreshold, idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds, outboundProxyMode: settings.outboundProxyMode, outboundProxyUrl: settings.outboundProxyUrl, outboundProxyBypass: settings.outboundProxyBypass, autoLaunch: settings.autoLaunch }))
      if (previousListenHost !== updated.listenHost || previousListenPort !== updated.listenPort) {
        const restart = await proxyActions.restart()
        if (!restart.success) throw new Error(`设置已保存，但代理重启失败：${restart.errorMessage}`)
      }
      return updated
    },
    onSuccess: updated => { client.setQueryData(settingsKeys.all, updated); hydrate(updated); setSaved(true); toast.success('设置已保存'); window.setTimeout(() => setSaved(false), 2000) },
    onError: error => toast.error(error.message),
  })
  const saveSettings = useCallback(async () => {
    if (!isDirty) return
    setSaved(false)
    await mutation.mutateAsync().catch(() => undefined)
  }, [isDirty, mutation, setSaved])
  return { settings, proxyStatus, loading: settingsLoading && !settings, saving: mutation.isPending, saved, isDirty, updateField, hydrate, resetSettings, saveSettings }
}
