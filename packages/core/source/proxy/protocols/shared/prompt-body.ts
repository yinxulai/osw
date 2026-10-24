/**
 * 把响应体里的内容块摊平成纯文本。
 *
 * 各协议的「块」长得不一样（Anthropic 的 `content[]`、Chat 的 `message.content`、
 * Responses 的 `output[].content[]`），但「字符串 / 对象取 `text` / 数组递归拼接」
 * 这条摊平规则是同一件事，所以放在 shared，由各协议只负责指出该从哪个字段取块。
 */
export function blockText(block: unknown): string {
  if (Array.isArray(block)) return block.map(blockText).filter(Boolean).join('')
  if (block && typeof block === 'object') return String((block as Record<string, unknown>).text ?? '')
  if (block === undefined || block === null) return ''
  return String(block)
}
