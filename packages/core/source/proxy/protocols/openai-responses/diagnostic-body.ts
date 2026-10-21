import { padPrompt } from '../shared/diagnostic-body'

export interface DiagnosticBodyOptions {
  prompt?: string
  inputLength?: number
  stream?: boolean
}

export function buildDiagnosticBody(modelId: string, options: DiagnosticBodyOptions = {}): string {
  const basePrompt = options.prompt?.trim() || 'Hi'
  const prompt = padPrompt(basePrompt, options.inputLength ?? 0)
  const stream = options.stream ?? true
  return JSON.stringify({
    model: modelId,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    input: [{ role: 'user', content: prompt }],
  })
}
