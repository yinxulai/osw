import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveRequestSnapshot } from '@common/schemas'
import { openStream } from './client'
import { readLiveRequestStream } from './live-stream'

vi.mock('./client', () => ({ openStream: vi.fn() }))

interface FakeStream {
  stream: ReadableStream<Uint8Array>
  wasCancelled: () => boolean
}

interface ReadableStreamOptions {
  close?: boolean
}

/** 把几段文本当成网络分块依次交给读取端：分块边界与帧边界无关，正是这里要验的事。 */
function readableStreamOf(chunks: string[], options: ReadableStreamOptions = {}): FakeStream {
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (options.close !== false) controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, wasCancelled: () => cancelled }
}

function lineOf(id: string): string {
  return `${JSON.stringify({ requests: [{ id }] })}\n`
}

/** 收集每一帧，并顺手记下读取结束这件事发生在哪。 */
function collector() {
  const frames: LiveRequestSnapshot[] = []
  return { frames, onSnapshot: (snapshot: LiveRequestSnapshot) => frames.push(snapshot) }
}

describe('readLiveRequestStream', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(1_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(openStream).mockReset()
  })

  it('把被网络切断的半行拼回来，一帧只交一次', async () => {
    // 分块边界与帧边界无关：一帧横跨两个分块时必须等后半截到了再解析。
    const { stream } = readableStreamOf(['{"requests":[', '{"id":"req_1"}]}\n'])
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames, onSnapshot } = collector()

    await readLiveRequestStream({ signal: new AbortController().signal, onSnapshot })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.requests[0]?.id).toBe('req_1')
  })

  it('一次分块里的多帧全部交付，顺序不乱', async () => {
    const { stream } = readableStreamOf([`${lineOf('req_1')}${lineOf('req_2')}${lineOf('req_3')}`])
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames, onSnapshot } = collector()

    await readLiveRequestStream({ signal: new AbortController().signal, onSnapshot })

    expect(frames.map(frame => frame.requests[0]?.id)).toEqual(['req_1', 'req_2', 'req_3'])
  })

  it('丢掉畸形帧，但不因此打断后面的帧', async () => {
    // 连接会在任意一个字节上被掐断，半行是真实存在的；而下一帧本来就是全量的，
    // 丢掉半行不丢任何状态，为它把整条推送打断才是纯损失。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { stream } = readableStreamOf([`{"requests":[{"id"\n${lineOf('req_2')}\n${lineOf('req_3')}`])
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames, onSnapshot } = collector()

    await readLiveRequestStream({ signal: new AbortController().signal, onSnapshot })

    expect(frames.map(frame => frame.requests[0]?.id)).toEqual(['req_2', 'req_3'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('忽略空行：心跳留下的空白不算一帧', async () => {
    const { stream } = readableStreamOf([`\n${lineOf('req_1')}\n\n`])
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames, onSnapshot } = collector()

    await readLiveRequestStream({ signal: new AbortController().signal, onSnapshot })

    expect(frames).toHaveLength(1)
  })

  it('结束即返回：正常断开由重连策略去处理，读取端不自己续上', async () => {
    const { stream } = readableStreamOf([])
    vi.mocked(openStream).mockResolvedValue(stream)

    await expect(readLiveRequestStream({ signal: new AbortController().signal, onSnapshot: () => undefined }))
      .resolves.toBeUndefined()
  })

  it('读取出错时异常照旧往上抛，已经收到的帧不会回淌', async () => {
    const { stream } = readableStreamOf([lineOf('req_1'), '{oops'], { close: false })
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames } = collector()

    await expect(readLiveRequestStream({
      signal: new AbortController().signal,
      // 消费方抛错是「读不下去」的最常见原因，它必须能停掉这条读取。
      onSnapshot: (snapshot: LiveRequestSnapshot) => {
        frames.push(snapshot)
        throw new Error('consumer exploded')
      },
    })).rejects.toThrow('consumer exploded')

    expect(frames.map(frame => frame.requests[0]?.id)).toEqual(['req_1'])
  })

  it('中途退出时放开读取端，不留一条没人读的连接', async () => {
    const { stream, wasCancelled } = readableStreamOf([lineOf('req_1')], { close: false })
    vi.mocked(openStream).mockResolvedValue(stream)

    await expect(readLiveRequestStream({
      signal: new AbortController().signal,
      onSnapshot: () => { throw new Error('consumer exploded') },
    })).rejects.toThrow('consumer exploded')

    expect(wasCancelled()).toBe(true)
  })

  it('把调用方的 abort 信号原样交给建流那一层', async () => {
    // 中止是杀连接的动作，不该在读取端二次实现一遍。
    const controller = new AbortController()
    const { stream } = readableStreamOf([])
    vi.mocked(openStream).mockResolvedValue(stream)

    await readLiveRequestStream({ signal: controller.signal, onSnapshot: () => undefined })

    expect(openStream).toHaveBeenCalledWith('/request-log/live/stream', { signal: controller.signal })
  })

  it('末尾那截没等来换行的半行直接丢掉', async () => {
    // 连接被掐断时最后一行很可能是半截：它没接上换行，就不是一帧，也不该被交付。
    const { stream } = readableStreamOf([`${lineOf('req_1')}{"requests":[{"id`])
    vi.mocked(openStream).mockResolvedValue(stream)
    const { frames, onSnapshot } = collector()

    await readLiveRequestStream({ signal: new AbortController().signal, onSnapshot })

    expect(frames.map(frame => frame.requests[0]?.id)).toEqual(['req_1'])
  })
})
