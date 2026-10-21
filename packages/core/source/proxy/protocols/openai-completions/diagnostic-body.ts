import type { ModelTestMode } from '@common/schemas'
import { padPrompt } from '../shared/diagnostic-body'

export interface DiagnosticBodyOptions {
  prompt?: string
  inputLength?: number
  stream?: boolean
}

export function buildDiagnosticBody(modelId: string, options: DiagnosticBodyOptions = {}, mode: ModelTestMode = 'streaming'): string {
  const basePrompt = options.prompt?.trim() || (mode === 'speed' ? 'Count from 1 to 200, separated by single spaces. Output only the numbers.' : 'Hi')
  const prompt = padPrompt(basePrompt, options.inputLength ?? 0)
  const stream = options.stream ?? true
  return JSON.stringify({
    model: modelId,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [{ role: 'user', content: prompt }],
  })
}
