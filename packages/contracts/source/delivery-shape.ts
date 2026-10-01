import type { TransportKind } from './schemas'

/**
 * 正文的交付形态：手里这堆字节是**一整份**，还是**一段段流**，还是**双向多轮**。
 *
 * 它是 `TransportKind` 的函数，也是**唯一**同时被响应出口、响应修改器与改写规则引擎
 * 读到的轴：出口按它选「边收边发」还是「攒完再发」；修改器按它声明「这种形态下它没有
 * 能做的事」；引擎按它回答「这份正文能不能按路径改」。
 *
 * 之所以要有这个名字，是因为此前有三处各判各的：出口判 `transport === 'http-stream'`、
 * 修改器声明 `scope.transports: ['http']`、引擎在响应阶段再判一次。三式在当时的取值域
 * 里恰好等价，那是巧合——一旦多一种形态（或 `websocket` 落地），三处就会分叉。
 *
 * **不接受「其余都是整包」这种写法。** 曾经它是 `transport === 'http-stream' ? 'incremental' : 'whole'`：
 * 那个 `: 'whole'` 把 `websocket`（双向多轮，已声明未实现）也归成了「整包」，
 * 于是「入口对 WS 请求回 501」与「试跑说这份正文能改」成了同一系统的两个答案。
 * 现在枚举是穷尽的，未实现的形态有自己的取值，新增一种 transport 会在编译期就逼你表态。
 */
export type BodyDeliveryShape = 'whole' | 'incremental' | 'duplex'

/** 形态 → 交付方式，负责把「这一跳是什么连接」翻成「正文怎么回来」。 */
const SHAPE_BY_TRANSPORT: Record<TransportKind, BodyDeliveryShape> = {
  // 一问一答，响应体整包回来（非流式）。
  http: 'whole',
  // 一问一答，响应体逐帧回来（SSE）。
  'http-stream': 'incremental',
  // 双向多轮：既不是一整份、也不是单向下行的分块，正文压根不是「一次交付」这个概念。
  websocket: 'duplex',
}

/**
 * 这次交付的正文形态。
 *
 * 表是穷尽的 `Record<TransportKind, BodyDeliveryShape>`，`TransportKind` 新增取值时这里
 * 编译不过——这正是要的：形态的判定不能靠一个兜底分支蒙混过去。
 */
export function bodyDeliveryShape(transport: TransportKind): BodyDeliveryShape {
  return SHAPE_BY_TRANSPORT[transport]
}

/**
 * 一次交换的**阶段×形态**支持度。它是「这个阶段的改写动作，在交付形态下算怎么回事」的答案。
 *
 * 三种取值刻意分开，因为下游对它们的反应本来就不同：
 *
 * - `supported`：动作能按路径改这份正文，正常执行。
 * - `skipped`：**当前没有能做的事**，但这只是今天的设计边界，不是形态本身不允许
 *   （响应阶段的流式就是这种：正文是一段段 SSE 文本，规则动作是在一整份 JSON 上按路径
 *   取值，没有它能在上面做的动作；事件级改写是独立设计评审后才能上的能力，见
 *   `docs/product/request-rewrite-rules.md` §12 的 D 行）。逐条跳过，并把原因报上去。
 * - `not-applicable`：这种形态下**这个阶段根本不存在**，不是「改不了」而是「没有可改的
 *   东西」——WebSocket 是双向多轮，压根没有「一份响应正文」这个概念。这属于调用方用错，
 *   应当立刻报错，而不是静默当成「跳过」。
 *
 * 把 `skipped` 与 `not-applicable` 分开，是因为「**今天不做**」与「**做不了**」混为一谈
 * 正是这个模块要修的老毛病：混着混着，用户就会在试跑里看到「这份 WebSocket 响应改造成
 * 功了」，而真实入口对同一个请求回的是 501。
 */
export type StageShapeSupport = 'supported' | 'skipped' | 'not-applicable'

/**
 * 阶段×形态的支持度表。
 *
 * - 请求阶段：请求总是整份读完再发（`request-modifiers.ts` 的三个修改器都是
 *   `frameMode: 'buffered'`），三个形态下都有整份请求体可改，因此一律 `supported`。
 * - 响应阶段：只有 `whole` 支持；`incremental` 是「今天不做」；`duplex` 是「这个阶段不存在」。
 *
 * 表是穷尽的，`TransportKind` 或 `BodyDeliveryShape` 新增取值时这里编译不过——这正是要的：
 * 新形态必须显式表态，不能靠兜底分支蒙混。
 */
export function stageShapeSupport(stage: 'request' | 'response', shape: BodyDeliveryShape): StageShapeSupport {
  if (stage === 'request') return 'supported'
  return shape === 'whole' ? 'supported' : shape === 'incremental' ? 'skipped' : 'not-applicable'
}

/**
 * 便捷判断：这个阶段在这种形态下有没有能做的事（即 `supported`）。
 *
 * 只回答「是不是支持」，不区分「跳过」与「不适用」；需要区分时用 {@link stageShapeSupport}。
 */
export function isStageRunnable(stage: 'request' | 'response', shape: BodyDeliveryShape): boolean {
  return stageShapeSupport(stage, shape) === 'supported'
}
