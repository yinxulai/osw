import type { ModelTestMode } from '@common/schemas'
import { DEFAULT_MAX_TOKENS, padPrompt, resolveDiagnosticPrompt, SPEED_MAX_TOKENS } from '../shared/diagnostic-body'

export interface DiagnosticBodyOptions {
  prompt?: string
  inputLength?: number
  stream?: boolean
}

export function buildDiagnosticBody(modelId: string, converted: boolean, mode: ModelTestMode = 'streaming', options: DiagnosticBodyOptions = {}): string {
  const prompt = padPrompt(resolveDiagnosticPrompt(mode, options.prompt), options.inputLength ?? 0)
  const stream = options.stream ?? true
  return JSON.stringify({
    model: modelId,
    ...(converted ? {} : { max_tokens: mode === 'speed' ? SPEED_MAX_TOKENS : DEFAULT_MAX_TOKENS }),
    ...(stream ? { stream: true } : {}),
    messages: [{ role: 'user', content: prompt }],
  })
}
