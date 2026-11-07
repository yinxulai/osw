import type { LiveRequest, RequestLogEntry, RequestStatus } from '@common/schemas'
import { isRequestExecuting } from './execution'

/**
 * 请求列表里的一行。
 *
 * 列表只有一张，但一行可以是两种东西：
 *
 * - `execution` —— **用实时形态**：内容来自代理进程内存里的台账，展开是「实时执行详情」。
 * - `log` —— **用落库形态**：内容来自数据库，展开是「请求执行详情」。
 *
 * 用同一个列表装两种行，是这一页最重要的取舍：进行中的请求不是另一张表，而是同一张表的
 * 最新那几行。用户不需要在两个地方找同一条请求，也不会在请求落定的那一刻看见它「跳」走。
 *
 * 选哪种形态只看 {@link shouldUseLiveRow}，不要在其他地方再写一遍。
 */
export type RequestLogsRow =
  | { kind: 'execution'; live: LiveRequest }
  | { kind: 'log'; log: RequestLogEntry }

interface BuildRequestLogRowsInput {
  /** 落库的记录，本页本筛选的那一批，顺序即展示顺序。 */
  logs: RequestLogEntry[]
  /** 台账里的全部请求（进行中在前）。 */
  liveRequests: LiveRequest[]
  /** 是否允许补入「台账里有、这一页却没有」的请求；筛选与翻页会把它关掉。 */
  injectLive: boolean
  /** 用户正展开的那一条；`null` 表示没有。 */
  expandedId: string | null
}

/**
 * 台账快照在前端可被复用超过服务端保留窗口（例如连接空闲时只收心跳，不会立刻再推快照）。
 * 这时一条早已结束的请求不该继续占着「实时形态」。
 */
const STALE_SETTLED_LIVE_ROW_MAX_AGE_MS = 60_000

function isFreshSettledLive(live: LiveRequest, now: number): boolean {
  if (live.status === 'pending') return true
  if (live.endedAt === null) return true
  return now - live.endedAt <= STALE_SETTLED_LIVE_ROW_MAX_AGE_MS
}

/**
 * 这一行此刻该用实时形态还是落库形态。**整个页面只有这一处判断。**
 *
 * 规则：
 *
 * 1. **过期快照先淘汰。** 台账里的已落定请求超过保留窗口后，不再继续当作实时行展示。
 * 2. **展开着的保持实时形态。** 用户正盯着它看，把内容换掉等于从他手里抢走。
 * 3. **其余按实际状态。** 台账说还在跑、或者库里那一行还停在 `pending`（落库比推送慢
 *    最多 1.5s），就是还在跑；两边都说结束了，就交回落库那一份。
 */
export function shouldUseLiveRow(
  live: LiveRequest | undefined,
  logStatus: RequestStatus | undefined,
  expandedId: string | null,
  now = Date.now(),
): live is LiveRequest {
  if (live === undefined) return false
  if (!isFreshSettledLive(live, now) && logStatus !== 'pending') return false
  if (expandedId === live.id) return true
  return isRequestExecuting(live, logStatus)
}

/**
 * 把库里的记录与内存里的台账合成一页要显示的行。
 *
 * **顺序、分页、筛选一律由数据库那一份决定**，台账只做两件事：
 *
 * 1. 同 id 的行按 {@link shouldUseLiveRow} 决定用哪一份。
 * 2. 把台账里还没有对应记录的请求**补在最前面**。
 *
 * 第 2 条不是重复：库里的 `pending` 行是请求入口写下的一副空壳，而「不记录请求日志」
 * 打开时它根本不会写；写入本身也可能失败或比推送慢一拍。补的是「这件事发生过」本身，
 * 而不是任何一条落库事实。
 *
 * `injectLive` 关掉时只做第 1 条——筛选与翻页是用户明确的意图，
 * 补进去的行会绕过它们（比如按「失败」筛选却冒出几条进行中的请求）。
 */
export function buildRequestLogRows(input: BuildRequestLogRowsInput): RequestLogsRow[] {
  const liveById = new Map(input.liveRequests.map(request => [request.id, request]))
  const rows = input.logs.map((log): RequestLogsRow => {
    const live = liveById.get(log.id)
    if (shouldUseLiveRow(live, log.status, input.expandedId)) return { kind: 'execution', live }
    return { kind: 'log', log }
  })

  if (!input.injectLive) return rows
  const known = new Set(input.logs.map(log => log.id))
  // 补入走同一条规则，只是把库里的状态当作「不知道」（`undefined`）——这些请求
  // **恰恰**没有落库记录，谈不上「库里说它结束了」。
  //
  // 于是补进来的只有两种：还在跑的；以及用户正展开着的。一条已经跑完、库里有它的请求
  // 不该在这里多出一行（那是重复），一条已经跑完、库里没有它的请求也不该凭空占位
  // （那是谎）——除非用户正打开着它，那不归内容管，归他的手管。
  const injected = input.liveRequests
    .filter(request => !known.has(request.id) && shouldUseLiveRow(request, undefined, input.expandedId))
    .map((request): RequestLogsRow => ({ kind: 'execution', live: request }))
  return [...injected, ...rows]
}
