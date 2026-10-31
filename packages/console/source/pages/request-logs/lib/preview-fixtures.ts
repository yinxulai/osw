import type { LiveRequest, LiveRequestAttempt, LiveRequestEvent, LiveRequestEventLevel } from '@common/schemas'

/**
 * 「执行中的请求行」单独渲染时用的假台账。
 *
 * 这一行平时只依赖代理进程内存里的实时推送（`LiveRequestsProvider` 那条 NDJSON 流），
 * 界面上很难凑齐各种阶段——尤其是「刚路由完还没发出去」「上游回了头但还没吐字」
 * 「第一家失败改试第二家」这几种，它们只存在几百毫秒。想看清这一行长什么样，
 * 就得把台账凭空造出来。
 *
 * 造的数据必须**遵守契约**（`LiveRequestSchema`）：字段一个不少、事件名与
 * `lib/timeline.ts` 认识的取值一致。否则预览出来的是另一套东西，据此改设计等于白改。
 *
 * 时间基准取模块加载那一刻：行里的「已用时」自己走秒（`useTickingNow`），
 * 所以越看越久，正好能看出这一行是不是稳、会不会抖。
 *
 * 这是开发期草稿，**只被 `?preview=1` 那个分支引用**，不参与任何生产路径。
 */

/** 所有时刻都相对它，保证「已用时」从几秒开始往上涨。 */
const ORIGIN = Date.now()

/** 造一条时间轴事件。签名必须单行（`peculiar/func-signature-linebreak`）。 */
function event(offsetMilliseconds: number, kind: string, level: LiveRequestEventLevel, detail: Record<string, string | number | boolean> | null = null): LiveRequestEvent {
  return { at: ORIGIN + offsetMilliseconds, offsetMilliseconds, kind, level, detail }
}

const CANDIDATE_A = {
  providerId: 'prov_a',
  providerName: 'Nebula',
  providerModelId: 'pm_a',
  providerModelName: 'nebula-x1',
}

const CANDIDATE_B = {
  providerId: 'prov_b',
  providerName: 'Lumen',
  providerModelId: 'pm_b',
  providerModelName: 'lumen-large',
}

const CANDIDATE_C = {
  providerId: 'prov_c',
  providerName: 'Vega',
  providerModelId: 'pm_c',
  providerModelName: 'vega-mini',
}

function attemptOf(overrides: Partial<LiveRequestAttempt> = {}): LiveRequestAttempt {
  return {
    index: 0,
    providerId: CANDIDATE_A.providerId,
    providerName: CANDIDATE_A.providerName,
    providerModelId: CANDIDATE_A.providerModelId,
    providerModelName: CANDIDATE_A.providerModelName,
    endpointProtocol: 'openai-responses',
    url: 'https://example.invalid/v1/responses',
    state: 'connecting',
    httpStatus: null,
    upstreamTransport: null,
    upstreamRequestId: null,
    requestBytes: 12_480,
    requestRewriteRuleNames: [],
    upstreamBytes: 0,
    downstreamBytes: 0,
    chunkCount: 0,
    chunkPreview: null,
    ttftMilliseconds: null,
    inputTokens: null,
    outputTokens: null,
    errorMessage: null,
    startedAt: ORIGIN,
    endedAt: null,
    ...overrides,
  }
}

function liveOf(overrides: Partial<LiveRequest> & Pick<LiveRequest, 'id' | 'startedAt'>): LiveRequest {
  return {
    status: 'pending',
    phase: 'routing',
    logicalModelId: 'model_preview',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/responses',
    updatedAt: ORIGIN,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

/** ① 刚收到，还没决定发给谁。 */
const routingCase = liveOf({
  id: 'req_preview_routing',
  phase: 'routing',
  startedAt: ORIGIN - 340,
  candidates: [],
})

/** ② 候选已选定，正在连上游：落点是哪个已经知道，字节一个都还没动。 */
const connectingCase = liveOf({
  id: 'req_preview_connecting',
  phase: 'connecting',
  startedAt: ORIGIN - 980,
  candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C],
  attempts: [attemptOf({ index: 0, state: 'connecting', startedAt: ORIGIN - 320 })],
  events: [
    event(20, 'route.resolved', 'info', { candidates: 3 }),
    event(660, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_A.providerModelName }),
  ],
})

/** ③ 请求已发出，等上游回头：请求体大小、命中过的改写规则都已经有值。 */
const awaitingUpstreamCase = liveOf({
  id: 'req_preview_awaiting_upstream',
  phase: 'awaiting-upstream',
  startedAt: ORIGIN - 2_100,
  candidates: [CANDIDATE_A, CANDIDATE_B],
  attempts: [
    attemptOf({
      index: 0,
      state: 'awaiting-upstream',
      startedAt: ORIGIN - 1_740,
      requestBytes: 24_576,
      requestRewriteRuleNames: ['Strip anthropic beta headers', 'Force stream usage'],
    }),
  ],
  events: [
    event(18, 'route.resolved', 'info', { candidates: 2 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_A.providerModelName }),
    event(430, 'request.prepared', 'info', { attempt: 1, requestBytes: 24_576, protocolConverted: false }),
  ],
})

/** ④ 上游回了 200，但第一个字节还没来：TTFT 这一格是空的，正好能看占位。 */
const awaitingFirstByteCase = liveOf({
  id: 'req_preview_awaiting_first_byte',
  phase: 'awaiting-first-byte',
  startedAt: ORIGIN - 3_420,
  candidates: [CANDIDATE_B],
  attempts: [
    attemptOf({
      index: 0,
      providerName: CANDIDATE_B.providerName,
      providerModelName: CANDIDATE_B.providerModelName,
      state: 'awaiting-upstream',
      startedAt: ORIGIN - 3_060,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      requestBytes: 18_432,
      requestRewriteRuleNames: ['Fit context window'],
    }),
  ],
  events: [
    event(14, 'route.resolved', 'info', { candidates: 1 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_B.providerModelName }),
    event(402, 'request.prepared', 'info', { attempt: 1, requestBytes: 18_432, protocolConverted: true }),
    event(1_180, 'upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'success' }),
  ],
})

/** ⑤ 正常在流：Token、TTFT、TPS、分块预览全都有值——这是最常被看到的那一屏。 */
const streamingCase = liveOf({
  id: 'req_preview_streaming',
  phase: 'streaming',
  startedAt: ORIGIN - 5_800,
  candidates: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C],
  attempts: [
    attemptOf({
      state: 'streaming',
      startedAt: ORIGIN - 5_440,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      upstreamRequestId: 'req_011CSteamingA1b2',
      requestBytes: 31_744,
      requestRewriteRuleNames: ['Force stream usage'],
      upstreamBytes: 8_192,
      downstreamBytes: 7_940,
      chunkCount: 64,
      chunkPreview: 'data: {"choices":[{"delta":{"content":"Streaming is"}}]}',
      ttftMilliseconds: 640,
      inputTokens: 1_842,
      outputTokens: 986,
    }),
  ],
  events: [
    event(16, 'route.resolved', 'info', { candidates: 3 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_A.providerModelName }),
    event(402, 'request.prepared', 'info', { attempt: 1, requestBytes: 31_744, protocolConverted: false }),
    event(1_000, 'upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'success' }),
    event(1_080, 'upstream.first-byte', 'success', { attempt: 1, ttftMilliseconds: 640 }),
  ],
})

/** ⑥ 第一家 429，改试第二家成功：`+1` 徽标、两条尝试、时间轴上一条 warn。 */
const failoverCase = liveOf({
  id: 'req_preview_failover',
  phase: 'streaming',
  startedAt: ORIGIN - 9_100,
  candidates: [CANDIDATE_C, CANDIDATE_B],
  attempts: [
    attemptOf({
      index: 0,
      providerName: CANDIDATE_C.providerName,
      providerModelName: CANDIDATE_C.providerModelName,
      state: 'failed',
      startedAt: ORIGIN - 8_740,
      endedAt: ORIGIN - 7_900,
      httpStatus: 429,
      errorMessage: 'Rate limited',
    }),
    attemptOf({
      index: 1,
      providerName: CANDIDATE_B.providerName,
      providerModelName: CANDIDATE_B.providerModelName,
      state: 'streaming',
      startedAt: ORIGIN - 7_860,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      upstreamRequestId: 'chatcmpl-PreviewFailover',
      requestBytes: 31_744,
      upstreamBytes: 2_048,
      downstreamBytes: 2_012,
      chunkCount: 12,
      chunkPreview: 'data: {"type":"content_block_delta","delta":{"text":"Here"}}',
      ttftMilliseconds: 520,
      inputTokens: 1_998,
      outputTokens: 214,
    }),
  ],
  events: [
    event(12, 'route.resolved', 'info', { candidates: 2 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_C.providerModelName }),
    event(402, 'request.prepared', 'info', { attempt: 1, requestBytes: 31_744, protocolConverted: false }),
    event(1_200, 'upstream.head', 'warn', { attempt: 1, httpStatus: 429, disposition: 'failover' }),
    event(1_240, 'route.failover', 'warn', {
      attempt: 1,
      httpStatus: 429,
      nextProviderModelName: CANDIDATE_B.providerModelName,
      healthFailureScope: 'provider-model',
    }),
    event(1_280, 'attempt.start', 'info', { index: 1, providerModelName: CANDIDATE_B.providerModelName }),
    event(1_322, 'request.prepared', 'info', { attempt: 2, requestBytes: 31_744, protocolConverted: false }),
    event(2_760, 'upstream.head', 'success', { attempt: 2, httpStatus: 200, disposition: 'success' }),
    event(2_840, 'upstream.first-byte', 'success', { attempt: 2, ttftMilliseconds: 520 }),
  ],
})

/**
 * ⑦ 落定在「等响应头」：请求发出去了，上游始终没回头。尺子亮到第 3 格就停住，
 *    后面两格全暗——这就是「失败在第几步」，一句「失败」说不出来的东西。
 */
const failedAtHeadCase = liveOf({
  id: 'req_preview_failed_at_head',
  status: 'failed',
  phase: 'settled',
  startedAt: ORIGIN - 12_400,
  endedAt: ORIGIN - 9_400,
  candidates: [CANDIDATE_A],
  attempts: [
    attemptOf({
      index: 0,
      state: 'failed',
      startedAt: ORIGIN - 12_040,
      endedAt: ORIGIN - 9_400,
      errorMessage: 'Upstream timed out while waiting for response headers',
    }),
  ],
  events: [
    event(20, 'route.resolved', 'info', { candidates: 1 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_A.providerModelName }),
    event(402, 'request.prepared', 'info', { attempt: 1, requestBytes: 18_240, protocolConverted: false }),
    event(3_000, 'request.failed', 'error', { errorCode: 'upstream_timeout' }),
  ],
})

/** ⑧ 落定且交付完成：五格全亮、最后一格不再呼吸，底色换成结果色。 */
const settledSuccessCase = liveOf({
  id: 'req_preview_settled_success',
  status: 'success',
  phase: 'settled',
  startedAt: ORIGIN - 18_700,
  endedAt: ORIGIN - 16_300,
  candidates: [CANDIDATE_A],
  attempts: [
    attemptOf({
      index: 0,
      state: 'success',
      startedAt: ORIGIN - 18_340,
      endedAt: ORIGIN - 16_300,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      upstreamRequestId: 'req_011CSettled0k9f',
      requestBytes: 18_240,
      upstreamBytes: 4_096,
      downstreamBytes: 4_012,
      chunkCount: 26,
      ttftMilliseconds: 610,
      inputTokens: 1_240,
      outputTokens: 386,
    }),
  ],
  events: [
    event(20, 'route.resolved', 'info', { candidates: 1 }),
    event(360, 'attempt.start', 'info', { index: 0, providerModelName: CANDIDATE_A.providerModelName }),
    event(402, 'request.prepared', 'info', { attempt: 1, requestBytes: 18_240, protocolConverted: false }),
    event(970, 'upstream.head', 'success', { attempt: 1, httpStatus: 200, disposition: 'success' }),
    event(1_010, 'upstream.first-byte', 'success', { attempt: 1, ttftMilliseconds: 610 }),
    event(2_400, 'request.completed', 'success', { httpStatus: 200, durationMilliseconds: 2_400 }),
  ],
})

/**
 * 预览里要铺开的全部场景，**按一条请求真实的推进顺序排列**。
 *
 * 顺序本身是说明的一部分：从上往下读，就是同一行从「刚收到」到「正在流」的六张面孔，
 * 最后两张是它落定之后的样子——尺子留在原地、只是不再呼吸。后者平时几乎看不见
 * （请求几秒就跑完），而「失败在第几步」正是它要回答的问题。
 */
export const PREVIEW_LIVE_REQUESTS: LiveRequest[] = [
  routingCase,
  connectingCase,
  awaitingUpstreamCase,
  awaitingFirstByteCase,
  streamingCase,
  failoverCase,
  failedAtHeadCase,
  settledSuccessCase,
]

/** 预览默认展开哪一条：正在流的那条，展开区里的信息最全。 */
export const PREVIEW_DEFAULT_EXPANDED_ID = streamingCase.id
