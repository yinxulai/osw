import type { LogicalModel, Protocol, ProviderModel, ProviderModelRoute, ProviderModelRouteEndpoint, SchedulingPolicy } from '@common/schemas'
import { request } from './client'

type CreateLogicalModelInput = { name: string; description?: string; enabled?: boolean }
type ProviderModelEndpointView = { id: string; url: string | null; enabled: boolean; protocol: Protocol; providerModelId: string; providerEndpointId: string; conversions: Array<{ id: string; clientProtocol: Protocol; enabled: boolean }> }
type ProviderModelView = ProviderModel & { endpoints: ProviderModelEndpointView[] }
type ProviderModelUpdateInput = { logicalModelId?: string; modelName?: string; enabled?: boolean; priority?: number; endpoints?: ProviderModelRouteEndpoint[] }
type ProviderModelCreateInput = { providerId: string; modelName: string; logicalModelId?: string; priority?: number; enabled?: boolean; endpoints?: ProviderModelRouteEndpoint[] }
type ModificationRuleBindingInput = { ruleId: string; priority: number; enabled: boolean }
type SchedulingPolicyInput = { logicalModelId: string; providerModelId: string; strategy?: string; priority?: number; weight?: number; enabled?: boolean }

export const modificationRuleApi = {
  list: () => request<import('@common/schemas').ModificationRule[]>('/modification-rule/list'),
  get: (id: string) => request<import('@common/schemas').ModificationRule>('/modification-rule/get', { id }),
  create: (data: Omit<import('@common/schemas').ModificationRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>) => request<import('@common/schemas').ModificationRule>('/modification-rule/create', data),
  update: (id: string, updates: Partial<import('@common/schemas').ModificationRule>) => request<import('@common/schemas').ModificationRule>('/modification-rule/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string; affectedProviderModelCount: number }>('/modification-rule/delete', { id }),
}

export const logicalModelApi = {
  list: () => request<LogicalModel[]>('/logical-model/list'),
  get: (id: string) => request<LogicalModel>('/logical-model/get', { id }),
  create: (data: CreateLogicalModelInput) => request<LogicalModel>('/logical-model/create', data),
  update: (id: string, updates: Partial<LogicalModel>) => request<LogicalModel>('/logical-model/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string }>('/logical-model/delete', { id }),
}

export const providerModelApi = {
  list: () => request<ProviderModelView[]>('/provider-model/list'),
  get: (id: string) => request<ProviderModelView>('/provider-model/get', { id }),
  create: (data: ProviderModelCreateInput) => request<ProviderModelView>('/provider-model/create', data),
  update: (id: string, updates: ProviderModelUpdateInput) => request<ProviderModelView>('/provider-model/update', { id, ...updates }),
  queue: (logicalModelId = 'default') => request<ProviderModelRoute[]>('/provider-model/queue', { logicalModelId }),
  remove: (id: string) => request<{ id: string }>('/provider-model/delete', { id }),
  modificationRules: (providerModelId: string) => request<import('@common/schemas').ProviderModelModificationRule[]>('/modification-rule/bindings', { providerModelId }),
  replaceModificationRules: (providerModelId: string, bindings: ModificationRuleBindingInput[]) => request<import('@common/schemas').ProviderModelModificationRule[]>('/modification-rule/replace-bindings', { providerModelId, bindings }),
}

export const schedulingPolicyApi = {
  list: (logicalModelId?: string) => request<SchedulingPolicy[]>('/scheduling-policy/list', logicalModelId ? { logicalModelId } : {}),
  update: (data: SchedulingPolicyInput) => request<SchedulingPolicy>('/scheduling-policy/update', data),
  remove: (logicalModelId: string, providerModelId: string) => request<{ logicalModelId: string; providerModelId: string }>('/scheduling-policy/delete', { logicalModelId, providerModelId }),
}
