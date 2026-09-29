import { isProviderModelCooling } from '@common/provider-model-status'
import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useLogicalModelModeQuery, useSwitchManualModelMutation } from '../queries'
import type { LogicalModelProviderModel, ProviderHealth, ProviderModelHealth } from '@common/schemas'

type HealthMap = Record<string, ProviderHealth>
type ProviderModelHealthMap = Record<string, ProviderModelHealth>

export function useLogicalModelMode(logicalModelId: string, models: LogicalModelProviderModel[], health: HealthMap, providerModelHealth: ProviderModelHealthMap) {
  const toast = useToast()
  const t = useTranslation()
  const query = useLogicalModelModeQuery(logicalModelId)
  const mutation = useSwitchManualModelMutation(logicalModelId)
  const manualModelId = query.data?.manualModelId ?? null
  const mode: 'auto' | 'manual' = manualModelId ? 'manual' : 'auto'
  const refresh = query.refetch

  // 冷却判定与徽标口径共用 `@common` 那一份：托盘面板也要画同一个「冷却」。
  const isCooling = useCallback((providerId: string, providerModelId: string) => (
    isProviderModelCooling(health[providerId], providerModelHealth[providerModelId])
  ), [health, providerModelHealth])

  const changeMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (mutation.isPending || nextMode === mode) return
    const initialModelId = nextMode === 'auto' ? null : manualModelId ?? models[0]?.id ?? null
    if (nextMode === 'manual' && !initialModelId) {
      toast.error(t('logicalModels.mode.needModel'))
      return
    }
    try { await mutation.mutateAsync(initialModelId) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [manualModelId, mode, models, mutation, t, toast])

  const selectManualModel = useCallback(async (model: LogicalModelProviderModel) => {
    if (mutation.isPending || mode !== 'manual') return
    try { await mutation.mutateAsync(model.id) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [mode, mutation, toast])

  return { mode, manualModelId, switchingMode: mutation.isPending, isCooling, changeMode, selectManualModel, refresh }
}
