import { useCallback, useEffect, useRef, useState } from 'react'
import { providerModelApi } from '@/api/models'
import { useProviders, useProvidersActions, useProvidersLoading } from '@/features/providers/hooks'
import { useHealth, useHealthActions } from '@/features/health/hooks'
import type { ProviderModelRoute } from '@common/schemas'

export function useModelData() {
  const providers = useProviders()
  const health = useHealth()
  const providersLoading = useProvidersLoading()
  const { refresh: refreshProviders } = useProvidersActions()
  const { refresh: refreshHealth } = useHealthActions()
  const [models, setModels] = useState<ProviderModelRoute[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [loading, setLoading] = useState(true)
  const initializedRef = useRef(false)

  const loadModels = useCallback(async () => {
    const result = await providerModelApi.list()
    if (!result.success) return false
    setModels(result.data.map(model => ({
      id: model.id,
      providerId: model.providerId,
      modelName: model.modelName,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        endpointUrl: endpoint.url ?? '',
        customAuthHeader: null,
        protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
      })),
      priority: 0,
      enabled: model.enabled,
      createdTime: model.createdTime,
      updatedTime: model.updatedTime,
      deletedTime: model.deletedTime,
    })))
    return true
  }, [])

  const reload = useCallback(async () => {
    refreshProviders()
    refreshHealth()
    await loadModels()
  }, [loadModels, refreshHealth, refreshProviders])

  useEffect(() => {
    if (initializedRef.current || providersLoading) return
    initializedRef.current = true
    void loadModels()
    setSelectedProviderId(current => current || providers[0]?.id || '')
    setLoading(false)
  }, [loadModels, providers, providersLoading])

  return { providers, health, providersLoading, models, setModels, selectedProviderId, setSelectedProviderId, loading, loadModels, reload }
}
