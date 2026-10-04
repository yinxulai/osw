import type { LogicalModel, LogicalModelProviderModel, Protocol, ProviderModel, ProviderModelRequestRewriteRule, ProviderModelRouteEndpoint, RequestRewriteRuleTestCase, RequestRewriteRule, SchedulingPolicy } from '@common/schemas'
import type { SharedRewriteRule, SharedRewriteRuleListInput, SharedRewriteRuleListResult } from '@common/shared-rewrite-rules'
import { request } from './client'

type CreateLogicalModelInput = { modelId: string; description?: string; enabled?: boolean }
type UpdateLogicalModelInput = { modelId?: string; description?: string; enabled?: boolean }
type ProviderModelEndpointView = { id: string; url: string | null; enabled: boolean; protocol: Protocol; providerModelId: string; providerEndpointId: string; conversions: Array<{ id: string; clientProtocol: Protocol; enabled: boolean }> }
type ProviderModelView = ProviderModel & { endpoints: ProviderModelEndpointView[] }
type ProviderModelUpdateInput = { logicalModelId?: string; modelName?: string; enabled?: boolean; priority?: number; endpoints?: ProviderModelRouteEndpoint[] }
type ProviderModelCreateInput = { providerId: string; modelName: string; logicalModelId?: string; priority?: number; enabled?: boolean; endpoints?: ProviderModelRouteEndpoint[] }
type RequestRewriteRuleBindingInput = { ruleId: string; priority: number; enabled: boolean }
type SchedulingPolicyInput = { logicalModelId: string; providerModelId: string; strategy?: string; priority?: number; weight?: number; enabled?: boolean }

/** 规则试跑的结果。`skippedRules` 带上每条被跳过规则的原因（见 `@osw/core` 的 `RewriteSkipReason`）。 */
export type RequestRewriteTestResult = {
  body: string
  headers: Record<string, string | string[] | undefined>
  appliedRuleIds: string[]
  skippedRuleIds: string[]
  skippedRules: Array<{ ruleId: string; reason: string }>
  scriptLogs: string[]
}

export const requestRewriteRuleApi = {
  list: () => request<RequestRewriteRule[]>('/request-rewrite-rule/list'),
  get: (id: string) => request<RequestRewriteRule>('/request-rewrite-rule/get', { id }),
  create: (data: Omit<RequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>) => request<RequestRewriteRule>('/request-rewrite-rule/create', data),
  update: (id: string, updates: Partial<RequestRewriteRule>) => request<RequestRewriteRule>('/request-rewrite-rule/update', { id, ...updates }),
  remove: (id: string) => request<{ id: string; affectedProviderModelCount: number }>('/request-rewrite-rule/delete', { id }),
  test: (rule: RequestRewriteRule, testCase: RequestRewriteRuleTestCase) => request<RequestRewriteTestResult>('/request-rewrite-rule/test', { rule, testCase }),
}

/**
 * 共享规则目录（`apps/apis` 上的社区目录）。
 *
 * `publish` 收的是**本机规则 id**：分享这个动作的对象是「我库里的这条规则」，不是一份临时载荷。
 * `use` 返回的是**新建好的本机规则**——保存即用，目录这一步之后它就与原生的规则别无二致。
 */
export const sharedRewriteRuleApi = {
  list: (input: SharedRewriteRuleListInput) => request<SharedRewriteRuleListResult>('/shared-rewrite-rule/list', input),
  get: (id: string) => request<SharedRewriteRule>('/shared-rewrite-rule/get', { id }),
  publish: (id: string) => request<SharedRewriteRule>('/shared-rewrite-rule/publish', { id }),
  use: (id: string) => request<RequestRewriteRule>('/shared-rewrite-rule/use', { id }),
}

export const logicalModelApi = {
  list: () => request<LogicalModel[]>('/logical-model/list'),
  /** 连软删除的行一起回。删除的逻辑模型只是不再活跃，历史请求日志仍按 `modelId` 引用它。 */
  listIncludingDeleted: () => request<LogicalModel[]>('/logical-model/list', { includeDeleted: true }),
  /** `id` 是**数据记录 id**；改模型名（`modelId`）与改说明共用 `update`。 */
  get: (id: string) => request<LogicalModel>('/logical-model/get', { id }),
  create: (data: CreateLogicalModelInput) => request<LogicalModel>('/logical-model/create', data),
  update: (id: string, updates: UpdateLogicalModelInput) => request<LogicalModel>('/logical-model/update', { id, ...updates }),
  reorder: (ids: string[]) => request<LogicalModel[]>('/logical-model/reorder', { ids }),
  remove: (id: string) => request<{ id: string }>('/logical-model/delete', { id }),
}

export const providerModelApi = {
  list: () => request<ProviderModelView[]>('/provider-model/list'),
  /** 连软删除的行一起回，用来认出统计里那些已经删掉的供应商模型（历史快照仍按 id 引用它们）。 */
  listIncludingDeleted: () => request<ProviderModelView[]>('/provider-model/list', { includeDeleted: true }),
  get: (id: string) => request<ProviderModelView>('/provider-model/get', { id }),
  create: (data: ProviderModelCreateInput) => request<ProviderModelView>('/provider-model/create', data),
  update: (id: string, updates: ProviderModelUpdateInput) => request<ProviderModelView>('/provider-model/update', { id, ...updates }),
  // `logicalModelId` 在这些接口里是**数据记录 id**（`lm_*`），不是模型名 ——
  // 它们读写的是调度绑定，外键指着那把钥匙。
  listByLogicalModel: (logicalModelId: string) => request<LogicalModelProviderModel[]>('/provider-model/list-by-logical-model', { logicalModelId }),
  remove: (id: string) => request<{ id: string }>('/provider-model/delete', { id }),
  requestRewriteRules: (providerModelId: string) => request<ProviderModelRequestRewriteRule[]>('/request-rewrite-rule/bindings', { providerModelId }),
  replaceRequestRewriteRules: (providerModelId: string, bindings: RequestRewriteRuleBindingInput[]) => request<ProviderModelRequestRewriteRule[]>('/request-rewrite-rule/replace-bindings', { providerModelId, bindings }),
}

/** 调度绑定同样按**数据记录 id** 寻址；模型名只在请求时用得到。 */
export const schedulingPolicyApi = {
  list: (logicalModelId?: string) => request<SchedulingPolicy[]>('/scheduling-policy/list', logicalModelId ? { logicalModelId } : {}),
  update: (data: SchedulingPolicyInput) => request<SchedulingPolicy>('/scheduling-policy/update', data),
  remove: (logicalModelId: string, providerModelId: string) => request<{ logicalModelId: string; providerModelId: string }>('/scheduling-policy/delete', { logicalModelId, providerModelId }),
}
