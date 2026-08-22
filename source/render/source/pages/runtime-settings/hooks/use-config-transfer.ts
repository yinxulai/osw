import { useCallback } from 'react'
import { settingsApi } from '@/api/runtime'
import { configApi } from '@/api/tools'
import { useToast } from '@/components/ui/toast'
import { useSettingsActions } from '@/features/settings/hooks'
import { useProvidersActions } from '@/features/providers/hooks'
import { useLogicalModelsActions } from '@/features/logical-models/hooks'
import { useHealthActions } from '@/features/health/hooks'
import { useProxyActions } from '@/features/proxy/hooks'
import type { Settings } from '@common/schemas'

interface ConfigTransferOptions {
  hydrateSettings: (settings: Settings) => void
}

export function useConfigTransfer(options: ConfigTransferOptions) {
  const { hydrateSettings } = options
  const toast = useToast()
  const settingsActions = useSettingsActions()
  const providersActions = useProvidersActions()
  const logicalModelsActions = useLogicalModelsActions()
  const healthActions = useHealthActions()
  const proxyActions = useProxyActions()

  const reload = useCallback(async () => {
    settingsActions.refresh()
    providersActions.refresh()
    logicalModelsActions.refresh()
    healthActions.refresh()
    proxyActions.refresh()
  }, [healthActions, logicalModelsActions, providersActions, proxyActions, settingsActions])

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
      const config = JSON.parse(await file.text())
      const result = await configApi.import(config, 'merge')
      if (!result.success) {
        toast.error(`导入失败：${result.errorMessage}`)
        return
      }
      toast.success(`导入成功：${result.data.imported.providers} 个供应商 / ${result.data.imported.providerModels} 个供应商模型`)
      await reload()
      const settingsResult = await settingsApi.get()
      if (settingsResult.success) hydrateSettings(settingsResult.data)
    } catch (err) {
      toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [hydrateSettings, reload, toast])

  return { reload, exportConfig, importConfig }
}
