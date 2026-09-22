import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttemptView, ExchangeView } from '@server/proxy/contracts'
import type { LiveAttemptHandle } from './live-request-store'
import { createLiveAttemptObserver } from './live-request-observer'

const exchange = {} as ExchangeView
const attempt = {} as AttemptView

function handleOf(): LiveAttemptHandle & { upstreamBytes: number; downstreamBytes: number; chunkPreviews: string[]; patches: Partial<Record<string, unknown>>[] } {
  const state = {
    upstreamBytes: 0,
    downstreamBytes: 0,
    chunkPreviews: [] as string[],
    patches: [] as Partial<Record<string, unknown>>[],
    addUpstreamChunk: (bytes: number, preview: string) => {
      state.upstreamBytes += bytes
      state.chunkPreviews.push(preview)
    },
    addDownstreamBytes: (bytes: number) => { state.downstreamBytes += bytes },
    patch: (patch: Parameters<LiveAttemptHandle['patch']>[0]) => { state.patches.push(patch as Partial<Record<string, unknown>>) },
  }
  return state
}

function sseEvent(payload: unknown): Buffer {
  return Buffer.from(`data: ${JSON.stringify(payload)}\n\n`, 'utf8')
}

describe('createLiveAttemptObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('没有台账写口时整体空转，不抛错也不落任何统计', () => {
    const observer = createLiveAttemptObserver({ handle: null, streaming: true, startedAt: 0 })

    expect(() => {
      observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'hi' } }] }))
      observer.onDownstreamChunk?.(exchange, attempt, Buffer.from('hi'))
      observer.onAttemptEnd?.(exchange, attempt, { status: 200, durationMilliseconds: 1 })
    }).not.toThrow()
  })

  it('流式：字节数与分片数随上游到达累加', () => {
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: true, startedAt: 1_000 })

    const chunk = sseEvent({ choices: [{ delta: { content: 'hi' } }] })
    observer.onUpstreamChunk?.(exchange, attempt, chunk)
    observer.onUpstreamChunk?.(exchange, attempt, chunk)

    expect(handle.upstreamBytes).toBe(chunk.length * 2)
    // 预览是原文，截断与限量由台账做，观察者不插手。
    expect(handle.chunkPreviews).toEqual([chunk.toString('utf8'), chunk.toString('utf8')])
  })

  it('流式：首个真实内容决定 TTFT，之后不再改写', () => {
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: true, startedAt: 1_000 })

    // 只有角色帧不算首字：它不代表上游生成了任何内容。
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { role: 'assistant' } }] }))
    expect(handle.patches).toEqual([])

    vi.setSystemTime(1_250)
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'hi' } }] }))
    expect(handle.patches).toContainEqual({ ttftMilliseconds: 250 })

    vi.setSystemTime(1_900)
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'there' } }] }))
    expect(handle.patches.filter(patch => 'ttftMilliseconds' in patch)).toHaveLength(1)
  })

  it('流式：输出 Token 随事件更新到最新值', () => {
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: true, startedAt: 1_000 })

    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'hi' } }], usage: { output_tokens: 5 } }))
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: '!' } }], usage: { output_tokens: 9 } }))

    expect(handle.patches).toContainEqual({ outputTokens: 5 })
    expect(handle.patches).toContainEqual({ outputTokens: 9 })
  })

  it('首字一旦到了就只上报一次，后续字节不能改写那一刻', () => {
    // 「上游开始吐字了」是请求级的事实，由执行器拿它把阶段从「等首字节」推到「正在交付」；
    // 重复上报会让阶段在每个分块上都被重写一遍。
    const onFirstByte = vi.fn()
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: true, startedAt: 1_000, onFirstByte })

    vi.setSystemTime(1_250)
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'hi' } }] }))
    vi.setSystemTime(1_900)
    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'there' } }] }))
    observer.onAttemptEnd?.(exchange, attempt, { status: 200, durationMilliseconds: 900 })

    expect(onFirstByte).toHaveBeenCalledTimes(1)
    expect(onFirstByte).toHaveBeenCalledWith(250)
  })

  it('非流式：整包到达时也会上报首字，不会永远停在「等首字节」', () => {
    const onFirstByte = vi.fn()
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: false, startedAt: 1_000, onFirstByte })

    vi.setSystemTime(1_400)
    observer.onUpstreamChunk?.(exchange, attempt, Buffer.from(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), 'utf8'))
    expect(onFirstByte).not.toHaveBeenCalled()

    observer.onAttemptEnd?.(exchange, attempt, { status: 200, durationMilliseconds: 400 })
    expect(onFirstByte).toHaveBeenCalledWith(400)
  })

  it('非流式：中途不解析半截 JSON，收尾时一次算出首字与用量', () => {
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: false, startedAt: 1_000 })

    const body = JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { output_tokens: 3 } })
    observer.onUpstreamChunk?.(exchange, attempt, Buffer.from(body.slice(0, 10), 'utf8'))
    expect(handle.patches).toEqual([])

    vi.setSystemTime(1_400)
    observer.onUpstreamChunk?.(exchange, attempt, Buffer.from(body.slice(10), 'utf8'))
    expect(handle.patches).toEqual([])

    observer.onAttemptEnd?.(exchange, attempt, { status: 200, durationMilliseconds: 400 })
    expect(handle.patches).toContainEqual({ ttftMilliseconds: 400 })
    expect(handle.patches).toContainEqual({ outputTokens: 3 })
  })

  it('台账写口为 null 时，首字回调也不该被叫到', () => {
    // 内部执行不进台账，也就没有「阶段」可推——回调拿着一个没意义的数字没用。
    const onFirstByte = vi.fn()
    const observer = createLiveAttemptObserver({ handle: null, streaming: true, startedAt: 0, onFirstByte })

    observer.onUpstreamChunk?.(exchange, attempt, sseEvent({ choices: [{ delta: { content: 'hi' } }] }))
    observer.onAttemptEnd?.(exchange, attempt, { status: 200, durationMilliseconds: 1 })

    expect(onFirstByte).not.toHaveBeenCalled()
  })

  it('下游字节单独计，不与上游字节混在一起', () => {
    const handle = handleOf()
    const observer = createLiveAttemptObserver({ handle, streaming: true, startedAt: 1_000 })

    observer.onUpstreamChunk?.(exchange, attempt, Buffer.from('abc'))
    observer.onDownstreamChunk?.(exchange, attempt, Buffer.from('abcdef'))

    expect(handle.upstreamBytes).toBe(3)
    expect(handle.downstreamBytes).toBe(6)
    // 下游字节只计数，不记预览：预览必须是上游原文，混进转换产物就不是「上游回了什么」了。
    expect(handle.chunkPreviews).toEqual(['abc'])
  })
})
