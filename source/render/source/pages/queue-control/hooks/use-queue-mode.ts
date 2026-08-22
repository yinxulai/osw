import { useCallback, useEffect, useRef, useState } from 'react'
import { queueApi } from '@/api/runtime'
import { useToast } from '@/components/ui/toast'
import type { ProviderHealth, ProviderModelHealth, ProviderModelRoute } from '@common/schemas'

type HealthMap = Record<string, ProviderHealth>
type ProviderModelHealthMap = Record<string, ProviderModelHealth>

export function useQueueMode(models: ProviderModelRoute[], health: HealthMap, providerModelHealth: ProviderModelHealthMap) {
  const toast = useToast()
  const [manualModelId, setManualModelId] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const inflightRef = useRef(false)

  const refresh = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const result = await queueApi.status('default')
      if (!result.success) return
      setManualModelId(result.data.manualModelId)
      setMode(result.data.manualModelId ? 'manual' : 'auto')
    } finally {
      inflightRef.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const isCooling = useCallback((providerId: string, providerModelId: string) => {
    const providerCooldownUntil = health[providerId]?.cooldownUntilTime
    const modelCooldownUntil = providerModelHealth[providerModelId]?.cooldownUntilTime
    return Boolean(
      (providerCooldownUntil && providerCooldownUntil > Date.now()) ||
      (modelCooldownUntil && modelCooldownUntil > Date.now()),
    )
  }, [health, providerModelHealth])

  const changeMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (nextMode === 'auto') {
      const result = await queueApi.switch('default', null)
      if (!result.success) { toast.error(result.errorMessage); return }
      setManualModelId(null)
      setMode('auto')
      return
    }
    const initialModelId = manualModelId ?? models.find(model => model.enabled)?.id ?? null
    if (!initialModelId) return
    const result = await queueApi.switch('default', initialModelId)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(initialModelId)
    setMode('manual')
  }, [manualModelId, models, toast])

  const selectManualModel = useCallback(async (model: ProviderModelRoute) => {
    if (mode !== 'manual' || !model.enabled || isCooling(model.providerId, model.id)) return
    const result = await queueApi.switch('default', model.id)
    if (!result.success) { toast.error(result.errorMessage); return }
    setManualModelId(model.id)
  }, [isCooling, mode, toast])

  return { mode, manualModelId, isCooling, changeMode, selectManualModel, refresh }
}
