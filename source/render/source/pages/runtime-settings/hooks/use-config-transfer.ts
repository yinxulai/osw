import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { configApi } from '@/api/tools'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { settingsKeys } from '@/features/settings/hooks'
import { providerKeys } from '@/features/providers/hooks'
import { logicalModelKeys } from '@/features/logical-models/hooks'
import { healthKeys } from '@/features/health/hooks'
import { proxyKeys } from '@/features/proxy/hooks'
import type { Settings } from '@common/schemas'

interface ConfigTransferOptions {
  hydrateSettings: (settings: Settings) => void
}

export function useConfigTransfer(options: ConfigTransferOptions) {
  const { hydrateSettings } = options
  const toast = useToast()
  const client = useQueryClient()
  const reload = useCallback(async () => {
    await Promise.all([settingsKeys.all, providerKeys.all, logicalModelKeys.all, healthKeys.all, proxyKeys.status].map(queryKey => client.invalidateQueries({ queryKey })))
    const settings = client.getQueryData<Settings>(settingsKeys.all)
    if (settings) hydrateSettings(settings)
  }, [client, hydrateSettings])
  const exportMutation = useMutation({ mutationFn: () => unwrap(configApi.export()) })
  const importMutation = useMutation({ mutationFn: async (file: File) => unwrap(configApi.import(JSON.parse(await file.text()), 'merge')), onSuccess: async data => { toast.success(`导入成功：${data.imported.providers} 个供应商 / ${data.imported.providerModels} 个供应商模型`); await reload() }, onError: error => toast.error(`导入失败：${error.message}`) })
  const exportConfig = useCallback(async () => {
    try {
      const data = await exportMutation.mutateAsync()
      const blob = new Blob([data.content], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `one-switch-config-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); toast.success('配置已导出')
    } catch (error) { toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
  }, [exportMutation, toast])
  const importConfig = useCallback(async (file: File) => { await importMutation.mutateAsync(file).catch(() => undefined) }, [importMutation])
  return { reload, exportConfig, importConfig }
}
