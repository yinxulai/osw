import type { DeliveryDecisionRef, Frame, HeadFrame, Modifier, ModifierContext } from '@server/proxy/contracts'
import { bodyDeliveryShape } from '@server/proxy/contracts'
import type { RequestRewriteRule } from '@common/schemas'
import type { ProtocolAdapter, ProtocolConversionAdapter, StreamConverter } from '@server/proxy/protocols/shared/types'
import type { ToolNameRegistry } from '@server/proxy/protocols/shared/tool-name-registry'
import { isEventStreamResponse } from '@server/proxy/adapters/http-response-sink'
import { createDownstreamHeaders } from '@server/proxy/response/headers'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { ProtocolConversionError } from '@server/proxy/protocols/shared/conversion-error'
import type { RewriteEvaluation } from './request-modifiers'

export interface ResponseModifierOptions {
  adapter: ProtocolAdapter
  delivery: DeliveryDecisionRef
  rules: readonly RequestRewriteRule[]
  /** 本次尝试的请求上下文，与请求侧共享同一个实例；响应体转换靠它还原展平过的工具名。 */
  toolNames: ToolNameRegistry
  onRewriteEvaluated(result: RewriteEvaluation): void
}

/**
 * 响应侧修改器：把上游报文变成客户端协议能收的东西。
 *
 * 顺序固定为「出口头 → 协议转换 → 响应改写」：
 * 1. 出口头：剥掉逐跳头，并在正文会被重写时报「长度不再可信」，让 Node 重新分帧。
 * 2. 协议转换：只有客户端协议与上游协议不同、且这次响应要交付时才介入；用哪个解析器
 *    由上游响应的分帧格式决定（**事实**）。
 * 3. 响应改写：用户规则在最后改「已经是客户端协议」的报文。它只声明了
 *    `scope.shapes: ['whole']`——增量交付下手里的字节是一段段 SSE 文本，
 *    而规则动作是在一整份 JSON 上按路径取值，这是**没有它能做的事**，因此交给内核代筛，
 *    不写在 `match` 里。
 *
 * 改写会改响应头，因此它必须把头部帧一起扣住，直到正文就绪再一并交出——否则出口
 * 已经按旧头开始写了。
 */
export function createResponseModifiers(options: ResponseModifierOptions): Modifier[] {
  return [
    createDownstreamHeadModifier(options),
    createConversionModifier(options),
    createResponseRewriteModifier(options),
  ]
}

function createDownstreamHeadModifier(options: ResponseModifierOptions): Modifier {
  const convertible = options.adapter.kind === 'conversion'
  return {
    id: 'downstream-head',
    order: 10,
    direction: 'response',
    frameMode: 'frame',
    match: (context: ModifierContext) => context.upstreamHead !== null,
    applyFrame(context: ModifierContext, frame: Frame) {
      if (frame.kind !== 'head') return frame
      const headers = createDownstreamHeaders(frame.headers)
      // 正文可能被转换或改写，`content-length` 已经不是上游那个长度了。
      // 读的是**交付形态**，而不是「客户端跳的 transport」：判断的是「这份正文还会不会
      // 被重写 / 是不是一整块」，而出口选边收边发还是攒完再发用的正是同一根轴
      // （见 `BodyDeliveryShape`）。增量交付时正文逐帧原样透传，长度仍然可信；
      // 反过来，上游没兼现形态时这次尝试根本不会交付（执行器已判 failover），这个头也不会发出去。
      if (convertible || bodyDeliveryShape(context.exchange.transport) === 'whole') delete headers['content-length']
      return { kind: 'head', status: frame.status, headers }
    },
  }
}

function createConversionModifier(options: ResponseModifierOptions): Modifier {
  // 原生直通时没有转换器：整条链路退化成「什么都不做」。
  const adapter = options.adapter.kind === 'conversion' ? options.adapter : null
  let streamConverter: StreamConverter | null = null
  let wholeBody = ''
  return {
    id: 'protocol-conversion',
    order: 20,
    direction: 'response',
    frameMode: 'frame',
    match: (context: ModifierContext) => adapter !== null && options.delivery.decision.kind === 'deliver' && context.upstreamHead !== null,
    applyFrame(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null {
      if (!adapter) return frame
      const head = context.upstreamHead as HeadFrame
      // 响应头在这里只用来选**解析器**（手里这堆字节是 SSE 还是整包 JSON），不决定要不要转换、
      // 也不决定交付行为：客户端要增量而上游回整包时，执行器已经把它判成 discard，
      // 转换器根本不会被选中。
      // 于是 `accumulateWholeBody` 只会落到它唯一合法的那一半：上游确实发了一整包、而这次又要转协议。
      if (isEventStreamResponse(head.headers)) return convertStream(adapter, frame)
      return accumulateWholeBody(adapter, frame)
    },
  }

  function accumulateWholeBody(adapter: ProtocolConversionAdapter, frame: Frame): Frame | readonly Frame[] | null {
    if (frame.kind === 'data') {
      wholeBody += frame.body.toString('utf8')
      return null
    }
    if (frame.kind !== 'end') return frame
    if (!wholeBody) return frame
    const raw = Buffer.from(wholeBody)
    // 整体转换只在拿到完整正文后做一次。失败必须成为一条 error 帧：如果退回上游原文，
    // 客户端会拿到一份协议不匹配的 200，比明确失败更难诊断，也会掩盖上游故障。
    try {
      return [{ kind: 'data', body: adapter.convertResponse(raw, options.toolNames) }, frame]
    } catch (error) {
      return [{ kind: 'error', error: new ProtocolConversionError('response', 'whole-body', adapter.endpointProtocol, adapter.clientProtocol, error) }]
    }
  }

  function convertStream(adapter: ProtocolConversionAdapter, frame: Frame): Frame | readonly Frame[] | null {
    if (frame.kind === 'head') return frame
    if (frame.kind === 'data') {
      try {
        const converted = requireConverter(adapter).push(frame.body.toString('utf8'))
        return converted ? [{ kind: 'data', body: Buffer.from(converted) }] : null
      } catch (error) {
        return { kind: 'error', error: new ProtocolConversionError('response', 'stream-chunk', adapter.endpointProtocol, adapter.clientProtocol, error) }
      }
    }
    if (frame.kind !== 'end') return frame
    const converter = requireConverter(adapter)
    try {
      const tail = adapter.finishStream(converter)
      return tail ? [{ kind: 'data', body: Buffer.from(tail) }, frame] : frame
    } catch (error) {
      return { kind: 'error', error: new ProtocolConversionError('response', 'stream-finish', adapter.endpointProtocol, adapter.clientProtocol, error) }
    }
  }

  function requireConverter(adapter: ProtocolConversionAdapter): StreamConverter {
    const existing = streamConverter
    if (existing) return existing
    const created = adapter.createStreamConverter(options.toolNames)
    streamConverter = created
    return created
  }
}

function createResponseRewriteModifier(options: ResponseModifierOptions): Modifier {
  let head: HeadFrame | null = null
  let body = ''
  return {
    id: 'response-rewrite',
    order: 30,
    direction: 'response',
    frameMode: 'frame',
    /**
     * 增量交付的响应里规则**没有能做的事**：出口拿到的是一段段 SSE 文本，而规则动作是在
     * 一整份 JSON 上按路径取值（见 `request-rewrite-engine.ts` 的 `applyBody`）。
     * 这是「这种形态下它没有职责」的静态陈述，在头帧之前就能算出来，因此写在 `scope` 上
     * 交给内核代筛，而不是让它在 `match` 里自己读一根轴。
     *
     * 它限制的是**交付形态**而不是「客户端跳的 transport」：同一个事实，取后者只是
     * 在当前取值域下恰好同义（见 `BodyDeliveryShape`）。
     */
    scope: { shapes: ['whole'] },
    match: (context: ModifierContext) => {
      // 还没拿到响应头就还没有「响应」可言；它也是 `applyFrame` 攒正文的起点。
      return options.delivery.decision.kind === 'deliver' && options.delivery.decision.successful && context.upstreamHead !== null
    },
    applyFrame(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null {
      if (frame.kind === 'head') {
        head = frame
        return null
      }
      if (frame.kind === 'data') {
        body += frame.body.toString('utf8')
        return null
      }
      if (frame.kind !== 'end') return frame
      const upstreamHeaders = head?.headers ?? {}
      const modified = applyRequestRewriteRules(Buffer.from(body), upstreamHeaders, options.rules, {
        stage: 'response',
        clientProtocol: context.clientProtocol,
        upstreamProtocol: context.upstreamProtocol,
        // `scope` 已经保证这里是整包交付；这里再把形态传一遍不是冗余，而是规则引擎
        // 自主回答「这份正文能不能逐块改」时的唯一依据（见 `RequestRewriteContext.shape`）。
        shape: bodyDeliveryShape(context.exchange.transport),
      })
      options.onRewriteEvaluated({
        appliedRuleIds: modified.appliedRuleIds,
        skippedRuleIds: modified.skippedRuleIds,
        bodyBytesBefore: body.length,
        bodyBytesAfter: modified.body.length,
      })
      const emitted: Frame[] = []
      if (head) emitted.push({ ...head, headers: modified.headers })
      emitted.push({ kind: 'data', body: modified.body })
      emitted.push(frame)
      return emitted
    },
  }
}
