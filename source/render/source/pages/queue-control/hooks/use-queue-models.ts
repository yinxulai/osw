import { useCallback, useEffect, useRef, useState } from 'react'
import { providerModelApi } from '@/api/models'
import { useToast } from '@/components/ui/toast'
import type { ProviderModelRoute } from '@common/schemas'

function toQueueModel(model: ProviderModelRoute): ProviderModelRoute {
  return {
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      upstreamUrl: endpoint.upstreamUrl,
      customAuthHeader: endpoint.customAuthHeader,
      protocolConversionEnabled: endpoint.protocolConversionEnabled,
    })),
    priority: model.priority,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }
}

export function useQueueModels() {
  const toast = useToast()
  const [models, setModels] = useState<ProviderModelRoute[]>([])
  const [loading, setLoading] = useState(true)
  const initializedRef = useRef(false)
  const inflightRef = useRef(false)

  const loadModels = useCallback(async () => {
    if (inflightRef.current) return false
    inflightRef.current = true
    try {
      const result = await providerModelApi.queue('default')
      if (!result.success) {
        toast.error(result.errorMessage)
        return false
      }
      setModels(result.data.map(toQueueModel))
      return true
    } finally {
      inflightRef.current = false
    }
  }, [toast])

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      void loadModels().finally(() => setLoading(false))
    }
    const timer = window.setInterval(() => void loadModels(), 30000)
    return () => window.clearInterval(timer)
  }, [loadModels])

  const updateModels = useCallback((update: (models: ProviderModelRoute[]) => ProviderModelRoute[]) => {
    setModels(update)
  }, [])

  const updateEnabledModel = useCallback((id: string, enabled: boolean) => {
    setModels(current => current.map(model => model.id === id ? { ...model, enabled } : model))
  }, [])

  return { models, loading, loadModels, updateModels, updateEnabledModel }
}
