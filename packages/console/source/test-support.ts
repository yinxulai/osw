/**
 * 控制台单测的共用夹具。
 *
 * 数据层（`data/*`）与页面里的 hook 都建立在 react-query 之上：没有 `QueryClientProvider`
 * 的树里它们会直接抛错，而每个用例各写一遍 `new QueryClient(...)` 又会让「重试几次、
 * 多久算过期」这类设定散落各处——某天改一处默认值，别处的用例就会开始等重试的超时。
 *
 * 文件名带上 `test-support` 是约定：`packages/toolkit/vitest.config.ts` 的覆盖率 `exclude`
 * 按这个名字把它排除。夹具里没有「被测的行」，算进分母只会让数字失真。
 */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LogicalModel, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'

/**
 * 建一个只属于当前用例的 `QueryClient`。
 *
 * `retry: false`：这些用例断言的正是「请求失败之后界面是什么样」。真实配置里的重试会把
 * `isPending` 拉长好几秒，失败原因也被重试掩盖，用例只能靠等——那等于把「有没有失败态」
 * 测成了「等得够不够久」。
 *
 * `gcTime: Infinity`：查询在没人观察时会被回收，而多个 `renderHook` 实例之间要靠缓存传递
 * 状态（例如先挂列表、再挂操作、最后回头读同一个 key），回收会把它悄悄丢掉。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

interface QueryWrapperProps { children: ReactNode }

/** 把 `QueryClientProvider` 包成 `renderHook` / `render` 能用的 `wrapper`。 */
export function createQueryWrapper(client: QueryClient) {
  return function QueryWrapper(props: QueryWrapperProps) {
    return createElement(QueryClientProvider, { client }, props.children)
  }
}

/** 建一个「客户端 + wrapper」的组合，省掉每个用例里两行样板。 */
export function createQueryFixture(): { client: QueryClient; wrapper: ReturnType<typeof createQueryWrapper> } {
  const client = createQueryClient()
  return { client, wrapper: createQueryWrapper(client) }
}

/** 手动的 Promise 闸门：让用例精确控制「接口还没返回」的那一段。 */
export function createGate<Value>() {
  let open: (value: Value) => void = () => undefined
  let fail: (error: unknown) => void = () => undefined
  const promise = new Promise<Value>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { promise, open, fail }
}

/**
 * 下面几个构造器只做一件事：把**必填字段**填齐。
 *
 * 数据层的用例关心的是「这几个函数把哪些字段读了、组合成什么」，不是 schema 校验，
 * 所以每个用例只覆写它真正在意的那一两个字段，剩下的留默认值。
 */

export function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_primary',
    name: 'Primary',
    enabled: true,
    apiKeyReference: 'providers/prov_primary/apiKey',
    timeoutMilliseconds: 30_000,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

export function logicalModel(overrides: Partial<LogicalModel> = {}): LogicalModel {
  return {
    id: 'lm_primary',
    modelId: 'gpt-5',
    description: '',
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

export function providerHealth(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    providerId: 'prov_primary',
    consecutiveFailures: 0,
    cooldownUntilTime: null,
    lastSuccessTime: null,
    lastFailureTime: null,
    updatedTime: 1,
    ...overrides,
  }
}

export function providerModelHealth(overrides: Partial<ProviderModelHealth> = {}): ProviderModelHealth {
  return {
    providerModelId: 'pm_primary',
    consecutiveFailures: 0,
    cooldownUntilTime: null,
    lastSuccessTime: null,
    lastFailureTime: null,
    updatedTime: 1,
    ...overrides,
  }
}
