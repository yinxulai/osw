import type { PromptInvocation } from '@common/router/types'

function blockText(block: unknown): string {
  if (Array.isArray(block)) return block.map(blockText).filter(Boolean).join('')
  if (block && typeof block === 'object') return String((block as Record<string, unknown>).text ?? '')
  if (block === undefined || block === null) return ''
  return String(block)
}

export function buildPromptBody(invocation: PromptInvocation): string {
  const messages = invocation.prompt ? [{ role: 'user', content: invocation.prompt }] : []
  const system = invocation.systemPrompt.trim()
  return JSON.stringify({
    model: invocation.logicalModelId,
    system: system || undefined,
    messages,
    temperature: invocation.temperature,
    max_tokens: invocation.maxTokens,
  })
}

export function extractReplyText(payload: Record<string, unknown>): string {
  const blocks = Array.isArray(payload.content) ? payload.content : []
  return blocks.map(blockText).filter(Boolean).join('')
}
