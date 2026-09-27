import type { AttemptView, ExchangeView, Frame, FrameSink, HeadFrame, Modifier, ModifierContext, ModifierDirection, Observer, Transport, UpstreamConnection, UpstreamTarget } from '@server/proxy/contracts'
import { pipeFrames, type FramePipeResult } from './frame-pipe'
import { notifyObservers } from './observer-notifications'

/**
 * 双向交换的客户端侧输入。
 *
 * 内核拿到的是抽象的「帧来源 + 出口」，既关不掉也猜不出怎么关，因此关闭动作必须由入口给出。
 * 给出它就代表这次交换是双向的；省略就是单工——`Transport` 有没有 `outbound` 描述的是同一件
 * 事，内核不需要第二套搬运循环来判断。
 */
export interface RelayInboundInput {
  /** 客户端发来的帧。 */
  readonly frames: AsyncIterable<Frame>
  /**
   * 关闭客户端连接。
   *
   * 收尾规则是「一侧结束就对端一起结束」（见 `runRelay`），而关客户端这一半只有入口做得到。
   */
  close(reason?: Error): void
  /** 请求方向的修改器候选；省略即原样透传。 */
  readonly modifiers?: readonly Modifier[]
}

/** 非响应方向（客户端 → 上游）的搬运摘要。 */
export interface RelayInboundSummary {
  readonly frameCount: number
  readonly byteCount: number
  readonly ended: boolean
  readonly stopped: boolean
  readonly error: Error | null
}

/** 一次中继共有的输入，与「谁负责建连」无关。 */
export interface RelayInput {
  /** 客户端视角的交换投影；请求侧修改器跑完之后由调用方传入「待发版本」。 */
  readonly request: ExchangeView
  /** 客户端视角的交换投影，只用于观察者与修改器上下文。 */
  readonly exchange: ExchangeView
  readonly attempt: AttemptView
  readonly target: UpstreamTarget
  readonly sink: FrameSink
  readonly modifiers: readonly Modifier[]
  readonly observers: readonly Observer[]
  /** 尝试开始时刻，用于向观察者报告耗时。 */
  readonly startedAt: number
  /** 头帧落地回调；交付决策在这里做，早于任何字节写出。 */
  readonly onHead?: (head: HeadFrame) => void
  /** 双向交换的客户端侧输入；省略即单工。 */
  readonly inbound?: RelayInboundInput
}

export type RelayAttemptInput = RelayInput & {
  /**
   * 建连实现。它服务哪些传输形态写在 `Transport.transports` 上，由 `transports/registry.ts`
   * 按上游跳的形态选出，因此这里的类型是接口而不是一个形态取值。
   */
  readonly transport: Transport
}

export type RelayConnectedInput = RelayInput & { readonly connection: UpstreamConnection }

export interface RelayAttemptResult extends FramePipeResult {
  /**
   * 非响应方向（客户端 → 上游）的搬运摘要；单工传输为 `null`。
   *
   * 刻意不与正向字段合并：交付决策、failover 判定、首字节耗时都只看正向，反方向只用来描述
   * 「这条连接为什么结束了」。混在一起会让调用方以为两个方向是对称的，而它们不是——HTTP
   * 永远没有这一侧。
   */
  readonly inbound: RelayInboundSummary | null
  /**
   * 先结束的那一侧；单工传输恒为 `'response'`（只有这一侧）。
   *
   * 双向交换的「谁先挂」决定了断开的归因（上游断 vs 客户端断），因此不能事后从两个摘要里
   * 推——两边都可能是 `ended=false`。
   */
  readonly firstEnded: 'request' | 'response'
}

/**
 * 中继一次尝试：连上上游、把帧搬给出口、把事实告诉观察者。
 *
 * 与 `relayConnected` 的分工只有一件事：谁负责建连。分开是因为「先连上游、后答客户端」是 WS
 * 入口的硬约束（上游不支持 WS 时必须还能回一个 HTTP 426 才能让客户端回退到 HTTP，一旦回了
 * 101 就再也发不出这个信号），那种情况下调用方必须先自己建连。搬运本身两者共用同一份实现。
 */
export async function relayAttempt(input: RelayAttemptInput): Promise<RelayAttemptResult> {
  notifyObservers(input.observers, observer => observer.onAttemptStart?.(input.exchange, input.attempt, input.target))

  const connection = await input.transport.connect(input.target, input.request, input.attempt)
  return runRelay({ ...input, connection })
}

/** 中继一个调用方已经建好的上游连接。什么时候该用它见 `relayAttempt`。 */
export async function relayConnected(input: RelayConnectedInput): Promise<RelayAttemptResult> {
  notifyObservers(input.observers, observer => observer.onAttemptStart?.(input.exchange, input.attempt, input.target))
  return runRelay(input)
}

/**
 * 搬运本体。
 *
 * 内核里只有这一套搬运循环：单工跑一次帧管道；双向跑两次、方向相反、共用同一份上下文工厂，
 * 因此「多一种传输形状」不需要在这里加分支。
 *
 * 收尾规则有两条：
 * 1. 双向交换里**任何一侧结束，对端一起结束**——反方向先结束时必须关客户端，否则客户端会一直
 *    等一条已经死掉的连接；正向先结束时必须 abort 上游，并让反方向的下一次写入看见出口已关。
 * 2. **上游没有正常收尾就必须主动断开**——消费者提前 `break`（客户端断开、failover 提前放弃）时
 *    帧序列不会走到 `end`，不主动 abort 就会留下一条没人读的上游连接。
 */
async function runRelay(input: RelayConnectedInput): Promise<RelayAttemptResult> {
  const { connection, sink, inbound } = input
  let result: FramePipeResult | null = null
  let reverse: RelayInboundSummary | null = null
  let firstEnded: 'request' | 'response' = 'response'
  // 上游只能断一次：双向路径收尾时要主动断，`finally` 又要兜住「管道没正常结束」的情况，
  // 而这两种情况可以同时成立（例如上游发了 `close` 但没发 `end`）。传输层不该要求调用方
  // 自己数次数，所以这条不变式放在内核里。
  let aborted = false
  const abortUpstream = (): void => {
    if (aborted) return
    aborted = true
    connection.abort()
  }
  try {
    const upstreamToClient = pipeFrames({
      frames: connection.frames,
      sink,
      context: createModifierContext(input, 'response'),
      modifiers: input.modifiers,
      observers: input.observers,
      onHead: input.onHead,
    })
    if (!inbound) {
      result = await upstreamToClient
    } else {
      const outbound = connection.outbound
      if (!outbound) throw new Error(`The upstream connection for the bidirectional exchange has no write side: url=${input.target.url}`)
      // 反方向不挂观察者：观察者契约里的 `onUpstreamChunk` / `onDownstreamChunk` 说的是响应方向，
      // 套到上行帧上会产出「上游发来了一个字」这种假事实。
      const clientToUpstream = pipeFrames({
        frames: inbound.frames,
        sink: outbound,
        context: createModifierContext(input, 'request'),
        modifiers: inbound.modifiers ?? [],
      })
      const finished = await Promise.race([
        upstreamToClient.then(() => 'response' as const),
        clientToUpstream.then(() => 'request' as const),
      ])
      firstEnded = finished
      inbound.close()
      abortUpstream()
      const [forward, backward] = await Promise.allSettled([upstreamToClient, clientToUpstream])
      // 双向路径不抛出：两个方向都已经收完，而调用方（WS 入口）没有 failover 可做，抛出只会变成
      // 一次未处理拒绝。失败通过 `error` 交出去。
      result = forward.status === 'fulfilled' ? forward.value : failedPipeResult(forward.reason)
      reverse = summarize(backward)
    }
  } finally {
    if (!result || !result.ended) abortUpstream()
  }

  const outcome = {
    status: result.head?.status ?? null,
    durationMilliseconds: Date.now() - input.startedAt,
  }
  notifyObservers(input.observers, observer => observer.onAttemptEnd?.(input.exchange, input.attempt, outcome))
  console.debug(`[proxy] attempt relayed requestId=${input.exchange.requestId} attempt=${input.attempt.index} endpointId=${input.attempt.endpointId} transport=${input.exchange.transport} status=${outcome.status ?? 'none'} frames=${result.frameCount} bytes=${result.byteCount} duration=${outcome.durationMilliseconds}ms ended=${result.ended} stopped=${result.stopped}${reverse === null ? '' : ` inboundFrames=${reverse.frameCount} inboundBytes=${reverse.byteCount} inboundStopped=${reverse.stopped}`}`)
  return { ...result, inbound: reverse, firstEnded }
}

/**
 * 修改器上下文：两个方向共用同一份构造，只差 `direction`。
 *
 * `upstreamHead` 起手为 `null`，由帧管道收到头帧后逐帧补齐——请求方向同样如此，因为上行帧
 * 跑在响应头之前。
 *
 * 刻意**不**带 `transport` 的副本：那次交换的形态在 `exchange` 上已经有了，再拷一份就会留下
 * 「同一件事两个字段」的错位风险——写上三处、读到零处的那一份迟早与事实分叉。
 * 修改器要判断形态时读 `exchange`，或者在自己身上声明 `scope` 让内核代判。
 */
function createModifierContext(input: RelayConnectedInput, direction: ModifierDirection): ModifierContext {
  return {
    exchange: input.exchange,
    attempt: input.attempt,
    direction,
    clientProtocol: input.exchange.clientProtocol,
    upstreamProtocol: input.attempt.endpointProtocol,
    upstreamHead: null,
  }
}

function summarize(settled: PromiseSettledResult<FramePipeResult>): RelayInboundSummary {
  if (settled.status === 'fulfilled') {
    const { frameCount, byteCount, ended, stopped, error } = settled.value
    return { frameCount, byteCount, ended, stopped, error }
  }
  return { frameCount: 0, byteCount: 0, ended: false, stopped: false, error: toError(settled.reason) }
}

function failedPipeResult(reason: unknown): FramePipeResult {
  return { head: null, frameCount: 0, byteCount: 0, error: toError(reason), ended: false, stopped: false }
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}
