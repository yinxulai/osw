import type { Frame, FrameSink, HeadFrame, Modifier, ModifierContext, Observer } from '@server/proxy/contracts'
import { selectCandidates } from './modifier-selection'
import { notifyObservers } from './observer-notifications'

export interface FramePipeInput {
  /** 上游帧序列。 */
  readonly frames: AsyncIterable<Frame>
  /** 下游出口。 */
  readonly sink: FrameSink
  /** 本次交换的上下文；`direction` 决定管道执行哪一批修改器。 */
  readonly context: ModifierContext
  /** 候选修改器；管道按 `direction` / `frameMode` / `scope` 先筛一次，再在每一帧上问 `match`。 */
  readonly modifiers: readonly Modifier[]
  /** 观察者。只读且不改字节，抛错只丢掉自己的记录。 */
  readonly observers?: readonly Observer[]
  /**
   * 头帧落地回调，在修改器介入之前调用。
   *
   * 交付决策必须早于任何字节落地，因此这里是「这次响应到底给不给客户端」唯一的判断点。
   */
  readonly onHead?: (head: HeadFrame) => void
}

export interface FramePipeResult {
  /** 下游实际看到的响应头；`null` 表示头帧被修改器丢弃或上游没给出。 */
  readonly head: HeadFrame | null
  readonly frameCount: number
  readonly byteCount: number
  /** 上游故障；`null` 表示正常结束。 */
  readonly error: Error | null
  readonly ended: boolean
  /** 下游提前关闭，搬运被主动停止。 */
  readonly stopped: boolean
}

/**
 * 帧管道：把上游帧序列搬到下游出口。
 *
 * 这是内核里唯一的搬运循环，它自己不解析任何字节——「读懂报文」是修改器的职责，
 * 修改器不改的部分原样透传。因此新增一种协议或一种流式格式都不需要动这里，
 * 也不需要动传输层。
 *
 * 停止条件有三个：源结束、下游关闭（背压/取消）、出现 `end` 帧（防止传输层多吐）。
 * 无论哪种停止，都会 `break` 掉上游迭代器，触发传输层销毁连接。
 */
export async function pipeFrames(input: FramePipeInput): Promise<FramePipeResult> {
  const observers = input.observers ?? []
  // 上游原始头与「实际交付的头」必须分开：前者是谁都改不了的事实，后者可能被修改器改写。
  let upstreamHead: HeadFrame | null = null
  let emittedHead: HeadFrame | null = null
  let frameCount = 0
  let byteCount = 0
  let error: Error | null = null
  let ended = false
  let stopped = false
  /**
   * 结构性候选在上游回话之前就算完：它只取决于这次交换的形态（见 `selectCandidates`）。
   * `match` 不在这里篩——它可能依赖 `upstreamHead`，那要等到头帧到手才有答案。
   */
  const candidates = selectCandidates(input.modifiers, input.context, 'frame')

  for await (const frame of input.frames) {
    if (input.sink.closed) {
      stopped = true
      break
    }
    if (frame.kind === 'head' && upstreamHead === null) {
      upstreamHead = frame
      input.onHead?.(frame)
    }
    const context: ModifierContext = { ...input.context, upstreamHead }
    if (frame.kind === 'head') {
      notifyObservers(observers, observer => observer.onUpstreamHead?.(context.exchange, context.attempt, frame.status, frame.headers))
    } else if (frame.kind === 'data') {
      notifyObservers(observers, observer => observer.onUpstreamChunk?.(context.exchange, context.attempt, frame.body))
    }
    for (const next of await applyFrameModifiers(candidates, context, frame)) {
      if (next.kind === 'head') emittedHead = next
      else if (next.kind === 'data') {
        frameCount += 1
        byteCount += next.body.length
      } else if (next.kind === 'end') ended = true
      else if (next.kind === 'error') error = next.error
      await input.sink.write(next)
    }
    if (ended || error !== null) break
  }

  return { head: emittedHead, frameCount, byteCount, error, ended, stopped }
}

/**
 * 逐个修改器串联作用在一帧上：`match` 在这里现算（它可能依赖 `upstreamHead`），然后按 `order` 串联。
 * 修改器返回 `null` 表示丢弃这一帧；返回数组表示把一帧拆成多帧（例如 SSE 一次读到多条事件）；
 * 未实现 `applyFrame` 的修改器原样透传。
 */
async function applyFrameModifiers(modifiers: readonly Modifier[], context: ModifierContext, frame: Frame): Promise<readonly Frame[]> {
  let current: readonly Frame[] = [frame]
  for (const modifier of modifiers) {
    if (!modifier.match(context)) continue
    const next: Frame[] = []
    for (const candidate of current) {
      const result = await modifier.applyFrame?.(context, candidate)
      if (result === undefined) {
        next.push(candidate)
        continue
      }
      if (result === null) continue
      if (Array.isArray(result)) next.push(...(result as readonly Frame[]))
      else next.push(result as Frame)
    }
    current = next
    if (current.length === 0) break
  }
  return current
}
