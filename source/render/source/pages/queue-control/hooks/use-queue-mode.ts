import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { useQueueModeQuery, useSwitchQueueMutation } from '../queries'
import type { ProviderHealth, ProviderModelHealth, ProviderModelRoute } from '@common/schemas'

type HealthMap = Record<string, ProviderHealth>
type ProviderModelHealthMap = Record<string, ProviderModelHealth>

export function useQueueMode(models: ProviderModelRoute[], health: HealthMap, providerModelHealth: ProviderModelHealthMap) {
  const toast = useToast()
  const query = useQueueModeQuery()
  const mutation = useSwitchQueueMutation()
  const manualModelId = query.data?.manualModelId ?? null
  const mode: 'auto' | 'manual' = manualModelId ? 'manual' : 'auto'
  const refresh = query.refetch

  const isCooling = useCallback((providerId: string, providerModelId: string) => {
    const providerCooldownUntil = health[providerId]?.cooldownUntilTime
    const modelCooldownUntil = providerModelHealth[providerModelId]?.cooldownUntilTime
    return Boolean(
      (providerCooldownUntil && providerCooldownUntil > Date.now()) ||
      (modelCooldownUntil && modelCooldownUntil > Date.now()),
    )
  }, [health, providerModelHealth])

  const changeMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (mutation.isPending || nextMode === mode) return
    const initialModelId = nextMode === 'auto' ? null : manualModelId ?? models.find(model => model.enabled)?.id ?? null
    if (nextMode === 'manual' && !initialModelId) {
      toast.error('请先启用一个模型，再切换到手动指定模式')
      return
    }
    try { await mutation.mutateAsync(initialModelId) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [manualModelId, mode, models, mutation, toast])

  const selectManualModel = useCallback(async (model: ProviderModelRoute) => {
    if (mutation.isPending || mode !== 'manual' || !model.enabled || isCooling(model.providerId, model.id)) return
    try { await mutation.mutateAsync(model.id) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }, [isCooling, mode, mutation, toast])

  return { mode, manualModelId, switchingMode: mutation.isPending, isCooling, changeMode, selectManualModel, refresh }
}
