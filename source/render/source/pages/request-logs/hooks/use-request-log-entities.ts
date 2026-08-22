import { useCallback, useMemo } from 'react'
import { useLogicalModels } from '@/features/logical-models/hooks'
import { useProviders } from '@/features/providers/hooks'

export function useRequestLogEntities() {
  const providers = useProviders()
  const logicalModels = useLogicalModels()
  const providerOptions = useMemo(() => providers.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [providers])
  const getModelName = useCallback((id: string) => logicalModels.find(model => model.id === id)?.name ?? id, [logicalModels])
  return { providers, logicalModels, providerOptions, getModelName }
}
