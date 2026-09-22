/**
 * 把一次采集到的请求拼成可直接执行的 cURL 命令。
 *
 * 正文内容与长度都不受控（可能是任意 UTF-8 文本、多行、含引号或 `$`），
 * 因此这里**不做任何有损的再编码**（不转义成 JSON、不截断、不替换换行），
 * 只用 POSIX 单引号包裹 + 把内部的 `'` 换成 `'\''`。
 *
 * 单引号串里没有任何字符需要解释（`$`、反引号、`\`、换行都保持字面量），
 * 这是唯一一种「无论正文长什么样都能原样还原」的 shell 引用方式，
 * 也是浏览器 DevTools「Copy as cURL」采用的方案。
 */

/** 由 curl 自己计算、写进命令里只会与 `--data-raw` 打架的头。 */
const DROPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'expect',
])

/** 拼一份 cURL 命令需要的输入。 */
interface CurlRequestInput {
  /** 完整请求地址（含 scheme 与端口），由调用方拼好。 */
  url: string
  method: string
  /** 采集到的请求头 JSON 字符串；`null` 表示没有采集到头。 */
  headers: string | null
  /** 采集到的请求体原文；`null` 或空串表示没有正文。 */
  body: string | null
}

/** POSIX 单引号引用：唯一的转义点就是单引号本身。 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 头是脱敏后的 JSON 对象；解析失败按「没有头」处理，不猜。 */
function parseHeaders(raw: string | null): Array<[string, string[]]> {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.entries(parsed as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value === 'string') return [[name, [value]] as [string, string[]]]
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string')
      return items.length > 0 ? [[name, items] as [string, string[]]] : []
    }
    return []
  })
}

export function buildCurl(input: CurlRequestInput): string {
  // 每个参数单独一行：正文可能很长，全挤在一行会让人没法核对。
  const parts = [`curl -X ${input.method.toUpperCase() || 'POST'}`, shellQuote(input.url)]
  for (const [name, values] of parseHeaders(input.headers)) {
    if (DROPPED_HEADERS.has(name.toLowerCase())) continue
    for (const value of values) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`)
  }
  if (input.body) parts.push(`--data-raw ${shellQuote(input.body)}`)
  return parts.join(' \\\n  ')
}
