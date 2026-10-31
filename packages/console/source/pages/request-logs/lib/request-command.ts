/**
 * 「把一次采集到的请求还原成可执行代码」的公共底座。
 *
 * cURL 与 fetch 两种目标语言只是外壳不同：输入（地址、方法、头、正文）与
 * 「哪些头不该带」是同一套事实。把这两件事抽在这里，两种输出就不会各错各的。
 */

/**
 * 由客户端/运行时自己计算、写进去只会与正文打架的头。
 *
 * 对 cURL 来说它们是"会被覆盖"；对浏览器的 `fetch` 来说它们属于 forbidden header，
 * 写了也会被静默丢弃，留在代码里只会让人以为请求带了它。
 */
const DROPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'expect',
])

/** 拼一份请求命令需要的输入。 */
export interface RequestCommandInput {
  /** 完整请求地址（含 scheme 与端口），由调用方拼好。 */
  url: string
  method: string
  /** 采集到的请求头 JSON 字符串；`null` 表示没有采集到头。 */
  headers: string | null
  /** 采集到的请求体原文；`null` 或空串表示没有正文。 */
  body: string | null
}

export type HeaderPairs = Array<[string, string[]]>

/** 头是脱敏后的 JSON 对象；解析失败按「没有头」处理，不猜。 */
export function parseHeaders(raw: string | null): HeaderPairs {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.entries(parsed as Record<string, unknown>).flatMap(([name, value]) => {
    if (DROPPED_HEADERS.has(name.toLowerCase())) return []
    if (typeof value === 'string') return [[name, [value]] as [string, string[]]]
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string')
      return items.length > 0 ? [[name, items] as [string, string[]]] : []
    }
    return []
  })
}

/** 方法归一：空值按 POST 处理（采集不到方法时几乎都是提交类请求）。 */
export function normalizeMethod(method: string): string {
  return method.toUpperCase() || 'POST'
}
