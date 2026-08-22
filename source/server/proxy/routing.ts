import type { Protocol } from '@common/schemas'
import { getManualModel } from './manual-routing'
import {
  findConvertibleEndpoint,
  findEndpoint,
  getAvailableModels,
  type ModelWithProvider,
} from './router'

export interface ProxyTargets {
  availableModels: ModelWithProvider[]
  targets: ModelWithProvider[]
  manualModelUnavailable: boolean
}

export async function resolveProxyTargets(logicalModelId: string, protocol: Protocol): Promise<ProxyTargets> {
  const availableModels = await getAvailableModels(logicalModelId)
  let targets = availableModels.filter(candidate =>
    Boolean(findEndpoint(candidate.model, protocol) || findConvertibleEndpoint(candidate.model, protocol)),
  )
  const manualModelId = getManualModel(logicalModelId)
  if (manualModelId) {
    const manualIndex = targets.findIndex(candidate => candidate.model.id === manualModelId)
    if (manualIndex === -1) return { availableModels, targets: [], manualModelUnavailable: true }
    targets = targets.slice(manualIndex)
  }
  return { availableModels, targets, manualModelUnavailable: false }
}

export interface AttemptTargetSnapshot {
  providerId: string
  providerModelId: string
  providerName: string
  providerModelName: string
  upstreamProtocol: Protocol
  url: string
}

export function resolveAttemptSnapshot(target: ModelWithProvider, clientProtocol: Protocol): AttemptTargetSnapshot {
  const endpoint = findEndpoint(target.model, clientProtocol) ?? findConvertibleEndpoint(target.model, clientProtocol)
  if (!endpoint) throw new Error(`provider model does not support protocol: ${clientProtocol}`)
  return {
    providerId: target.provider.id,
    providerModelId: target.model.id,
    providerName: target.provider.name,
    providerModelName: target.model.modelName,
    upstreamProtocol: endpoint.protocol,
    url: endpoint.endpointUrl,
  }
}
