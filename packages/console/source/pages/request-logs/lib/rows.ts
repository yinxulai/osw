import type { LiveRequest, RequestLogEntry } from '@common/schemas'
import { isRequestExecuting } from './execution'

/**
 * 请求列表里的一行。
 *
 * 列表只有一张，但一行可以是两种东西：
 *
 * - `execution` —— **正在执行**：内容来自代理进程内存里的台账，展开是「实时执行详情」。
 * - `log` —— **已经结束**：内容来自数据库，展开是「请求执行详情」。
 *
 * 用同一个列表装两种行，是这一页最重要的取舍：进行中的请求不是另一张表，而是同一张表的
 * 最新那几行。用户不需要在两个地方找同一条请求，也不会在请求落定的那一刻看见它「跳」走。
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
}

/**
 * 把库里的记录与内存里的台账合成一页要显示的行。
 *
 * **顺序、分页、筛选一律由数据库那一份决定**，台账只做两件事：
 *
 * 1. 同 id 的行换成实时视图（只要它还没真正落定）。
 * 2. 把台账里还没有对应记录的请求**补在最前面**。
 *
 * 第 2 条不是重复：库里的 `pending` 行是请求入口写下的一副空壳，而「不记录请求日志」
 * 打开时它根本不会写。补的是「已经在跑」这件事本身，而不是任何一条落库事实。
 *
 * `injectLive` 关掉时只做第 1 条——筛选与翻页是用户明确的意图，
 * 补进去的行会绕过它们（比如按「失败」筛选却冒出几条进行中的请求）。
 */
export function buildRequestLogRows(input: BuildRequestLogRowsInput): RequestLogsRow[] {
  const liveById = new Map(input.liveRequests.map(request => [request.id, request]))
  const rows = input.logs.map((log): RequestLogsRow => {
    const live = liveById.get(log.id)
    if (isRequestExecuting(live, log.status)) return { kind: 'execution', live }
    return { kind: 'log', log }
  })

  if (!input.injectLive) return rows
  const known = new Set(input.logs.map(log => log.id))
  const injected = input.liveRequests
    .filter(request => request.status === 'pending' && !known.has(request.id))
    .map((request): RequestLogsRow => ({ kind: 'execution', live: request }))
  return [...injected, ...rows]
}
