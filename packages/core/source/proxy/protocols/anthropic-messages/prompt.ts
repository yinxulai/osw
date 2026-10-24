import type { PromptInvocation } from '@common/router/types'
import { blockText } from '../shared/prompt-body'

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
