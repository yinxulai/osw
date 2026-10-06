// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { PAGE_SIZE, fetchRequestLogBodies, useRequestLogBodiesQuery, useRequestLogDetailQuery, useRequestLogsQuery } from '@/pages/request-logs/queries'
import { createQueryFixture } from '@/test-support'
import type { RequestLogEntry } from '@common/schemas'

/*
 * 请求记录的数据获取层。
 *
 * 这一层做四件事，每件都有代价很高的错法：
 *  1. 把筛选翻译成接口参数——**默认值不入参**（`all` / `null` 表示「没筛」，
 *     把它们当值发出去会让服务端按字面量 `all` 去查，结果永远是空）；
 *  2. 分页是 offset/limit，页号换算错一位就永远看不到第一条；
 *  3. 失败要抛错（而不是回一份空数据，那样界面会显示「没有记录」——是个谎）；
 *  4. 正文按需取（库里最大的列，详情在流式期间每 1.5s 轮询一次）。
 */

const list = vi.fn()
const detail = vi.fn()
const bodies = vi.fn()

vi.mock('@/api/observability', () => ({
  requestLogApi: {
    list: (...args: unknown[]) => list(...args),
    detail: (...args: unknown[]) => detail(...args),
    bodies: (...args: unknown[]) => bodies(...args),
  },
}))

function ok<Data>(data: Data) {
  return { success: true as const, data }
}

function fail(errorMessage: string) {
  return { success: false as const, errorMessage }
}

const noFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

function logEntry(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'log_1',
    status: 'success',
    createdTime: 1,
    ...overrides,
  } as RequestLogEntry
}

/** 读回某个查询实际生效的「要不要轮询」，而不是只看数据长什么样。 */
function pollingInterval(client: ReturnType<typeof createQueryFixture>['client'], keyPart: string): unknown {
  const query = client.getQueryCache().getAll().find(entry => JSON.stringify(entry.queryKey).includes(keyPart))
  const option = query?.options.refetchInterval
  return typeof option === 'function' ? (option as (q: typeof query) => unknown)(query) : option
}

describe('请求记录列表查询', () => {
  it('第 1 页从 offset 0 开始，条数固定为一页', async () => {
    list.mockResolvedValue(ok({ logs: [logEntry()], total: 1 }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 1), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())

    expect(list).toHaveBeenCalledWith({ limit: PAGE_SIZE, offset: 0 })
  })

  it('页号换算成 offset（第 3 页从第 2 页末尾之后开始）', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [], total: 0 }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 3), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(list).toHaveBeenCalledWith({ limit: PAGE_SIZE, offset: PAGE_SIZE * 2 })
  })

  it('默认值不入参：没筛的维度不出现在请求里', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [], total: 0 }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const params = list.mock.calls[0][0] as Record<string, unknown>
    expect(params).not.toHaveProperty('providerId')
    expect(params).not.toHaveProperty('providerModelId')
    expect(params).not.toHaveProperty('logicalModelId')
    expect(params).not.toHaveProperty('clientProtocol')
    expect(params).not.toHaveProperty('status')
    // 时间范围默认 null（不是 0）——0 会被服务端当成「从 1970 年起」，那是个真实的筛选条件。
    expect(params).not.toHaveProperty('createdTimeFrom')
    expect(params).not.toHaveProperty('createdTimeTo')
  })

  it('筛过的维度如实入参（客户端协议与服务端同名，都是 clientProtocol）', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [], total: 0 }))
    const { wrapper } = createQueryFixture()

    const filter = {
      ...noFilter,
      providerId: 'prov_1',
      providerModelId: 'pm_1',
      logicalModelId: 'lm_1',
      clientProtocol: 'openai-completions',
      status: 'failed',
      createdTimeFrom: 1_700_000_000_000,
      createdTimeTo: 1_700_100_000_000,
    }
    const { result } = renderHook(() => useRequestLogsQuery(filter, 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // 客户端协议的参数名与服务端 ListRequestLogsSchema 一致，叫 `clientProtocol`。
    expect(list).toHaveBeenCalledWith({
      limit: PAGE_SIZE,
      offset: 0,
      providerId: 'prov_1',
      providerModelId: 'pm_1',
      logicalModelId: 'lm_1',
      clientProtocol: 'openai-completions',
      status: 'failed',
      createdTimeFrom: 1_700_000_000_000,
      createdTimeTo: 1_700_100_000_000,
    })
  })

  it('接口报错时把错误抛出来（而不是回一份空列表——那会显示成「没有记录」）', async () => {
    list.mockReset()
    list.mockResolvedValue(fail('观测库被占用'))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 1), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('观测库被占用')
  })

  it('翻页时保留上一页数据（占位数据），列表不会先清空再填', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [logEntry({ id: 'log_p1' })], total: 40 }))
    const { wrapper } = createQueryFixture()

    const { result, rerender } = renderHook(({ page }) => useRequestLogsQuery(noFilter, page), {
      wrapper,
      initialProps: { page: 1 },
    })
    await waitFor(() => expect(result.current.data?.logs).toHaveLength(1))

    rerender({ page: 2 })

    // 第二页还在路上，这里仍然能看到第一页的内容。
    expect(result.current.data?.logs[0].id).toBe('log_p1')
  })

  it('这一页有执行中的请求时按 1.5s 轮询（否则用户看不出它什么时候结束）', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [logEntry({ status: 'pending' })], total: 1 }))
    const { wrapper, client } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(pollingInterval(client, 'request-logs')).toBe(1_500)
  })

  it('没有执行中的请求时不轮询（已结束的页没必要反复取）', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [logEntry({ status: 'success' })], total: 1 }))
    const { wrapper, client } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogsQuery(noFilter, 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(pollingInterval(client, 'request-logs')).toBe(false)
  })

  it('筛选与页号都进查询键（换筛选不能复用上一份缓存）', async () => {
    list.mockReset()
    list.mockResolvedValue(ok({ logs: [], total: 0 }))
    const { wrapper, client } = createQueryFixture()

    const { result, rerender } = renderHook(({ filter }) => useRequestLogsQuery(filter, 1), {
      wrapper,
      initialProps: { filter: noFilter },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ filter: { ...noFilter, status: 'failed' } })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    const keys = client.getQueryCache().getAll().map(query => JSON.stringify(query.queryKey))
    expect(keys.some(key => key.includes('failed'))).toBe(true)
    expect(keys.some(key => key.includes('"all"'))).toBe(true)
  })
})

describe('请求详情查询', () => {
  it('没有展开的行时一次都不请求', () => {
    detail.mockReset()
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogDetailQuery(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(detail).not.toHaveBeenCalled()
  })

  it('展开落库的行时按 id 取详情', async () => {
    detail.mockReset()
    detail.mockResolvedValue(ok({ id: 'log_1', status: 'success' }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogDetailQuery('log_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())

    expect(detail).toHaveBeenCalledWith('log_1')
  })

  it('展开的这一行还在执行时被关掉（台账里有更全的实时数据，再轮询库里的半成品是浪费）', async () => {
    detail.mockReset()
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogDetailQuery('log_1', false), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(detail).not.toHaveBeenCalled()
  })

  it('详情失败时把错误抛出来', async () => {
    detail.mockReset()
    detail.mockResolvedValue(fail('记录已过期'))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogDetailQuery('log_2'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('记录已过期')
  })
})

describe('请求正文查询', () => {
  it('没打开正文面板时不请求（正文是库里最大的列）', () => {
    bodies.mockReset()
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogBodiesQuery(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(bodies).not.toHaveBeenCalled()
  })

  it('打开时按 id 取正文', async () => {
    bodies.mockReset()
    bodies.mockResolvedValue(ok({ request: {}, response: {} }))
    const { wrapper } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogBodiesQuery('log_9'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())

    expect(bodies).toHaveBeenCalledWith('log_9')
  })

  it('没要求轮询时不轮询（正文写完就不必再取）', async () => {
    bodies.mockReset()
    bodies.mockResolvedValue(ok({ request: {} }))
    const { wrapper, client } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogBodiesQuery('log_9', false), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(pollingInterval(client, 'request-log-bodies')).toBe(false)
  })

  it('流式期间按 1.5s 轮询（回包在变长）', async () => {
    bodies.mockReset()
    bodies.mockResolvedValue(ok({ request: {} }))
    const { wrapper, client } = createQueryFixture()

    const { result } = renderHook(() => useRequestLogBodiesQuery('log_10', true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(pollingInterval(client, 'request-log-bodies')).toBe(1_500)
  })

  it('强制取一次时把结果写进缓存（复制 cURL 之后正文面板能直接命中）', async () => {
    bodies.mockReset()
    bodies.mockResolvedValue(ok({ request: { body: 'hi' } }))
    const { client } = createQueryFixture()

    const first = await fetchRequestLogBodies('log_7', client)

    expect(first).toEqual({ request: { body: 'hi' } })
    // 缓存里已经有这一份，正文面板挂载时会直接命中。
    expect(client.getQueryData(['request-log-bodies', 'log_7'])).toEqual(first)
  })

  it('正文接口失败时把错误抛出来（复制按钮要能显示失败）', async () => {
    bodies.mockReset()
    bodies.mockResolvedValue(fail('正文已被清理'))
    const { client } = createQueryFixture()

    await expect(fetchRequestLogBodies('log_gone', client)).rejects.toThrow('正文已被清理')
  })
})
