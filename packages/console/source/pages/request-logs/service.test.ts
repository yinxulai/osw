// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveRequest, LogicalModel, Provider, RequestLogEntry } from '@common/schemas'
import { createQueryFixture } from '@/test-support'
import { useRequestLogsService } from '@/pages/request-logs/service'
import { useRequestLogsUiStore } from '@/pages/request-logs/store'

/*
 * 请求日志页的装配层。
 *
 * 这一层不画东西、也不发请求，它做的是「把三个来源拼成一张表」：
 * 落库的记录、内存台账、以及各种下拉的选项。最容易错的三处：
 *
 * 1. **台账的补入受页号与筛选约束**。筛选是用户明确说出来的范围，补一行等于绕过它。
 * 2. **同一个 id 的行要换成实时视图**，但只要它真的落定了就得换回落库那一份。
 * 3. **详情只在展开时取**，而且展开的那一条还在跑时连取都不该取（台账里数据更全）。
 */

const list = vi.fn()
const detail = vi.fn()
const bodies = vi.fn()
const providerModelList = vi.fn()

vi.mock('@/api/observability', () => ({
  requestLogApi: {
    list: (...args: unknown[]) => list(...args),
    detail: (...args: unknown[]) => detail(...args),
    bodies: (...args: unknown[]) => bodies(...args),
  },
}))

vi.mock('@/api/models', () => ({
  providerModelApi: { list: () => providerModelList() },
}))

/** 台账来自一条推送流，这里只替换数据的来源，不管它是怎么来的。 */
const live = { requests: [] as LiveRequest[] }
vi.mock('@/data/live-requests', () => ({
  useLiveRequests: () => ({ data: live.requests }),
}))

const models = { list: [] as LogicalModel[], deleted: new Set<string>() }
vi.mock('@/data/logical-models', () => ({
  useLogicalModels: () => models.list,
  useDeletedLogicalModelIds: () => models.deleted,
}))

const providers = { list: [] as Provider[] }
vi.mock('@/data/providers', () => ({
  useProviders: () => providers.list,
}))

function ok<Data>(data: Data) {
  return { success: true as const, data }
}

function logEntry(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return { id: 'log_1', status: 'success', createdTime: 1, ...overrides } as RequestLogEntry
}

function liveRequest(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'live_1',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: null,
    clientProtocol: null,
    transport: 'http',
    method: 'POST',
    path: '/v1/chat/completions',
    startedAt: 1,
    updatedAt: 1,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

const initialFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

function mount() {
  const fixture = createQueryFixture()
  return { ...fixture, ...renderHook(() => useRequestLogsService(), { wrapper: fixture.wrapper }) }
}

beforeEach(() => {
  list.mockReset()
  detail.mockReset()
  bodies.mockReset()
  providerModelList.mockReset()
  // 默认值放在这里而不是 `mount()` 里：用例会在挂载**之前**改自己的返回值，
  // 挂载时再写一遍默认值会把它们盖掉（而「接口返回了什么」正是这些用例的唯一变量）。
  list.mockResolvedValue(ok({ logs: [], total: 0 }))
  detail.mockResolvedValue(ok({ id: 'log_1' }))
  bodies.mockResolvedValue(ok({}))
  providerModelList.mockResolvedValue(ok([]))
  live.requests = []
  models.list = []
  models.deleted = new Set<string>()
  providers.list = []
  useRequestLogsUiStore.setState({ page: 1, expandedId: null, filter: initialFilter })
})

describe('行的合成', () => {
  it('第一页没有筛选时，台账里已经开跑但还没落库的请求补在最前面', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_1' })], total: 1 }))
    live.requests = [liveRequest({ id: 'live_1' })]
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.rows[0]).toMatchObject({ kind: 'execution' })
    expect(result.current.rows[1]).toMatchObject({ kind: 'log' })
    expect(result.current.total).toBe(1)
  })

  it('同一个 id 的行在执行时换成实时视图（列表只有一张，不跳走）', async () => {
    // 翻到第 2 页：补入被关掉，但「同 id 换视图」仍然生效。
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_1', status: 'pending' })], total: 21 }))
    live.requests = [liveRequest({ id: 'log_1' })]
    useRequestLogsUiStore.setState({ page: 2 })
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.rows[0].kind).toBe('execution')
  })

  it('已经落定的行换回落库那一份（台账里的残影不能盖住最终事实）', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_1', status: 'success' })], total: 1 }))
    live.requests = [liveRequest({ id: 'log_1', status: 'success' })]
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.rows[0].kind).toBe('log')
  })

  it('筛过之后不再补入台账（按「失败」筛选却冒出进行中的请求是绕过筛选）', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_1' })], total: 1 }))
    live.requests = [liveRequest({ id: 'live_1' })]
    useRequestLogsUiStore.setState({ filter: { ...initialFilter, status: 'failed' } })
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.rows[0].kind).toBe('log')
    expect(result.current.filtered).toBe(true)
  })

  it('翻到第 2 页后也不补入（补进去的行不在这一页里）', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_21' })], total: 21 }))
    live.requests = [liveRequest({ id: 'live_1' })]
    useRequestLogsUiStore.setState({ page: 2 })
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.rows[0].kind).toBe('log')
    expect(result.current.filtered).toBe(false)
  })
})

describe('模型名与删除标记', () => {
  it('模型名为空时显示占位符', async () => {
    const { result } = mount()
    expect(result.current.getModelName(null)).toBe('—')
  })

  it('模型名按 modelId 反查（日志里记的是请求当时的名字）', async () => {
    models.list = [{ id: 'lm_1', modelId: 'gpt-5', description: '', enabled: true, createdTime: 1, updatedTime: 1, deletedTime: null }]
    const { result } = mount()

    await waitFor(() => expect(models.list).toHaveLength(1))
    expect(result.current.getModelName('gpt-5')).toBe('gpt-5')
  })

  it('查不到配置时原样显示那个名字（历史记录不能被抹成「未知」）', async () => {
    const { result } = mount()
    expect(result.current.getModelName('legacy-model')).toBe('legacy-model')
  })

  it('名字对得上一条已删除的配置时标出来', async () => {
    models.deleted = new Set(['retired-model'])
    const { result } = mount()

    await waitFor(() => expect(result.current.isModelDeleted('retired-model')).toBe(true))
    expect(result.current.isModelDeleted('gpt-5')).toBe(false)
    expect(result.current.isModelDeleted(null)).toBe(false)
  })
})

describe('下拉选项', () => {
  it('供应商按名字排序，模型选项拼成「供应商 / 模型」并排序', async () => {
    providers.list = [
      { id: 'prov_b', name: 'Beta', enabled: true, apiKeyReference: 'k', timeoutMilliseconds: 1, createdTime: 1, updatedTime: 1, deletedTime: null },
      { id: 'prov_a', name: 'Alpha', enabled: true, apiKeyReference: 'k', timeoutMilliseconds: 1, createdTime: 1, updatedTime: 1, deletedTime: null },
    ]
    providerModelList.mockResolvedValue(ok([
      { id: 'pm_1', providerId: 'prov_b', modelName: 'zzz' },
      { id: 'pm_2', providerId: 'prov_a', modelName: 'aaa' },
    ]))
    const { result } = mount()

    await waitFor(() => expect(result.current.providerModelOptions).toHaveLength(2))
    expect(result.current.providerOptions.map(option => option.name)).toEqual(['Alpha', 'Beta'])
    expect(result.current.providerModelOptions).toEqual([
      { id: 'pm_2', name: 'Alpha / aaa' },
      { id: 'pm_1', name: 'Beta / zzz' },
    ])
  })

  it('供应商还没取回来时退回 id，不让选项变成「undefined / 模型名」', async () => {
    providerModelList.mockResolvedValue(ok([{ id: 'pm_9', providerId: 'prov_gone', modelName: 'm' }]))
    const { result } = mount()

    await waitFor(() => expect(result.current.providerModelOptions).toHaveLength(1))
    expect(result.current.providerModelOptions[0].name).toBe('prov_gone / m')
  })
})

describe('详情', () => {
  it('没有展开任何一行时，详情、加载中、错误三份映射都是空的', async () => {
    const { result } = mount()

    expect(result.current.details).toEqual({})
    expect(result.current.detailLoadingIds).toEqual({})
    expect(result.current.detailErrors).toEqual({})
    expect(detail).not.toHaveBeenCalled()
  })

  it('展开落库的行时按 id 取详情，取回之前先标「加载中」', async () => {
    detail.mockResolvedValue(ok({ id: 'log_5', status: 'success' }))
    const { result } = mount()

    act(() => result.current.loadDetail('log_5'))

    expect(result.current.detailLoadingIds).toEqual({ log_5: true })
    await waitFor(() => expect(result.current.details.log_5).toBeTruthy())
    expect(detail).toHaveBeenCalledWith('log_5')
    expect(result.current.detailLoadingIds).toEqual({})
  })

  it('展开的这一行还在跑时连详情都不取（台账里的实时数据更全）', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_1', status: 'pending' })], total: 1 }))
    live.requests = [liveRequest({ id: 'log_1' })]
    const { result } = mount()

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    act(() => result.current.loadDetail('log_1'))

    expect(detail).not.toHaveBeenCalled()
    expect(result.current.details).toEqual({})
  })

  it('详情失败时把错误挂到那一行上（表格不会整页变成错误态）', async () => {
    detail.mockResolvedValue({ success: false, errorMessage: '记录已过期' })
    const { result } = mount()

    act(() => result.current.loadDetail('log_3'))

    await waitFor(() => expect(result.current.detailErrors.log_3).toBe('记录已过期'))
  })
})

describe('列表状态与操作', () => {
  it('列表失败时给出字符串错误（渲染层不该看到异常对象）', async () => {
    list.mockRejectedValue('断网了')
    const { result } = mount()

    await waitFor(() => expect(result.current.error).toBe('断网了'))
  })

  it('刷新失效当前页与当前筛选那一个查询', async () => {
    list.mockResolvedValue(ok({ logs: [], total: 0 }))
    const { result, client } = mount()
    const spy = vi.spyOn(client, 'invalidateQueries')

    await act(async () => { result.current.refresh() })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['request-logs', initialFilter, 1] })

    await act(async () => { result.current.refresh(4) })
    expect(spy).toHaveBeenLastCalledWith({ queryKey: ['request-logs', initialFilter, 4] })
  })

  it('改筛选条件时回到第 1 页并收起详情（不然详情讲的是已被筛掉的那条）', async () => {
    const { result } = mount()

    act(() => result.current.loadDetail('log_1'))
    act(() => result.current.goToPage(3))
    act(() => result.current.setFilter({ status: 'failed' }))

    expect(result.current.page).toBe(1)
    expect(result.current.expandedId).toBeNull()
    expect(result.current.filter.status).toBe('failed')
    // 改一项不该把别的项清掉。
    expect(result.current.filter.providerId).toBe('all')
  })

  it('加载态与后台重取态分开（重取时不该把表格换成骨架）', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry()], total: 1 }))
    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.refreshing).toBe(false)
  })
})
