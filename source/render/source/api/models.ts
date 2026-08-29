import type { LogicalModel, Protocol, ProviderModel, ProviderModelRequestRewriteRule, ProviderModelRoute, ProviderModelRouteEndpoint, RequestRewriteRuleTestCase, RequestRewriteRule, SchedulingPolicy } from '@common/schemas'
import { request } from './client'

type CreateLogicalModelInput = { name: string; description?: string; enabled?: boolean }
type ProviderModelEndpointView = { id: string; url: string | null; enabled: boolean; protocol: Protocol; providerModelId: string; providerEndpointId: string; conversions: Array<{ id: string; clientProtocol: Protocol; enabled: boolean }> }
type ProviderModelView = ProviderModel & { endpoints: ProviderModelEndpointView[] }
type ProviderModelUpdateInput = { logicalModelId?: string; modelName?: string; enabled?: boolean; priority?: number; endpoints?: ProviderModelRouteEndpoint[] }
type ProviderModelCreateInput = { providerId: string; modelName: string; logicalModelId?: string; priority?: number; enabled?: boolean; endpoints?: ProviderModelRouteEndpoint[] }
type RequestRewriteRuleBindingInput = { ruleId: string; priority: number; enabled: boolean }
type SchedulingPolicyInput = { logicalModelId: string; providerModelId: string; strategy?: string; priority?: number; weight?: number; enabled?: boolean }

export const requestRewriteRuleApi = {
  list: () => request<RequestRewriteRule[]>('/request-rewrite-rule/list'),
  get: (id: string) => request<RequestRewriteRule>('/request-rewrite-rule/get', { id }),
  create: (data: Omit<RequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>) => request<RequestRewriteRule>('/request-rewrite-rule/create', data),
  update: (id: string, updates: Partial<RequestRewriteRule>) => request<RequestRewriteRule>('/request-rewrite-rule/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string; affectedProviderModelCount: number }>('/request-rewrite-rule/delete', { id }),
  test: (rule: RequestRewriteRule, testCase: RequestRewriteRuleTestCase) => request<{ body: string; headers: Record<string, string | string[] | undefined>; appliedRuleIds: string[]; skippedRuleIds: string[] }>('/request-rewrite-rule/test', { rule, testCase }),
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
  requestRewriteRules: (providerModelId: string) => request<ProviderModelRequestRewriteRule[]>('/request-rewrite-rule/bindings', { providerModelId }),
  replaceRequestRewriteRules: (providerModelId: string, bindings: RequestRewriteRuleBindingInput[]) => request<ProviderModelRequestRewriteRule[]>('/request-rewrite-rule/replace-bindings', { providerModelId, bindings }),
}

export const schedulingPolicyApi = {
  list: (logicalModelId?: string) => request<SchedulingPolicy[]>('/scheduling-policy/list', logicalModelId ? { logicalModelId } : {}),
  update: (data: SchedulingPolicyInput) => request<SchedulingPolicy>('/scheduling-policy/update', data),
  remove: (logicalModelId: string, providerModelId: string) => request<{ logicalModelId: string; providerModelId: string }>('/scheduling-policy/delete', { logicalModelId, providerModelId }),
}
