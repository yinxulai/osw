import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { providerModelApi, requestRewriteRuleApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { boundRuleNames, buildBoundRules, pickAvailableRules, toBindingInput } from '@/lib/rule-bindings'
import type { BoundRule } from '@/lib/rule-bindings'
import type { RequestRewriteRule } from '@common/schemas'

export const ruleBindingKeys = {
  all: ['request-rewrite-rule-bindings'] as const,
  ofModel: (providerModelId: string) => ['request-rewrite-rule-bindings', providerModelId] as const,
}

/**
 * 一个供应商模型上绑了哪些规则：完整载荷（全部规则 + 这个模型的绑定）。
 *
 * 此前这段取数在 `provider-model-row.tsx` 和 `provider-rule-bindings.tsx` 里各写了
 * 一份 `useEffect` + `Promise.all`。两处都因此必须认识 API：知道有两个接口、知道要
 * 并行、知道返回体是 `success` 包装。这些都不属于渲染。
 *
 * 两个组件读同一个缓存键，所以同一屏里不会为同一条数据发两次请求。
 */
export function useModelRuleBindingsData(providerModelId: string) {
  return useQuery({
    queryKey: ruleBindingKeys.ofModel(providerModelId),
    queryFn: async () => {
      const [allRules, bindings] = await Promise.all([
        unwrap(requestRewriteRuleApi.list()),
        unwrap(providerModelApi.requestRewriteRules(providerModelId)),
      ])
      return { allRules, bindings }
    },
    // 绑定会在规则编辑器里被改（删规则、改作用域），跟着重新取一次比让用户手动刷新
    // 更省事；10 秒足以挡住同一屏里反复挂载的行。
    staleTime: 10_000,
  })
}

/** 空数组要有稳定引用，否则每次渲染都是新值，消费方的 memo 全废。 */
const EMPTY_NAMES: string[] = []
const EMPTY_BOUND_RULES: BoundRule[] = []
const EMPTY_RULES: RequestRewriteRule[] = []

/** 列表行只要名字做徽标：从上面那条查询里裁出来，不额外发请求。 */
export function useModelRuleBindingNames(providerModelId: string): string[] {
  const query = useModelRuleBindingsData(providerModelId)
  const data = query.data
  return useMemo(
    () => (data ? boundRuleNames(data.allRules, data.bindings) : EMPTY_NAMES),
    [data],
  )
}

/** 绑定表需要的四样东西：画出来的行、可添加的候选、加载中、加载失败原因。 */
export interface BoundRulesView {
  rules: BoundRule[]
  availableRules: RequestRewriteRule[]
  loading: boolean
  /**
   * 失败原因，`null` 表示没失败。
   *
   * 空字符串表示「确实失败了，但拿不到原因」——这两件事不能混成同一个值：前者要
   * 显示「加载失败」，后者要显示「加载失败」再加一句兜底文案。具体兜底成哪句话是
   * 界面的事（这一层没有语言），所以这里不替它决定。
   */
  error: string | null
}

/**
 * 绑定表的数据源。
 *
 * 「全局规则永远排第一」「已绑的不进候选」「规则本体停用时绑定也不生效」都判断在
 * `lib/rule-bindings.ts` 里，因为它们是业务规则而不是排版偏好：全局规则由匹配条件
 * 命中，不受这个模型的优先级影响。这里只负责把结果接上加载状态。
 */
export function useBoundRules(providerModelId: string): BoundRulesView {
  const query = useModelRuleBindingsData(providerModelId)
  const data = query.data
  const rules = useMemo(() => (data ? buildBoundRules(data) : EMPTY_BOUND_RULES), [data])
  const availableRules = useMemo(() => (data ? pickAvailableRules(data) : EMPTY_RULES), [data])
  return {
    rules,
    availableRules,
    loading: query.isPending,
    error: errorMessageOf(query.error),
  }
}

/**
 * 把抛出物折成一句话。
 *
 * 只有 `Error` 的 `message` 是给用户看的（`unwrap` 抛的就是它）。字符串、对象、数字
 * 都可能被谁随手扔进来，但它们不是文案，直接显示等于把内部实现的碎片丢到界面上。
 * 折不出来时返回空串而不是 `null`：`null` 已经表示「没失败」，混用会让界面把它当成
 * 成功。
 */
function errorMessageOf(error: unknown): string | null {
  if (error === null || error === undefined) return null
  return error instanceof Error ? error.message : ''
}

/**
 * 保存绑定。
 *
 * 调用方已经在本地改好了顺序；这里按下标连续编号，让「表里看到的顺序」与「实际生效的
 * 优先级」是同一件事。全局规则不是这个模型的绑定，发上去服务端会拒，所以先剔掉。
 */
export async function saveProviderModelRuleBindings(providerModelId: string, rules: readonly BoundRule[]) {
  await unwrap(providerModelApi.replaceRequestRewriteRules(providerModelId, toBindingInput(rules)))
}
