import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { freeModelApi, type FreeModelSourceInfo } from '@/api/free-models'
import { settingsApi } from '@/api/runtime'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { providerKeys } from '@/features/providers/hooks'
import { settingsKeys } from '@/features/settings/hooks'
import { modelKeys } from './use-model-data'

export const freeModelKeys = { all: ['free-model-sources'] as const }

type EnableParams = { sourceKey: string; apiKey?: string }
type UpdateKeyParams = { sourceKey: string; apiKey: string }

function loadSources(): Promise<FreeModelSourceInfo[]> {
  return unwrap(freeModelApi.sources()).then(data => data.sources)
}

export function useFreeModels() {
  const toast = useToast()
  const client = useQueryClient()

  const query = useQuery({ queryKey: freeModelKeys.all, queryFn: loadSources, refetchInterval: 30_000 })
  const sources = query.data ?? []

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: freeModelKeys.all })
    void client.invalidateQueries({ queryKey: providerKeys.all })
    void client.invalidateQueries({ queryKey: modelKeys.all })
  }, [client])

  const settle = useCallback(() => { refresh() }, [refresh])

  const enableMutation = useMutation({
    mutationFn: ({ sourceKey, apiKey }: EnableParams) =>
      unwrap(freeModelApi.enable(sourceKey, apiKey)),
    onSuccess: result => {
      toast.success(`已启用，同步到 ${result.total} 个免费模型（新增 ${result.added} 个）`)
      settle()
    },
    onError: error => toast.error(error.message),
  })

  const disableMutation = useMutation({
    mutationFn: (sourceKey: string) => unwrap(freeModelApi.disable(sourceKey)),
    onSuccess: () => { toast.success('已停用该免费模型源'); settle() },
    onError: error => toast.error(error.message),
  })

  const syncMutation = useMutation({
    mutationFn: (sourceKey: string) => unwrap(freeModelApi.sync(sourceKey)),
    onSuccess: result => {
      toast.success(`同步完成：共 ${result.total} 个，新增 ${result.added} 个，移除 ${result.removed} 个`)
      settle()
    },
    onError: error => toast.error(error.message),
  })

  const updateKeyMutation = useMutation({
    mutationFn: ({ sourceKey, apiKey }: UpdateKeyParams) =>
      unwrap(freeModelApi.updateKey(sourceKey, apiKey)),
    onSuccess: result => {
      toast.success(`API Key 已更新，同步到 ${result.total} 个免费模型`)
      settle()
    },
    onError: error => toast.error(error.message),
  })

  const updateAutoSync = useCallback(async (enabled: boolean, intervalHours: number) => {
    try {
      await unwrap(settingsApi.update({ freeModelAutoSyncEnabled: enabled, freeModelSyncIntervalHours: intervalHours }))
      void client.invalidateQueries({ queryKey: settingsKeys.all })
      toast.success('自动同步设置已保存')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [client, toast])

  return {
    sources,
    loading: query.isPending,
    enable: (sourceKey: string, apiKey?: string) => enableMutation.mutateAsync({ sourceKey, apiKey }).then(() => true).catch(() => false),
    disable: (sourceKey: string) => disableMutation.mutateAsync(sourceKey).then(() => true).catch(() => false),
    sync: (sourceKey: string) => syncMutation.mutateAsync(sourceKey).then(() => true).catch(() => false),
    updateKey: (sourceKey: string, apiKey: string) => updateKeyMutation.mutateAsync({ sourceKey, apiKey }).then(() => true).catch(() => false),
    updateAutoSync,
    busyKey:
      enableMutation.variables?.sourceKey
      ?? disableMutation.variables
      ?? syncMutation.variables
      ?? updateKeyMutation.variables?.sourceKey
      ?? null,
  }
}
