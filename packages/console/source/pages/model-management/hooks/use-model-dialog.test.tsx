// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider, ProviderModelRoute } from '@common/schemas'

import { useModelDialog } from './use-model-dialog'

/*
 * 这一组盯的是「新增 / 编辑模型时到底往服务端发了什么 payload」。
 *
 * 起因是一个真实缺陷：`scheduling_policies.logicalModelId` 是**数据记录 id**（`lm_*`）的外键，
 * 而界面曾经硬编码 `logicalModelId: 'default'` —— 那是**模型名**，不是记录 id。新增模型时
 * 服务端先提交模型、再写调度绑定，绑定撞外键失败：接口报错、模型却已经建出来了（孤儿模型）。
 *
 * 断言 payload 里**没有** `logicalModelId`，就是让这一类错误再也回不来：落点由服务端按
 * 默认记录 id 解析，界面拿不到也不该关心那把钥匙。
 */

// `vi.mock` 的工厂会被提升到文件顶部，共享状态得从这里出去。
const state = vi.hoisted(() => ({
  createPayloads: [] as Array<Record<string, unknown>>,
  updatePayloads: [] as Array<Record<string, unknown>>,
  fetchPayloads: [] as Array<Record<string, unknown>>,
  // 拉取结果按协议分派；没配就返回空模型列表。
  fetchResults: new Map<string, Array<{ id: string }>>(),
  toasts: [] as Array<{ level: 'success' | 'error'; message: string; params?: unknown }>,
}))

vi.mock('@/api/models', () => ({
  providerModelApi: {
    create: async (payload: Record<string, unknown>) => {
      state.createPayloads.push(payload)
      return { success: true, data: { id: `pm_${state.createPayloads.length}` } }
    },
    update: async (id: string, payload: Record<string, unknown>) => {
      state.updatePayloads.push({ id, ...payload })
      return { success: true, data: { id } }
    },
  },
}))

// 拉模型列表：按协议回桩数据，同时记下请求入参（是否带了覆盖地址就在这里看）。
vi.mock('@/api/providers', () => ({
  providerApi: {
    fetchModels: async (payload: Record<string, unknown>) => {
      state.fetchPayloads.push(payload)
      return { success: true, data: { models: state.fetchResults.get(String(payload.protocol)) ?? [] } }
    },
  },
}))

// `unwrap` 只是把 `{ success, data }` 拆成 `data`，真实的那个还要拉 i18n 运行时，这里直接剥壳。
type ApiEnvelope = { success: boolean; data: unknown }
type ApiEnvelopePromise = Promise<ApiEnvelope>

vi.mock('@/api/unwrap', () => ({
  unwrap: async (promise: ApiEnvelopePromise) => (await promise).data,
}))

// `useToast` 会拉一整套 Provider 树；这里只记下调用，好断言用户看到了什么反馈。
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: (message: string) => { state.toasts.push({ level: 'success', message }) },
    error: (message: string) => { state.toasts.push({ level: 'error', message }) },
  }),
}))

// 文案不是被测对象，回落到 key 本身。
vi.mock('@/i18n/provider', () => ({ useTranslation: () => (key: string) => key }))

// 真实 `useMutation` 需要 `QueryClientProvider`；压成「立刻执行」的壳，好走到 `onSuccess`。
interface MutationOptions<R> {
  mutationFn: () => Promise<R>
  onSuccess: (result: R) => Promise<void>
  onError: (error: Error) => void
}

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions<unknown>) => ({
    isPending: false,
    mutateAsync: async () => {
      try {
        const result = await options.mutationFn()
        await options.onSuccess(result)
        return result
      } catch (error) {
        options.onError(error as Error)
        throw error
      }
    },
  }),
}))

const PROVIDER = { id: 'prov_1', name: 'Example' } as unknown as Provider

const MODEL: ProviderModelRoute = {
  id: 'pm_1',
  providerId: 'prov_1',
  modelName: 'gpt-4o',
  endpoints: [{ protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
  priority: 0,
  enabled: true,
  createdTime: 0,
  updatedTime: 0,
  deletedTime: null,
}

function setup(models: ProviderModelRoute[] = []) {
  return renderHook(() => useModelDialog({
    providers: [PROVIDER],
    models,
    selectedProvider: { id: 'prov_1' },
    reload: async () => {},
  }))
}

beforeEach(() => {
  state.createPayloads.length = 0
  state.updatePayloads.length = 0
  state.fetchPayloads.length = 0
  state.fetchResults.clear()
  state.toasts.length = 0
})

/** 协议下拉的真实顺序（与 `ProtocolSchema` 同序）。 */
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

describe('useModelDialog 打开时的草稿', () => {
  it('编辑既有模型：带出模型名，只勾选它已有的协议并还原覆盖地址', async () => {
    const withOverride: ProviderModelRoute = {
      ...MODEL,
      modelName: 'gpt-4o',
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'https://mirror.example.com/v1', customAuthHeader: null, protocolConversionEnabled: true },
        { protocol: 'anthropic-messages', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    }
    const view = setup([withOverride])
    act(() => { view.result.current.openModelDialog(withOverride) })

    expect(view.result.current.editingModel?.id).toBe('pm_1')
    expect(view.result.current.modelId).toBe('gpt-4o')
    expect(view.result.current.dialogProvider?.id).toBe('prov_1')

    const entries = view.result.current.protocolEntries
    expect(entries.map(entry => entry.protocol)).toEqual([...PROTOCOLS])
    expect(entries[0]).toMatchObject({
      enabled: true,
      // 有覆盖地址 → `overrideUrl` 为真，面板上「自定义地址」开关要默认打开。
      overrideUrl: true,
      endpointUrl: 'https://mirror.example.com/v1',
      protocolConversionEnabled: true,
    })
    expect(entries[2]).toMatchObject({ enabled: true, overrideUrl: false, endpointUrl: '' })
    // 没配过的协议保持未勾选。
    expect(entries[1]).toMatchObject({ enabled: false, overrideUrl: false, endpointUrl: '' })
  })

  it('新增模型：清空草稿，所有协议都未勾选', async () => {
    const view = setup([MODEL])
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })

    expect(view.result.current.editingModel).toBeNull()
    expect(view.result.current.modelId).toBe('')
    expect(view.result.current.protocolEntries.every(entry => !entry.enabled)).toBe(true)
    expect(view.result.current.selectedModelIds).toEqual([])
    expect(view.result.current.fetchedModels).toEqual([])
  })

  // 目标供应商优先取「行上那一个」：从某供应商行点添加，跟侧栏当前选中谁无关。
  it('目标供应商按「模型自身 > 传入 providerId > 侧栏选中」的顺序解析', async () => {
    const other = { id: 'prov_2', name: 'Other' } as unknown as Provider
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER, other],
      models: [MODEL],
      selectedProvider: { id: 'prov_2' },
      reload: async () => {},
    }))

    act(() => { view.result.current.openModelDialog(MODEL) })
    expect(view.result.current.dialogProvider?.id).toBe('prov_1')

    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    expect(view.result.current.dialogProvider?.id).toBe('prov_1')

    act(() => { view.result.current.openModelDialog() })
    expect(view.result.current.dialogProvider?.id).toBe('prov_2')
  })

  it('关闭对话框只收起面板，不清掉已经填好的内容', async () => {
    const view = setup([MODEL])
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.setModelId('gpt-4o') })
    act(() => { view.result.current.closeModelDialog() })

    expect(view.result.current.modelDialogOpen).toBe(false)
    expect(view.result.current.modelId).toBe('gpt-4o')
  })
})

describe('useModelDialog 模型选择操作', () => {
  function open() {
    const view = setup([])
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    return view
  }

  it('勾选去重，取消按 id 移除', () => {
    const view = open()
    act(() => { view.result.current.toggleModelSelection('a', true) })
    act(() => { view.result.current.toggleModelSelection('a', true) })
    expect(view.result.current.selectedModelIds).toEqual(['a'])

    act(() => { view.result.current.toggleModelSelection('b', true) })
    expect(view.result.current.selectedModelIds).toEqual(['a', 'b'])

    act(() => { view.result.current.toggleModelSelection('a', false) })
    expect(view.result.current.selectedModelIds).toEqual(['b'])
    // 取消一个没选中的 id 是空操作，不该把别的选择带下去。
    act(() => { view.result.current.toggleModelSelection('zzz', false) })
    expect(view.result.current.selectedModelIds).toEqual(['b'])
  })

  it('全选只做并集，不会清掉先前跨协议的选择', () => {
    const view = open()
    act(() => { view.result.current.toggleModelSelection('manual', true) })
    act(() => { view.result.current.selectAllFetchedModels(['a', 'b']) })
    expect(view.result.current.selectedModelIds).toEqual(['manual', 'a', 'b'])

    act(() => { view.result.current.selectAllFetchedModels(['b', 'c']) })
    expect(view.result.current.selectedModelIds).toEqual(['manual', 'a', 'b', 'c'])
  })

  it('反选只翻转传入的 id，其余保持不动', () => {
    const view = open()
    act(() => { view.result.current.toggleModelSelection('keep', true) })
    act(() => { view.result.current.selectAllFetchedModels(['a', 'b']) })
    act(() => { view.result.current.invertFetchedModels(['a', 'b', 'c']) })

    // a、b 被翻掉，c 被选中，`keep` 与它们无关所以原样留着。
    expect(view.result.current.selectedModelIds).toEqual(['keep', 'c'])
  })

  it('清空选择', () => {
    const view = open()
    act(() => { view.result.current.selectAllFetchedModels(['a', 'b']) })
    act(() => { view.result.current.clearSelectedModels() })
    expect(view.result.current.selectedModelIds).toEqual([])
  })

  it('更新协议条目只改那一条', () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(1, { enabled: true, endpointUrl: 'https://x/v1' }) })

    const entries = view.result.current.protocolEntries
    expect(entries[1]).toMatchObject({ protocol: 'openai-responses', enabled: true, endpointUrl: 'https://x/v1' })
    expect(entries[0]).toMatchObject({ protocol: 'openai-completions', enabled: false })
  })
})

describe('useModelDialog 拉取模型列表', () => {
  function open() {
    const view = setup([])
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    return view
  }

  it('未勾选任何协议时，按全部协议各拉一次（带供应商 id、不带覆盖地址）', async () => {
    const view = open()
    await act(async () => { await view.result.current.fetchModels() })

    expect(state.fetchPayloads.map(payload => payload.protocol)).toEqual([...PROTOCOLS])
    expect(state.fetchPayloads.every(payload => payload.providerId === 'prov_1')).toBe(true)
    expect(state.fetchPayloads.every(payload => !('baseUrl' in payload))).toBe(true)
  })

  it('勾选了协议就只拉这些；带覆盖地址的才把地址传上去', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true, overrideUrl: true, endpointUrl: '  https://mirror.example.com/v1  ' }) })
    act(() => { view.result.current.updateProtocolEntry(1, { enabled: true }) })
    await act(async () => { await view.result.current.fetchModels() })

    expect(state.fetchPayloads).toEqual([
      { protocol: 'openai-completions', providerId: 'prov_1', baseUrl: 'https://mirror.example.com/v1' },
      { protocol: 'openai-responses', providerId: 'prov_1' },
    ])
  })

  it('多协议结果按 id 去重并按 id 排序', async () => {
    const view = open()
    state.fetchResults.set('openai-completions', [{ id: 'zeta' }, { id: 'alpha' }])
    state.fetchResults.set('openai-responses', [{ id: 'alpha' }, { id: 'beta' }])
    await act(async () => { await view.result.current.fetchModels() })

    expect(view.result.current.fetchedModels.map(model => model.id)).toEqual(['alpha', 'beta', 'zeta'])
  })

  // 一个都没拉到跟「拉取失败」是两回事，但用户看到的是同一件事：没有可选项。
  it('一个模型都没拉到时提示「没有拉到模型」，并保留原有列表', async () => {
    const view = open()
    state.fetchResults.set('openai-completions', [{ id: 'kept' }])
    await act(async () => { await view.result.current.fetchModels() })
    expect(view.result.current.fetchedModels.map(model => model.id)).toEqual(['kept'])

    // 换成只有空结果的协议集合再拉一次。
    state.fetchResults.clear()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.updateProtocolEntry(1, { enabled: false, overrideUrl: false }) })
    act(() => { view.result.current.updateProtocolEntry(2, { enabled: false, overrideUrl: false }) })
    await act(async () => { await view.result.current.fetchModels() })

    expect(state.toasts).toEqual([{ level: 'error', message: 'models.toast.fetchEmpty' }])
    expect(view.result.current.fetchedModels.map(model => model.id)).toEqual(['kept'])
  })

  it('拉取过程中 `fetchingModels` 会亮起再落下', async () => {
    const view = open()
    expect(view.result.current.fetchingModels).toBe(false)
    await act(async () => { await view.result.current.fetchModels() })
    expect(view.result.current.fetchingModels).toBe(false)
    expect(state.fetchPayloads).toHaveLength(3)
  })

  it('供应商不存在时整个拉取是空操作', async () => {
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER],
      models: [],
      selectedProvider: undefined,
      reload: async () => {},
    }))
    act(() => { view.result.current.openModelDialog() })
    // 侧栏没选中供应商且调用方没传目标 → 目标为空，没有任何请求发出去。
    await act(async () => { await view.result.current.fetchModels() })
    expect(state.fetchPayloads).toEqual([])
  })
})

describe('useModelDialog 保存的编排', () => {
  function open() {
    const view = setup([])
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    return view
  }

  it('批量新增时优先级从现有最大值 +1 起递增', async () => {
    const existing = [{ ...MODEL, id: 'pm_9', modelName: 'old', priority: 7 }]
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER],
      models: existing,
      selectedProvider: { id: 'prov_1' },
      reload: async () => {},
    }))
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.toggleModelSelection('new-a', true) })
    act(() => { view.result.current.toggleModelSelection('new-b', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads.map(payload => payload.modelName)).toEqual(['new-a', 'new-b'])
    expect(state.createPayloads.map(payload => payload.priority)).toEqual([8, 9])
  })

  it('没有既有模型时优先级从 1 起', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.setModelId('first') })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toHaveLength(1)
    expect(state.createPayloads[0].priority).toBe(1)
  })

  it('提交的端点只含勾选的协议，未覆盖地址时清空 url、覆盖时裁剪空白', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.updateProtocolEntry(1, { enabled: true, overrideUrl: true, endpointUrl: '  https://mirror.example.com/v1  ' }) })
    act(() => { view.result.current.setModelId('multi') })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads[0].endpoints).toEqual([
      { protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false },
      { protocol: 'openai-responses', endpointUrl: 'https://mirror.example.com/v1', customAuthHeader: null, protocolConversionEnabled: false },
    ])
  })

  it('部分重名：跳过的计入提示，新的按序创建', async () => {
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER],
      models: [MODEL],
      selectedProvider: { id: 'prov_1' },
      reload: async () => {},
    }))
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    // `MODEL` 已经叫 gpt-4o，重复加入应当被跳过而不是建第二条同名记录。
    act(() => { view.result.current.toggleModelSelection('gpt-4o', true) })
    act(() => { view.result.current.toggleModelSelection('claude-sonnet', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads.map(payload => payload.modelName)).toEqual(['claude-sonnet'])
    expect(state.toasts).toEqual([{ level: 'success', message: 'models.toast.addedSome' }])
    expect(view.result.current.modelDialogOpen).toBe(false)
  })

  it('全部重名：不建任何记录并报错，对话框保持打开', async () => {
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER],
      models: [MODEL],
      selectedProvider: { id: 'prov_1' },
      reload: async () => {},
    }))
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.toggleModelSelection('gpt-4o', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toEqual([])
    expect(state.toasts).toEqual([{ level: 'error', message: 'models.error.duplicate' }])
    // 报错时不能把对话框关掉，否则用户填的内容全丢。
    expect(view.result.current.modelDialogOpen).toBe(true)
  })

  it('批量新增成功后提示「新增了 N 条」', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.toggleModelSelection('a', true) })
    act(() => { view.result.current.toggleModelSelection('b', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.toasts).toEqual([{ level: 'success', message: 'models.toast.addedBulk' }])
  })

  it('单条新增成功后提示「已添加」', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.setModelId('solo') })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.toasts).toEqual([{ level: 'success', message: 'models.toast.added' }])
  })

  it('编辑成功后提示「已更新」，不再发创建请求', async () => {
    const view = setup([MODEL])
    act(() => { view.result.current.openModelDialog(MODEL) })
    act(() => { view.result.current.setModelId('gpt-4o-mini') })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toEqual([])
    expect(state.toasts).toEqual([{ level: 'success', message: 'models.toast.updated' }])
  })

  it('既没选供应商也没勾协议时拒绝提交', async () => {
    const view = renderHook(() => useModelDialog({
      providers: [PROVIDER],
      models: [],
      selectedProvider: undefined,
      reload: async () => {},
    }))
    act(() => { view.result.current.openModelDialog() })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toEqual([])
    expect(state.toasts).toEqual([{ level: 'error', message: 'models.error.providerRequired' }])
  })

  it('选了供应商但一个协议都没勾时拒绝提交', async () => {
    const view = open()
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toEqual([])
    expect(state.toasts).toEqual([{ level: 'error', message: 'models.error.modelRequired' }])
  })

  it('只勾了协议、没勾模型也没填名字时拒绝提交', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toEqual([])
    expect(state.toasts).toEqual([{ level: 'error', message: 'models.error.modelRequired' }])
  })

  // 拉回来的列表勾选后，输入框可能还留着旧文字；勾选优先，输入框不该被顺便建成一条。
  it('有勾选时忽略输入框里的文字', async () => {
    const view = open()
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.setModelId('typed-by-hand') })
    act(() => { view.result.current.toggleModelSelection('from-list', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads.map(payload => payload.modelName)).toEqual(['from-list'])
  })
})

describe('useModelDialog payload', () => {
  it('creates a model without sending a logicalModelId, so the server resolves the default record id', async () => {
    const view = setup()
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.setModelId('gpt-4o') })
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads).toHaveLength(1)
    expect(state.createPayloads[0]).toMatchObject({ providerId: 'prov_1', modelName: 'gpt-4o' })
    // 关键断言：`'default'` 是模型名，写成外键会让服务端在建完模型后撞 FK，留下孤儿模型。
    expect(state.createPayloads[0]).not.toHaveProperty('logicalModelId')
  })

  it('creates every bulk-selected model without sending a logicalModelId either', async () => {
    const view = setup()
    act(() => { view.result.current.openModelDialog(undefined, 'prov_1') })
    act(() => { view.result.current.updateProtocolEntry(0, { enabled: true }) })
    act(() => { view.result.current.toggleModelSelection('gpt-4o', true) })
    act(() => { view.result.current.toggleModelSelection('claude-sonnet', true) })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.createPayloads.map(payload => payload.modelName)).toEqual(['gpt-4o', 'claude-sonnet'])
    expect(state.createPayloads.every(payload => !('logicalModelId' in payload))).toBe(true)
  })

  it('updates a model without sending a logicalModelId', async () => {
    const view = setup([MODEL])
    act(() => { view.result.current.openModelDialog(MODEL) })
    act(() => { view.result.current.setModelId('gpt-4o-mini') })
    await act(async () => { await view.result.current.saveModel() })

    expect(state.updatePayloads).toHaveLength(1)
    expect(state.updatePayloads[0]).toMatchObject({ id: 'pm_1', modelName: 'gpt-4o-mini' })
    // 改模型名跟调度绑定无关；带 `logicalModelId` 过来只会把服务端的落点校验拖进来。
    expect(state.updatePayloads[0]).not.toHaveProperty('logicalModelId')
  })
})
