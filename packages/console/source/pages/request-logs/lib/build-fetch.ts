import type { HeaderPairs, RequestCommandInput } from './request-command'
import { normalizeMethod, parseHeaders } from './request-command'

/**
 * 把一次采集到的请求拼成可直接粘进 DevTools / Node 的 `fetch` 调用。
 *
 * 与 cURL 版的差别只在**字面量怎么写**：这里不经过 shell，所以正文与头的值
 * 一律写成 JavaScript 字符串字面量（`JSON.stringify` 产出的就是合法的 JS 字面量，
 * 换行会变成 `\n`，引号与反斜杠都会转义），而不是 POSIX 单引号。
 * 这样整段代码是单行可执行的，粘到任何 JS 环境都不用再改引号。
 *
 * 多值头在 `fetch` 里只能合成一个字符串（`Headers` 不接受同名多值），
 * 按 HTTP 惯例用 `, ` 连接；正文为空时不写 `body`。
 */

/** JS 字符串字面量：`JSON.stringify` 的结果双引号包裹、内部全部转义，可直接内联。 */
function jsString(value: string): string {
  return JSON.stringify(value)
}

/**
 * 头表 → `fetch` 的 `headers` 对象字面量。
 *
 * 两格缩进、每行一个头：真实请求动辄十几个头，挤成一行既看不出来改没改，
 * 也让 diff 变得没法读。
 */
function headersLiteral(pairs: HeaderPairs): string {
  const lines = pairs.map(([name, values]) => `    ${jsString(name)}: ${jsString(values.join(', '))},`)
  return `{\n${lines.join('\n')}\n  }`
}

export function buildFetch(input: RequestCommandInput): string {
  const pairs = parseHeaders(input.headers)
  const parts = [
    `await fetch(${jsString(input.url)}, {`,
    `  method: ${jsString(normalizeMethod(input.method))},`,
  ]
  if (pairs.length > 0) parts.push(`  headers: ${headersLiteral(pairs)},`)
  if (input.body) parts.push(`  body: ${jsString(input.body)},`)
  parts.push('})')
  return parts.join('\n')
}
