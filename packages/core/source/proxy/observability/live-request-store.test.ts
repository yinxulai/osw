import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpstreamTarget } from '@server/proxy/contracts'
import { LiveRequestStore } from './live-request-store'

function targetOf(providerModelId: string): UpstreamTarget {
  return {
    providerId: `prov_${providerModelId}`,
    providerName: `Provider ${providerModelId}`,
    providerModelId,
    providerModelName: providerModelId,
    apiKeyReference: 'key_1',
    customAuthHeader: null,
    endpointId: `ep_${providerModelId}`,
    protocol: 'openai-completions',
    url: `https://example.com/${providerModelId}`,
    timeoutMilliseconds: 30_000,
  }
}

function begin(store: LiveRequestStore, id = 'req_1') {
  return store.begin({ id, method: 'POST', path: '/v1/chat/completions', transport: 'http', clientProtocol: null })
}

describe('LiveRequestStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('登记后立刻可见，且停在路由阶段', () => {
    const store = new LiveRequestStore()
    begin(store)

    const [request] = store.list()
    expect(request?.id).toBe('req_1')
    expect(request?.status).toBe('pending')
    expect(request?.phase).toBe('routing')
    expect(request?.endedAt).toBeNull()
    expect(request?.attempts).toEqual([])
  })

  it('路由结论覆盖协议、形态与候选顺序', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)

    handle.resolveRoute({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      candidates: [targetOf('a'), targetOf('b')],
    })

    const request = store.get('req_1')
    expect(request?.logicalModelId).toBe('gpt-4o')
    expect(request?.clientProtocol).toBe('openai-completions')
    expect(request?.transport).toBe('http-stream')
    expect(request?.candidates.map(candidate => candidate.providerModelId)).toEqual(['a', 'b'])
    expect(request?.events.some(event => event.kind === 'route.resolved')).toBe(true)
  })

  it('尝试的字节与状态写入后立刻反映在快照里', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)

    const attempt = handle.startAttempt(targetOf('a'))
    attempt.addUpstreamChunk(64, 'data: one')
    attempt.addUpstreamChunk(32, 'data: two')
    attempt.addDownstreamBytes(512)
    attempt.patch({
      httpStatus: 200,
      state: 'streaming',
      ttftMilliseconds: 42,
      outputTokens: 7,
      requestBytes: 128,
      // 命中的修改器名字要等请求修改器跑完才知道，和字节数一样是后补的。
      requestRewriteRuleNames: ['Remove Date Suffix'],
    })

    const request = store.get('req_1')
    expect(request?.attempts[0]).toMatchObject({
      index: 0,
      providerModelName: 'a',
      state: 'streaming',
      httpStatus: 200,
      requestBytes: 128,
      // 开张时先给空数组，免得界面在这一格上读到 `undefined`。
      requestRewriteRuleNames: ['Remove Date Suffix'],
      upstreamBytes: 96,
      downstreamBytes: 512,
      chunkCount: 2,
      // 预览只留最新的一块：前一块已经被下一块覆写了。
      chunkPreview: 'data: two',
      ttftMilliseconds: 42,
      outputTokens: 7,
    })
  })

  it('多次尝试按开始顺序编号，且不会互相覆盖', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    handle.startAttempt(targetOf('a')).patch({ state: 'failed' })
    handle.startAttempt(targetOf('b'))

    const request = store.get('req_1')
    expect(request?.attempts.map(attempt => [attempt.index, attempt.providerModelName])).toEqual([[0, 'a'], [1, 'b']])
  })

  it('收尾后离开进行中列表，但仍能被按 id 读到', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    handle.settle('success', 'request.completed', 'success', { httpStatus: 200 })

    expect(store.list()).toHaveLength(1)
    const request = store.get('req_1')
    expect(request?.status).toBe('success')
    expect(request?.phase).toBe('settled')
    expect(request?.endedAt).not.toBeNull()
    // 落定后重复收尾不产生第二条记录。
    handle.settle('failed', 'request.failed', 'error')
    expect(store.list()).toHaveLength(1)
    expect(store.get('req_1')?.status).toBe('success')
  })

  it('进行中的请求排在最前面，并按开始时间倒序', () => {
    const store = new LiveRequestStore()
    const first = begin(store, 'req_1')
    vi.setSystemTime(2_000)
    const second = begin(store, 'req_2')
    first.settle('success', 'request.completed', 'success')
    vi.setSystemTime(3_000)
    begin(store, 'req_3')

    expect(store.list().map(request => request.id)).toEqual(['req_3', 'req_2', 'req_1'])
    second.settle('cancelled', 'request.cancelled', 'warn')
    expect(store.list().map(request => request.id)).toEqual(['req_3', 'req_2', 'req_1'])
  })

  it('事件数量有上限，溢出时丢掉最旧的', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    for (let index = 0; index < 250; index += 1) handle.pushEvent(`event.${index}`, 'info')

    const events = store.get('req_1')?.events ?? []
    expect(events).toHaveLength(200)
    expect(events[0]?.kind).toBe('event.50')
    expect(events[events.length - 1]?.kind).toBe('event.249')
  })

  it('事件带上相对请求开始时刻的偏移', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    vi.setSystemTime(1_250)
    handle.pushEvent('route.resolved', 'info')

    expect(store.get('req_1')?.events[0]?.offsetMilliseconds).toBe(250)
  })

  it('已结束的请求按条数上限裁剪，最旧的先走', () => {
    const store = new LiveRequestStore()
    for (let index = 0; index < 60; index += 1) {
      vi.setSystemTime(1_000 + index * 10)
      begin(store, `req_${index}`).settle('success', 'request.completed', 'success')
    }

    const settled = store.list()
    expect(settled).toHaveLength(50)
    expect(settled[0]?.id).toBe('req_59')
    expect(settled[settled.length - 1]?.id).toBe('req_10')
    expect(store.get('req_0')).toBeNull()
  })

  it('过了保留期就从台账里消失', () => {
    const store = new LiveRequestStore()
    begin(store, 'req_1').settle('success', 'request.completed', 'success')

    vi.setSystemTime(1_000 + 61_000)
    expect(store.get('req_1')).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('快照与台账内部状态解耦：改动写口不会改到已取出的那一份', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    const snapshot = store.get('req_1')

    handle.pushEvent('route.resolved', 'info')
    expect(snapshot?.events).toEqual([])

    const attempt = handle.startAttempt(targetOf('a'))
    const withAttempt = store.get('req_1')
    attempt.addUpstreamChunk(100, 'data: x')
    expect(withAttempt?.attempts[0]?.upstreamBytes).toBe(0)
    expect(withAttempt?.attempts[0]?.chunkPreview).toBeNull()
  })

  it('分块预览只留最新的一条，并且超过 80 个字符就截断', () => {
    const store = new LiveRequestStore()
    const handle = begin(store)
    const attempt = handle.startAttempt(targetOf('a'))

    attempt.addUpstreamChunk(500, 'x'.repeat(500))
    expect(store.get('req_1')?.attempts[0]?.chunkPreview).toBe(`${'x'.repeat(80)}…`)

    // 后一块直接覆写前一块：预览是「此刻收的是什么」，不是一段历史。
    for (let index = 0; index < 60; index += 1) attempt.addUpstreamChunk(1, `chunk-${index}`)
    expect(store.get('req_1')?.attempts[0]?.chunkPreview).toBe('chunk-59')
    // 字节数与分块数仍然是真的，只有预览被限制。
    expect(store.get('req_1')?.attempts[0]?.chunkCount).toBe(61)
  })

  it('订阅者能听到每一次写入，退订之后就不再被打扰', () => {
    const store = new LiveRequestStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const handle = begin(store)
    handle.resolveRoute({
      logicalModelId: 'gpt-4o',
      clientProtocol: 'openai-completions',
      transport: 'http-stream',
      candidates: [targetOf('a')],
    })
    const attempt = handle.startAttempt(targetOf('a'))
    attempt.addUpstreamChunk(1, 'x')
    handle.settle('success', 'request.completed', 'success')
    // begin / resolveRoute / startAttempt / chunk / settle 各一次。
    expect(listener).toHaveBeenCalledTimes(5)

    unsubscribe()
    handle.pushEvent('anything', 'info')
    expect(listener).toHaveBeenCalledTimes(5)
  })

  it('一个订阅者抛错不该妨碍其他订阅者', () => {
    const store = new LiveRequestStore()
    const healthy = vi.fn()
    store.subscribe(() => { throw new Error('boom') })
    store.subscribe(healthy)

    begin(store)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
