import type { PromptInvocation } from '@common/router/types'
import { blockText } from '../shared/prompt-body'

export function buildPromptBody(invocation: PromptInvocation): string {
  const messages = invocation.prompt ? [{ role: 'user', content: invocation.prompt }] : []
  const system = invocation.systemPrompt.trim()
  return JSON.stringify({
    model: invocation.logicalModelId,
    instructions: system || undefined,
    input: messages,
    temperature: invocation.temperature,
    max_output_tokens: invocation.maxTokens,
  })
}

export function extractReplyText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  const texts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) texts.push(blockText(part))
  }
  return texts.filter(Boolean).join('')
}
