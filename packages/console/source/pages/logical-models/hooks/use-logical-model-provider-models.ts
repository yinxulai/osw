import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LogicalModelProviderModel } from '@common/schemas'
import { logicalModelKeys, useLogicalModelProviderModelsQuery, type LogicalModelKeysRef } from '../queries'

function toProviderModel(model: LogicalModelProviderModel): LogicalModelProviderModel {
  return {
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.endpointUrl,
      customAuthHeader: endpoint.customAuthHeader,
      protocolConversionEnabled: endpoint.protocolConversionEnabled,
    })),
    priority: model.priority,
    enabled: model.enabled,
    // 模型本体的开关必须原样带走：界面靠它区分「这个逻辑模型没启用它」与
    // 「模型在模型管理里被停用了」，后者不该再画成待命。
    modelEnabled: model.modelEnabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }
}

export function useLogicalModelProviderModels(logicalModel: LogicalModelKeysRef | null) {
  const client = useQueryClient()
  const query = useLogicalModelProviderModelsQuery(logicalModel)
  const models = useMemo(() => (query.data ?? []).map(toProviderModel), [query.data])
  const loadModels = useCallback(async () => { const result = await query.refetch(); return !result.isError }, [query])
  const recordId = logicalModel?.id ?? ''
  const updateModels = useCallback((update: (models: LogicalModelProviderModel[]) => LogicalModelProviderModel[]) => client.setQueryData<LogicalModelProviderModel[]>(logicalModelKeys.models(recordId), current => update(current ?? [])), [client, recordId])
  const updateEnabledModel = useCallback((id: string, enabled: boolean) => updateModels(current => current.map(model => model.id === id ? { ...model, enabled } : model)), [updateModels])
  return { models, loading: query.isPending, loadModels, updateModels, updateEnabledModel }
}
