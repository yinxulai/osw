import { describe, expect, it, vi } from 'vitest'
import type { Frame, FrameSink, Modifier, ModifierContext } from '@server/proxy/contracts'
import { pipeFrames } from './frame-pipe'

function createSink(): FrameSink & { readonly frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    closed: false,
    write(frame: Frame): void { frames.push(frame) },
  }
}

function createContext(direction: 'request' | 'response' = 'response'): ModifierContext {
  return {
    direction,
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'anthropic-messages',
    exchange: {
      requestId: 'req-1',
      logicalModelId: 'logical-1',
      clientProtocol: 'openai-completions',
      transport: 'http',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: Buffer.alloc(0),
      signal: new AbortController().signal,
    },
    attempt: { index: 0, endpointId: 'messages', endpointProtocol: 'anthropic-messages' },
    upstreamHead: null,
  }
}

async function* frameSource(frames: Frame[]): AsyncIterable<Frame> {
  for (const frame of frames) yield frame
}

function createModifier(overrides: Partial<Modifier> & Pick<Modifier, 'id'>): Modifier {
  return {
    order: 0,
    direction: 'response',
    frameMode: 'frame',
    match: () => true,
    ...overrides,
  }
}

const HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }

describe('frame pipe', () => {
  it('moves head, data and end frames to the sink and reports counters', async () => {
    const sink = createSink()
    const result = await pipeFrames({
      frames: frameSource([HEAD, { kind: 'data', body: Buffer.from('hello') }, { kind: 'data', body: Buffer.from(' world') }, { kind: 'end' }]),
      sink,
      context: createContext(),
      modifiers: [],
    })

    expect(result.head?.status).toBe(200)
    expect(result.frameCount).toBe(2)
    expect(result.byteCount).toBe(11)
    expect(result.ended).toBe(true)
    expect(result.error).toBeNull()
    expect(result.stopped).toBe(false)
    expect(sink.frames.map(frame => frame.kind)).toEqual(['head', 'data', 'data', 'end'])
  })

  it('only runs modifiers that match the direction, the frame mode and the context', async () => {
    const seen: string[] = []
    const modifiers: Modifier[] = [
      createModifier({ id: 'later', order: 20, applyFrame: (_context, frame) => { seen.push('later'); return frame } }),
      createModifier({ id: 'earlier', order: 10, applyFrame: (_context, frame) => { seen.push('earlier'); return frame } }),
      createModifier({ id: 'request-direction', direction: 'request', applyFrame: (_context, frame) => { seen.push('request'); return frame } }),
      createModifier({ id: 'buffered', frameMode: 'buffered', applyFrame: (_context, frame) => { seen.push('buffered'); return frame } }),
      createModifier({ id: 'unmatched', match: () => false, applyFrame: (_context, frame) => { seen.push('unmatched'); return frame } }),
      createModifier({ id: 'no-frame-hook' }),
    ]

    const result = await pipeFrames({
      frames: frameSource([{ kind: 'data', body: Buffer.from('x') }]),
      sink: createSink(),
      context: createContext(),
      modifiers,
    })

    expect(seen).toEqual(['earlier', 'later'])
    expect(result.frameCount).toBe(1)
  })

  it('lets a modifier split, drop and rewrite frames', async () => {
    const split = createModifier({
      id: 'split',
      order: 1,
      applyFrame: (_context, frame) => (frame.kind === 'data' ? [{ kind: 'data', body: Buffer.from('a') }, { kind: 'data', body: Buffer.from('b') }] : frame),
    })
    const dropEnd = createModifier({ id: 'drop-end', order: 2, applyFrame: (_context, frame) => (frame.kind === 'end' ? null : frame) })
    const sink = createSink()
    const result = await pipeFrames({
      frames: frameSource([{ kind: 'data', body: Buffer.from('ab') }, { kind: 'end' }]),
      sink,
      context: createContext(),
      modifiers: [dropEnd, split],
    })

    expect(sink.frames.map(frame => frame.kind)).toEqual(['data', 'data'])
    expect(result.frameCount).toBe(2)
    expect(result.ended).toBe(false)
  })

  it('stops the loop and reports the upstream error', async () => {
    const failure = new Error('上游断了')
    const sink = createSink()
    const result = await pipeFrames({
      frames: frameSource([HEAD, { kind: 'data', body: Buffer.from('partial') }, { kind: 'error', error: failure }, { kind: 'end' }]),
      sink,
      context: createContext(),
      modifiers: [],
    })

    expect(result.error).toBe(failure)
    expect(result.ended).toBe(false)
    expect(sink.frames.map(frame => frame.kind)).toEqual(['head', 'data', 'error'])
  })

  it('stops reading once the sink is closed', async () => {
    let consumed = 0
    async function* countingSource(): AsyncIterable<Frame> {
      for (let index = 0; index < 5; index += 1) {
        consumed += 1
        yield { kind: 'data', body: Buffer.from(String(index)) }
      }
    }
    const sink: FrameSink = {
      closed: true,
      write: () => undefined,
    }

    const result = await pipeFrames({ frames: countingSource(), sink, context: createContext(), modifiers: [] })

    expect(result.stopped).toBe(true)
    expect(result.frameCount).toBe(0)
    expect(consumed).toBe(1)
  })

  it('keeps moving bytes when an observer throws', async () => {
    const calls: string[] = []
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sink = createSink()
    const result = await pipeFrames({
      frames: frameSource([HEAD, { kind: 'data', body: Buffer.from('hello') }, { kind: 'end' }]),
      sink,
      context: createContext(),
      modifiers: [],
      observers: [
        {
          id: 'failing',
          onUpstreamHead: () => { calls.push('head'); throw new Error('observer 挂了') },
          onUpstreamChunk: () => { calls.push('upstream'); throw new Error('observer 挂了') },
          onDownstreamChunk: () => { calls.push('downstream'); throw new Error('observer 挂了') },
        },
        { id: 'healthy', onDownstreamChunk: () => calls.push('healthy') },
      ],
    })

    expect(calls).toEqual(['head', 'upstream'])
    expect(result.error).toBeNull()
    expect(result.byteCount).toBe(5)
    expect(sink.frames.map(frame => frame.kind)).toEqual(['head', 'data', 'end'])
    // 静默吞掉异常会让「观察者挂了」变成不可诊断问题，所以只丢记录、留日志。
    expect(warnings).toHaveBeenCalledTimes(2)
    expect(warnings.mock.calls[0][0]).toContain('observer 挂了')
    warnings.mockRestore()
  })
})
