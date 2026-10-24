import type { ModelTestMode } from '@common/schemas'
import { padPrompt, resolveDiagnosticPrompt } from '../shared/diagnostic-body'

export interface DiagnosticBodyOptions {
  prompt?: string
  inputLength?: number
  stream?: boolean
}

export function buildDiagnosticBody(modelId: string, options: DiagnosticBodyOptions = {}, mode: ModelTestMode = 'streaming'): string {
  const prompt = padPrompt(resolveDiagnosticPrompt(mode, options.prompt), options.inputLength ?? 0)
  const stream = options.stream ?? true
  return JSON.stringify({
    model: modelId,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [{ role: 'user', content: prompt }],
  })
}
