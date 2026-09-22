import type { LiveRequest, LiveRequestEvent, LiveRequestEventLevel } from '@common/schemas'

/**
 * 「执行中的请求」那条时间轴。
 *
 * 这一层只做一件事：把台账里的原始事件翻成**一列能顺着读下去的事实**，而且完全不碰语言——
 * 文案交给组件按当前界面语言渲染。这么切有两个好处：结构可以在没有 React、没有 i18n 的地方
 * 单测；新加一种事件时只要在这里补一个分支，布局一行都不用动。
 *
 * 读不懂的事件既不会被丢掉，也不会拖垮整条时间轴：它落进 `raw`，原样展示事件名。
 * 契约层加事件的速度总是快过界面跟上，兜底是为了「暂时读不懂」，而不是「当它没发生」。
 */

/** 节点语气，决定圆点与文字的颜色。`active` 不出现在事件里，只留给时间轴末端那个「此刻」。 */
export type TimelineTone = 'neutral' | 'active' | 'success' | 'warn' | 'error'

/** 上游这一次应答的去向（`upstream.head` 的结论）。 */
export type UpstreamDisposition = 'success' | 'failover' | 'terminal'

/** 这次失败把健康度降到了哪一档（`route.failover` 的成因之一）。 */
export type HealthFailureScope = 'provider' | 'provider-model' | 'none'

/**
 * 一个节点要说的话：`kind` 决定取哪条文案，其余字段是它的插值参数。
 *
 * 字段一律「能缺就缺」（用 `null` 而不是就地编一个默认值），因为文案的取舍是语言层的事：
 * 缺一个数就把半句话编错，比少说半句糟得多。
 */
export type TimelineMessage =
  | { kind: 'received'; method: string; path: string }
  | { kind: 'routeResolved'; candidates: string[] }
  | { kind: 'attemptStart'; providerModelName: string | null; attemptNumber: number }
  | {
      kind: 'prepared'
      requestBytes: number
      appliedRules: number
      /** 命中的改写规则名；台账没带上名字时为 `[]`（此时只看 `appliedRules` 的个数）。 */
      appliedRuleNames: string[]
      converted: boolean
      /** 客户端跳的协议与上游跳的协议；任一侧读不到时不给展示。 */
      protocolFrom: string | null
      protocolTo: string | null
    }
  | {
      kind: 'upstreamHead'
      providerModelName: string | null
      httpStatus: number | null
      disposition: UpstreamDisposition | null
      mismatch: boolean
      /** 上游实际回的形态与客户端要的形态；用于解释形态不符。 */
      upstreamTransport: string | null
      requestedTransport: string | null
    }
  | { kind: 'firstByte'; providerModelName: string | null; ttftMilliseconds: number | null }
  | {
      kind: 'attemptFailed'
      attemptNumber: number
      httpStatus: number | null
      healthScope: HealthFailureScope
      nextProviderModelName: string | null
    }
  | { kind: 'completed'; httpStatus: number | null; durationMilliseconds: number | null }
  | { kind: 'failed'; reason: string | null }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; errorCode: string | null }
  | { kind: 'exhausted'; attemptCount: number | null; lastUpstreamStatus: number | null }
  | { kind: 'raw'; label: string }

/** 时间轴上的一个节点。 */
export interface TimelineNode {
  /** React key；同一毫秒里可能落进多条事件，所以还得带上序号。 */
  key: string
  /** 相对请求开始过去了多久。 */
  offsetMilliseconds: number
  tone: TimelineTone
  message: TimelineMessage
}

const TONE_BY_LEVEL: Record<LiveRequestEventLevel, TimelineTone> = {
  info: 'neutral',
  success: 'success',
  warn: 'warn',
  error: 'error',
}

/**
 * 把一份台账快照摊成时间轴。
 *
 * 头一个节点是**合成**的「收到请求」：台账的 `begin` 不产生事件（它发生在解析路径之前，
 * 那时连协议都还不知道），但读者需要一个起点，否则这条轴上第一句话会是「已选定落点」，
 * 像是路由凭空发生的。
 */
export function timelineOf(live: LiveRequest): TimelineNode[] {
  const nodes: TimelineNode[] = [
    {
      key: 'received',
      offsetMilliseconds: 0,
      tone: 'neutral',
      message: { kind: 'received', method: live.method, path: live.path },
    },
  ]

  live.events.forEach((event, index) => {
    nodes.push({
      key: `${event.at}-${index}`,
      offsetMilliseconds: event.offsetMilliseconds,
      tone: TONE_BY_LEVEL[event.level],
      message: messageOf(event, live),
    })
  })

  return nodes
}

function messageOf(event: LiveRequestEvent, live: LiveRequest): TimelineMessage {
  // `detail` 在契约里是「一串字符串/数字/布尔」，但它是跨进程传过来的快照：
  // 字段缺席或类型意外时只该让某一格读不出来，不该让整条时间轴炸掉。
  const detail: Record<string, unknown> = event.detail ?? {}

  switch (event.kind) {
    case 'route.resolved':
      // 候选名单比起一个数字有用得多：它把「为何会试到第二家」提前写在了轴上。
      return { kind: 'routeResolved', candidates: live.candidates.map(candidate => candidate.providerModelName) }

    case 'attempt.start': {
      // 契约里这一格是 0 起的序号，界面上从 1 数起。
      const index = numberAt(detail, 'index')
      return {
        kind: 'attemptStart',
        providerModelName: stringAt(detail, 'providerModelName'),
        attemptNumber: index === null ? 1 : index + 1,
      }
    }

    case 'request.prepared': {
      // 这一格只在「真的改了什么」时才有（命中改写规则 / 做了协议转换），因此它出现就是事实。
      // 名字与协议两跳都得从台账里查：事件里只带一个计数、一个布尔。
      const attempt = numberAt(detail, 'attempt')
      return {
        kind: 'prepared',
        requestBytes: numberAt(detail, 'requestBytes') ?? 0,
        appliedRules: numberAt(detail, 'appliedRules') ?? 0,
        appliedRuleNames: ruleNamesByAttempt(live, attempt),
        converted: booleanAt(detail, 'protocolConverted'),
        protocolFrom: live.clientProtocol,
        protocolTo: endpointProtocolByAttempt(live, attempt),
      }
    }

    case 'upstream.head': {
      // 这一格是 1 起的尝试序号，拿它回台账里查是哪家上游。事件本身不带上游名，
      // 因为请求发出去的那一刻，对方会以什么面目回应还没定。
      const attempt = numberAt(detail, 'attempt')
      return {
        kind: 'upstreamHead',
        providerModelName: providerModelNameByAttempt(live, attempt),
        httpStatus: numberAt(detail, 'httpStatus'),
        disposition: dispositionAt(detail),
        mismatch: booleanAt(detail, 'transportMismatch'),
        upstreamTransport: stringAt(detail, 'upstreamTransport'),
        requestedTransport: live.transport,
      }
    }

    case 'upstream.first-byte': {
      const attempt = numberAt(detail, 'attempt')
      return {
        kind: 'firstByte',
        providerModelName: providerModelNameByAttempt(live, attempt),
        ttftMilliseconds: numberAt(detail, 'ttftMilliseconds'),
      }
    }

    case 'route.failover':
      return {
        kind: 'attemptFailed',
        attemptNumber: numberAt(detail, 'attempt') ?? 1,
        httpStatus: numberAt(detail, 'httpStatus'),
        healthScope: healthScopeAt(detail),
        nextProviderModelName: stringAt(detail, 'nextProviderModelName'),
      }

    case 'request.completed':
      return {
        kind: 'completed',
        httpStatus: numberAt(detail, 'httpStatus'),
        durationMilliseconds: numberAt(detail, 'durationMilliseconds'),
      }

    case 'request.failed': {
      const httpStatus = numberAt(detail, 'httpStatus')
      return { kind: 'failed', reason: httpStatus === null ? stringAt(detail, 'errorCode') : `HTTP ${httpStatus}` }
    }

    case 'request.cancelled':
    case 'request.aborted':
      return { kind: 'cancelled' }

    case 'request.rejected':
    case 'request.rewrite_rejected':
      return { kind: 'rejected', errorCode: stringAt(detail, 'errorCode') }

    case 'request.exhausted':
      return {
        kind: 'exhausted',
        attemptCount: numberAt(detail, 'attempts'),
        // 没有上游回过头时核心侧写的是字面量 `'none'`，`numberAt` 会把它读成 `null`。
        lastUpstreamStatus: numberAt(detail, 'lastUpstreamStatus'),
      }

    default:
      return { kind: 'raw', label: event.kind }
  }
}

/** 事件里的尝试序号是 1 起的，台账数组是 0 起的。 */
function providerModelNameByAttempt(live: LiveRequest, attempt: number | null): string | null {
  if (attempt === null) return null
  return live.attempts[attempt - 1]?.providerModelName ?? null
}

function endpointProtocolByAttempt(live: LiveRequest, attempt: number | null): string | null {
  if (attempt === null) return null
  return live.attempts[attempt - 1]?.endpointProtocol ?? null
}

function ruleNamesByAttempt(live: LiveRequest, attempt: number | null): string[] {
  if (attempt === null) return []
  return live.attempts[attempt - 1]?.requestRewriteRuleNames ?? []
}

function dispositionAt(detail: Record<string, unknown>): UpstreamDisposition | null {
  const value = detail['disposition']
  return value === 'success' || value === 'failover' || value === 'terminal' ? value : null
}

function healthScopeAt(detail: Record<string, unknown>): HealthFailureScope {
  const value = detail['healthFailureScope']
  return value === 'provider' || value === 'provider-model' ? value : 'none'
}

function stringAt(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberAt(detail: Record<string, unknown>, key: string): number | null {
  const value = detail[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanAt(detail: Record<string, unknown>, key: string): boolean {
  return detail[key] === true
}
