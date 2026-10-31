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

import type { RequestCommandInput } from './request-command'
import { normalizeMethod, parseHeaders } from './request-command'

/** POSIX 单引号引用：唯一的转义点就是单引号本身。 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildCurl(input: RequestCommandInput): string {
  // 每个参数单独一行：正文可能很长，全挤在一行会让人没法核对。
  const parts = [`curl -X ${normalizeMethod(input.method)}`, shellQuote(input.url)]
  for (const [name, values] of parseHeaders(input.headers)) {
    for (const value of values) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`)
  }
  if (input.body) parts.push(`--data-raw ${shellQuote(input.body)}`)
  return parts.join(' \\\n  ')
}
