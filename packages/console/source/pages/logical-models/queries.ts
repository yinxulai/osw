import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { logicalModelRoutingApi } from '@/api/runtime'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { calculateProviderModelMetrics, calculateLogicalModelSummaryMetrics } from './lib/model-metrics'

type UpdateProviderModelVariables = { id: string; enabled: boolean }

/**
 * 逻辑模型被两把钥匙指着，这里把它们绑在一起传。
 *
 *   - `id`：**数据记录 id**（`lm_*`）—— 调度绑定的外键。
 *   - `modelId`：**模型 id** —— 请求里的模型名，手动锁定与请求日志按它寻址。
 *
 * `LogicalModel` 天然满足这个形状，调用方直接把整条记录传进来即可。
 * 分开传两个裸 string 的写法看起来很简洁，但两个参数同型同序、写反了不会报错 ——
 * 那正是这次要消掉的一类 bug。
 */
export interface LogicalModelKeysRef {
  readonly id: string
  readonly modelId: string
}

/**
 * 还没拿到逻辑模型（列表未就绪）时的占位引用。
 *
 * 用同一份常量而不是每次现造一个字面量：挂钩子时它会进依赖数组，现造的话每次渲染
 * 都是新引用，会让下游的 `useCallback` / `useEffect` 白跑一轮。
 * 带着它发请求的两个查询都被 `enabled: false` 关了，所以空串不会被当成真 id 发出去。
 */
export const EMPTY_LOGICAL_MODEL_REF: LogicalModelKeysRef = { id: '', modelId: '' }

/**
 * 缓存键一律用**数据记录 id**。
 *
 * 键回答的是「这份数据是谁的」，而身份是不变的那把钥匙：模型名可以被改，改完不该
 * 变成一个不同的缓存条目（那会让旧条目里的手动锁定状态凭空消失）。
 */
export const logicalModelKeys = {
  models: (logicalModelRecordId: string) => ['logical-model-provider-models', logicalModelRecordId] as const,
  mode: (logicalModelRecordId: string) => ['logical-model-routing-mode', logicalModelRecordId] as const,
  metrics: (logicalModelRecordId: string) => ['logical-model-metrics', logicalModelRecordId] as const,
}

/** 绑定列表按**数据记录 id** 查；`null` 表示还没拿到这条逻辑模型（列表未就绪）。 */
export const useLogicalModelProviderModelsQuery = (logicalModel: LogicalModelKeysRef | null) => useQuery({
  queryKey: logicalModelKeys.models(logicalModel?.id ?? ''),
  queryFn: async () => unwrap(providerModelApi.listByLogicalModel(logicalModel!.id)),
  enabled: logicalModel !== null,
  refetchInterval: 30_000,
})

/** 手动锁定是运行时的东西，按**模型 id**（请求里的模型名）问。 */
export const useLogicalModelModeQuery = (logicalModel: LogicalModelKeysRef | null) => useQuery({
  queryKey: logicalModelKeys.mode(logicalModel?.id ?? ''),
  queryFn: async () => unwrap(logicalModelRoutingApi.status(logicalModel!.modelId)),
  enabled: logicalModel !== null,
  refetchInterval: 5_000,
})

/** 请求日志里记的是当时那个模型名，所以这里也按**模型 id** 过滤。 */
export const useLogicalModelMetricsQuery = (logicalModel: LogicalModelKeysRef | null) => useQuery({
  queryKey: logicalModelKeys.metrics(logicalModel?.id ?? ''),
  queryFn: async () => {
    const data = await unwrap(requestLogApi.list({ limit: 100, logicalModelId: logicalModel!.modelId }))
    return { modelMetrics: calculateProviderModelMetrics(data.logs), summaryMetrics: calculateLogicalModelSummaryMetrics(data.logs) }
  },
  enabled: logicalModel !== null,
  refetchInterval: 5_000,
})

export function useSwitchManualModelMutation(logicalModel: LogicalModelKeysRef) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string | null) => unwrap(logicalModelRoutingApi.switch(logicalModel.modelId, modelId)),
    onSuccess: data => client.setQueryData(logicalModelKeys.mode(logicalModel.id), {
      logicalModelId: data.logicalModelId,
      manualModelId: data.modelId,
    }),
  })
}

export function useUpdateProviderModelMutation(logicalModel: LogicalModelKeysRef) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: UpdateProviderModelVariables) => unwrap(schedulingPolicyApi.update({ logicalModelId: logicalModel.id, providerModelId: id, enabled })),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: logicalModelKeys.models(logicalModel.id) }),
        client.invalidateQueries({ queryKey: ['provider-models'] }),
      ])
    },
  })
}
