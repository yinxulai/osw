import type { TimelineMessage, TimelineNode } from './timeline'

/**
 * 把时间轴按「尝试」切段。
 *
 * 一条请求最值得读的结构不是「一共有多少条事件」，而是**它试了几家、每家花了多久、为什么
 * 放弃**。平铺的事件列表把这三件事埋在十几行等重的叉里：读者要自己找出 `改试` 那行才知道
 * 换过家，再往回数才知道第一家长什么样。切段之后，每次尝试是一个有开头（发往谁）、有结尾
 * （什么结局）、有长度（花了多久）的整体，事件只是段内细节。
 *
 * 段头那一行不来自任何事件，是**归纳**出来的：它把「发往 X」这条 `attempt.start` 事件
 * 提成标题，再把该段首尾事件的时间差算成耗时。这正是划线本身要回答的问题，而事件流只能
 * 回答「发生了什么」。
 *
 * 分组只按 `attempt.start` 切：它出现就开新段，其余事件一律归当前段。于是收尾事件
 * （`request.completed` / `request.failed`）自然落在最后一次尝试里——它们确实是那次尝试的
 * 结论，而不是请求级的一段。
 */

/** 一次尝试的结局，决定段头那枚序号圈的颜色。 */
export type AttemptOutcome = 'running' | 'failed' | 'succeeded' | 'cancelled'

/** 时间轴上的一个段：请求级（`attemptNumber === 0`）或某一次尝试。 */
export interface TimelineGroup {
  /** React key。 */
  key: string
  /** 0 表示请求级（收到请求、选定落点），1 起是第几次尝试。 */
  attemptNumber: number
  /** 这次尝试发往谁（`供应商/模型`）；请求级为 `null`。 */
  target: string | null
  /** 本段第一条事件的相对时刻。 */
  startMilliseconds: number
  /** 本段最后一条事件的相对时刻。 */
  endMilliseconds: number
  outcome: AttemptOutcome
  nodes: TimelineNode[]
}

export function groupTimeline(nodes: readonly TimelineNode[]): TimelineGroup[] {
  const first = nodes[0]
  if (first === undefined) return []

  const head: TimelineGroup = {
    key: 'request',
    attemptNumber: 0,
    target: null,
    startMilliseconds: first.offsetMilliseconds,
    endMilliseconds: first.offsetMilliseconds,
    outcome: 'running',
    nodes: [],
  }
  const groups: TimelineGroup[] = [head]
  let current = head

  for (const node of nodes) {
    // `attempt.start` 是分段的唯一依据：它把「换个家再试」这件事写成了事件，
    // 而其余事件要么属于它之前（选落点），要么属于它之后（这次尝试的细节）。
    if (node.message.kind === 'attemptStart') {
      current = {
        key: `attempt-${node.message.attemptNumber}`,
        attemptNumber: node.message.attemptNumber,
        target: node.message.providerModelName,
        startMilliseconds: node.offsetMilliseconds,
        endMilliseconds: node.offsetMilliseconds,
        outcome: 'running',
        nodes: [],
      }
      groups.push(current)
    }
    current.nodes.push(node)
    current.endMilliseconds = node.offsetMilliseconds
    current.outcome = outcomeAfter(current.outcome, node.message)
  }

  return groups
}

/**
 * 结局只认**第一次**给出的答案。
 *
 * 一次尝试的结局在它结束那一刻就定了，之后发生在同段里的事件（请求级收尾）不该改写它：
 * 第一家回了 429 就是失败，哪怕整条请求最后靠第二家成功。先到先得比「最后一个事件说了算」
 * 更贴近「这次尝试是什么」。
 */
function outcomeAfter(current: AttemptOutcome, message: TimelineMessage): AttemptOutcome {
  if (current !== 'running') return current

  switch (message.kind) {
    case 'attemptFailed':
    case 'failed':
    case 'exhausted':
    case 'rejected':
      return 'failed'

    case 'cancelled':
      return 'cancelled'

    case 'completed':
      return 'succeeded'

    // `upstream.head` 的结论就是这次尝试的结论：决定交付即成功，决定改试/终止则等下一行说。
    case 'upstreamHead':
      return message.disposition === 'success' ? 'succeeded' : current

    default:
      return current
  }
}
