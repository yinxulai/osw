import { describe, expect, it, vi } from 'vitest'
import type { DeliveryDecisionRef, Frame, FrameSink, HeadFrame, ModifierContext } from '@server/proxy/contracts'
import type { RequestRewriteRule } from '@common/schemas'
import type { ProtocolAdapter } from '@server/proxy/protocols/shared/types'
import type { ProtocolConversionAdapter, NativeProtocolAdapter } from '@server/proxy/protocols/shared/types'
import { ToolNameRegistry } from '@server/proxy/protocols/shared/tool-name-registry'
import { ProtocolConversionError } from '@server/proxy/protocols/shared/conversion-error'
import { pipeFrames } from '@server/proxy/kernel/frame-pipe'
import { selectCandidates } from '@server/proxy/kernel/modifier-selection'
import { createResponseModifiers, createResponseRewriteModifier } from './response-modifiers'

const JSON_HEAD: HeadFrame = { kind: 'head', status: 200, headers: { 'content-type': 'application/json', 'content-length': '18' } }
const SSE_HEAD: HeadFrame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }

/** 正常交付：上游 2xx，字节给客户端。 */
const DELIVERED: DeliveryDecisionRef = { decision: { kind: 'deliver', successful: true } }
/**
 * 执行器已经判定的 failover：这次响应一个字节都不交付。
 *
 * 「客户端要增量、上游回了整包」就落在这一档——它是**上游违约**，不是「改成整包交付」
 * （见 `apps/docs/specs/proxy-engine.md` §1.2）。因此这里的修改器必须原样透传，绝不能自己
 * 攒一份整包再发出去。
 */
const ABANDONED: DeliveryDecisionRef = { decision: { kind: 'discard', reason: 'status' } }

function nativeAdapter(): NativeProtocolAdapter {
  return {
    kind: 'native',
    clientProtocol: 'openai-completions',
    endpointProtocol: 'openai-completions',
    requiresResponseConversion: false,
    prepareRequest: () => Buffer.alloc(0),
    createStreamConverter: () => null,
    finishStream: () => '',
    convertResponse: body => body,
  }
}

function conversionAdapter(onConvert = vi.fn()): ProtocolConversionAdapter {
  return {
    kind: 'conversion',
    clientProtocol: 'openai-completions',
    endpointProtocol: 'anthropic-messages',
    requiresResponseConversion: true,
    prepareRequest: () => Buffer.alloc(0),
    createStreamConverter: () => ({
      push(chunk) { onConvert(chunk); return `[c]${chunk}` },
      flush: () => '',
    }),
    finishStream: () => '[c]tail',
    convertResponse(body) {
      const text = body.toString('utf8')
      onConvert(text)
      return Buffer.from(`[c]${text}`)
    },
  }
}

function createContext(overrides: Partial<ModifierContext['exchange']> = {}): ModifierContext {
  return {
    direction: 'response',
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
      ...overrides,
    },
    attempt: { index: 0, endpointId: 'messages', endpointProtocol: 'anthropic-messages' },
    upstreamHead: null,
  }
}

function createSink(): FrameSink & { readonly frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    closed: false,
    write(frame: Frame): void { frames.push(frame) },
  }
}

async function* frameSource(frames: Frame[]): AsyncIterable<Frame> {
  for (const frame of frames) yield frame
}

function responseRule(): RequestRewriteRule {
  return {
    id: 'rule-response',
    name: '响应改写',
    description: '',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ type: 'body-set', stage: 'response', path: '$.text', value: 'rewritten' }],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
  }
}

function dataFrames(frames: readonly Frame[]): string[] {
  return frames.filter(frame => frame.kind === 'data').map(frame => (frame as { body: Buffer }).body.toString('utf8'))
}

function errorFrames(frames: readonly Frame[]): ProtocolConversionError[] {
  return frames
    .filter((frame): frame is Extract<Frame, { kind: 'error' }> => frame.kind === 'error')
    .map(frame => frame.error as ProtocolConversionError)
}

type RunInput = {
  frames: Frame[]
  adapter: ProtocolAdapter
  delivery: DeliveryDecisionRef
  context: ModifierContext
  rules?: readonly RequestRewriteRule[]
}

async function run(input: RunInput) {
  const sink = createSink()
  const onRewriteEvaluated = vi.fn()
  // 响应改写已从默认注册里摘下（受 `RESPONSE_REWRITE_ENABLED` 闸门控制），因此这里单独把它
  // 装回管线——这组用例要证明的正是「实现仍然完好」，关闭的只是默认入口。
  const options = {
    adapter: input.adapter,
    delivery: input.delivery,
    rules: input.rules ?? [],
    toolNames: new ToolNameRegistry(),
    onRewriteEvaluated,
  }
  const modifiers = [...createResponseModifiers(options), createResponseRewriteModifier(options)]
  const result = await pipeFrames({ frames: frameSource(input.frames), sink, context: input.context, modifiers })
  return { frames: sink.frames, result, onRewriteEvaluated }
}

describe('protocol conversion modifier', () => {
  it('整包交付时把上游整包只转换一次', async () => {
    const body = '{"text":"original"}'
    const { frames } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from(body) }, { kind: 'end' }],
      adapter: conversionAdapter(),
      delivery: DELIVERED,
      context: createContext({ transport: 'http' }),
    })

    expect(dataFrames(frames)).toEqual([`[c]${body}`])
    expect(frames[frames.length - 1].kind).toBe('end')
  })

  it('增量传输时逐块转换上游 SSE，并在结束时补上转换器尾巴', async () => {
    const { frames } = await run({
      frames: [
        SSE_HEAD,
        { kind: 'data', body: Buffer.from('data: a\n\n') },
        { kind: 'data', body: Buffer.from('data: b\n\n') },
        { kind: 'end' },
      ],
      adapter: conversionAdapter(),
      delivery: DELIVERED,
      context: createContext({ transport: 'http-stream' }),
    })

    expect(dataFrames(frames)).toEqual(['[c]data: a\n\n', '[c]data: b\n\n', '[c]tail'])
  })

  it('客户端要增量而上游回了整包时原样透传，不自己攒出一份整包', async () => {
    const onConvert = vi.fn()
    const body = '{"text":"original"}'
    const { frames } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from(body) }, { kind: 'end' }],
      adapter: conversionAdapter(onConvert),
      delivery: ABANDONED,
      context: createContext({ transport: 'http-stream' }),
    })

    // 这次尝试已被执行器判为 failover：转换器根本不该被选中，字节按上游给的样子透传。
    expect(onConvert).not.toHaveBeenCalled()
    expect(dataFrames(frames)).toEqual([body])
  })

  it('整流转换失败时输出错误帧，绝不透传未转换的上游正文', async () => {
    const adapter = conversionAdapter()
    adapter.convertResponse = () => { throw new Error('invalid upstream payload') }

    const { frames, result } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"secret":"raw upstream"}') }, { kind: 'end' }],
      adapter,
      delivery: DELIVERED,
      context: createContext({ transport: 'http' }),
    })

    const [failure] = errorFrames(frames)
    expect(dataFrames(frames)).toEqual([])
    expect(failure).toBeInstanceOf(ProtocolConversionError)
    expect(failure).toMatchObject({
      code: 'PROTOCOL_CONVERSION_FAILED',
      phase: 'whole-body',
      from: 'anthropic-messages',
      to: 'openai-completions',
    })
    expect(result.error).toBe(failure)
  })

  it('流式转换器抛错时立即终止并输出错误帧', async () => {
    const adapter: ProtocolConversionAdapter = {
      ...conversionAdapter(),
      createStreamConverter: () => ({
        push() { throw new Error('invalid SSE chunk') },
        flush: () => '',
      }),
    }

    const { frames, result } = await run({
      frames: [SSE_HEAD, { kind: 'data', body: Buffer.from('data: raw\n\n') }, { kind: 'end' }],
      adapter,
      delivery: DELIVERED,
      context: createContext({ transport: 'http-stream' }),
    })

    const [failure] = errorFrames(frames)
    expect(dataFrames(frames)).toEqual([])
    expect(failure).toMatchObject({ code: 'PROTOCOL_CONVERSION_FAILED', phase: 'stream-chunk' })
    expect(result.error).toBe(failure)
  })
})

describe('downstream head modifier', () => {
  it('只有增量传输能保住上游的 content-length', async () => {
    const entire = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      delivery: ABANDONED,
      context: createContext({ transport: 'http' }),
    })
    const incremental = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      delivery: ABANDONED,
      context: createContext({ transport: 'http-stream' }),
    })

    // 整包传输下正文可能被响应改写改短改长，长度不再可信；增量传输是逐帧原样透传，长度仍然可信。
    expect((entire.frames[0] as HeadFrame).headers['content-length']).toBeUndefined()
    expect((incremental.frames[0] as HeadFrame).headers['content-length']).toBe('18')
  })
})

describe('response rewrite modifier', () => {
  it('不随响应侧修改器默认注册：响应阶段被功能闸门关闭时，它一次都不会进候选列表', () => {
    const modifiers = createResponseModifiers({
      adapter: nativeAdapter(),
      delivery: DELIVERED,
      rules: [],
      toolNames: new ToolNameRegistry(),
      onRewriteEvaluated: vi.fn(),
    })

    // 闸门关着（`RESPONSE_REWRITE_ENABLED === false`），响应改写不注册；形态判定
    // （`scope.shapes: ['whole']`）也因此在真实链路里根本轮不到被问。此处断言的是**注册**
    // 这一步就被拦住，而不是「注册了但运行时跳过」——后者会留下一条能被绕过的缝。
    expect(modifiers.map(modifier => modifier.id)).toEqual(['downstream-head', 'protocol-conversion'])
    // 修改器实现本身仍在（单独导出），下面的用例直接把它装回管线，证明关闭的是入口不是能力。
    expect(typeof createResponseRewriteModifier).toBe('function')
  })

  it('按声明的交付形态被内核排除，不需要自己去判断', () => {
    const modifiers = [createResponseRewriteModifier({
      adapter: nativeAdapter(),
      delivery: DELIVERED,
      rules: [],
      toolNames: new ToolNameRegistry(),
      onRewriteEvaluated: vi.fn(),
    })]

    const entire = selectCandidates(modifiers, createContext({ transport: 'http' }), 'frame').map(modifier => modifier.id)
    const incremental = selectCandidates(modifiers, createContext({ transport: 'http-stream' }), 'frame').map(modifier => modifier.id)

    expect(entire).toContain('response-rewrite')
    expect(incremental).not.toContain('response-rewrite')
  })

  it('整包传输下改写整份 JSON 正文并更新 content-length', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      delivery: DELIVERED,
      context: createContext({ transport: 'http' }),
      rules: [responseRule()],
    })

    const rewritten = '{"text":"rewritten"}'
    expect(dataFrames(frames)).toEqual([rewritten])
    expect((frames[0] as HeadFrame).headers['content-length']).toBe(String(rewritten.length))
    expect(onRewriteEvaluated).toHaveBeenCalledWith(expect.objectContaining({ appliedRuleIds: ['rule-response'] }))
  })

  it('增量传输下逐帧原样透传，规则一次都不执行', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [SSE_HEAD, { kind: 'data', body: Buffer.from('data: {"text":"original"}\n\n') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      delivery: DELIVERED,
      context: createContext({ transport: 'http-stream' }),
      rules: [responseRule()],
    })

    expect(dataFrames(frames)).toEqual(['data: {"text":"original"}\n\n'])
    expect(onRewriteEvaluated).not.toHaveBeenCalled()
  })

  it('不成功的响应不做改写：协议转换已经决定了它不会被交付', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [{ kind: 'head', status: 500, headers: { 'content-type': 'application/json' } }, { kind: 'end' }],
      adapter: nativeAdapter(),
      delivery: ABANDONED,
      context: createContext({ transport: 'http' }),
      rules: [responseRule()],
    })

    expect(frames.some(frame => frame.kind === 'head' && frame.status === 500)).toBe(true)
    expect(onRewriteEvaluated).not.toHaveBeenCalled()
  })
})
