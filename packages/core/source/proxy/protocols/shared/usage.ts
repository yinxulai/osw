import type { RawUsage } from '@common/schemas'
import { anthropicMessagesUsageAdapter } from '../anthropic-messages/usage'
import { openAiCompletionsUsageAdapter } from '../openai-completions/usage'
import { openAiResponsesUsageAdapter } from '../openai-responses/usage'
import { geminiUsageAdapter } from './gemini-usage'

/** 从上游报文里读到的用量。字段为 `null` 表示上游没报；不是 0。 */
export interface ExtractedUsage {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

export function emptyUsage(): ExtractedUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
  }
}

export interface UsageReading {
  input: readonly unknown[]
  output: readonly unknown[]
  cachedInput: readonly unknown[]
  cacheCreation: readonly unknown[]
  reasoning: readonly unknown[]
}

/**
 * 协议级字段清单的抽象：
 * - `matches` 负责判这一份报文是否像这家协议；
 * - `read` 负责把该协议的字段从 `raw` 中拆成抽象组；
 * - `inputTotal` / `inputExcludesCache` 只描述这一份报文的输入语义。
 */
export interface UsageAdapter {
  readonly id: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini'
  matches(raw: RawUsage): boolean
  read(raw: RawUsage): UsageReading
  inputTotal?(raw: RawUsage): boolean
  readonly inputExcludesCache?: boolean
}

export function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawUsage : null
}

export function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

/** 取第一个可用的数值：优先正数，全为 0 时回落到 0。 */
export function firstNumber(...values: unknown[]): number | null {
  let fallback: number | null = null
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > 0) return value
    if (fallback === null) fallback = value
  }
  return fallback
}

export function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

export function mergeNumber(current: number | null, incoming: number | null): number | null {
  if (incoming === null) return current
  if (incoming === 0 && current !== null && current > 0) return current
  return incoming
}

export function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }
  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue ? mergeRawUsage(currentValue, incomingValue) : value
  }
  return merged
}

export const USAGE_ADAPTERS: readonly UsageAdapter[] = [
  openAiCompletionsUsageAdapter,
  openAiResponsesUsageAdapter,
  anthropicMessagesUsageAdapter,
  geminiUsageAdapter,
]

const AGGREGATE_CACHE_ALIASES = ['total_cached_tokens'] as const

export function extractTokenUsage(data: Record<string, unknown>): ExtractedUsage {
  const candidates: RawUsage[] = []
  collectUsage(data.usage, candidates)
  collectUsage(data.usageMetadata, candidates)
  collectUsage(data.usage_metadata, candidates)
  collectUsage(asRecord(data.message)?.usage, candidates)
  collectUsage(asRecord(data.response)?.usage, candidates)
  if (Array.isArray(data.output)) {
    for (const item of data.output) collectUsage(asRecord(item)?.usage, candidates)
  }

  let rawUsage: RawUsage | null = null
  for (const candidate of candidates) rawUsage = mergeRawUsage(rawUsage, candidate)
  const raw = rawUsage ?? {}

  const readings = USAGE_ADAPTERS.map(adapter => adapter.read(raw))
  const pick = (key: keyof UsageReading): unknown[] => readings.flatMap(reading => [...reading[key]])

  const cachedInputTokens = firstNumber(
    ...pick('cachedInput'),
    ...AGGREGATE_CACHE_ALIASES.map(key => raw[key]),
  )
  const cacheCreationInputTokens = firstNumber(...pick('cacheCreation'))
  const reportedInputTokens = firstNumber(...pick('input'), data.input_tokens, data.prompt_tokens)
  const outputTokens = firstNumber(...pick('output'), data.output_tokens, data.completion_tokens)

  return {
    inputTokens: resolveInputTokens(raw, reportedInputTokens, cachedInputTokens, cacheCreationInputTokens),
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningTokens: firstNumber(...pick('reasoning')),
    rawUsage,
  }
}

function resolveInputTokens(raw: RawUsage, reported: number | null, cached: number | null, cacheCreation: number | null): number | null {
  if (reported === null) return null
  const declaresTotal = USAGE_ADAPTERS.some(adapter => adapter.inputTotal?.(raw) === true)
  if (declaresTotal) return reported
  const excludesCache = USAGE_ADAPTERS.some(adapter => adapter.inputExcludesCache === true && adapter.matches(raw))
  return excludesCache ? reported + (cached ?? 0) + (cacheCreation ?? 0) : reported
}

export interface UsageTracker {
  usage(): ExtractedUsage
  consumeJson(body: string): boolean
  consumeSseChunk(text: string): boolean
  flush(): boolean
  estimatedOutputTokens(): number
}

export function createUsageTracker(): UsageTracker {
  let usage = emptyUsage()
  let estimatedOutputTokens = 0
  let pending = ''
  return {
    usage: () => usage,
    estimatedOutputTokens: () => estimatedOutputTokens,
    consumeJson(body: string): boolean {
      return accumulateJson(body, current => { usage = current })
    },
    consumeSseChunk(text: string): boolean {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      let hasOutputLine = false
      for (const line of lines) {
        if (accumulateSseLine(line, current => { usage = current })) hasOutputLine = true
      }
      return hasOutputLine
    },
    flush(): boolean {
      const line = pending
      pending = ''
      return accumulateSseLine(line, current => { usage = current })
    },
  }

  function accumulateSseLine(line: string, apply: (usage: ExtractedUsage) => void): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return false
    return accumulateJson(data, apply)
  }

  function accumulateJson(body: string, apply: (usage: ExtractedUsage) => void): boolean {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      return false
    }
    apply(mergeUsage(usage, extractTokenUsage(data)))
    const outputText = extractOutputText(data)
    if (outputText.length > 0) estimatedOutputTokens += estimateOutputTokenWeight(outputText)
    return hasOutput(data)
  }
}

function mergeUsage(current: ExtractedUsage, incoming: ExtractedUsage): ExtractedUsage {
  return {
    inputTokens: mergeNumber(current.inputTokens, incoming.inputTokens),
    outputTokens: mergeNumber(current.outputTokens, incoming.outputTokens),
    cachedInputTokens: mergeNumber(current.cachedInputTokens, incoming.cachedInputTokens),
    cacheCreationInputTokens: mergeNumber(current.cacheCreationInputTokens, incoming.cacheCreationInputTokens),
    reasoningTokens: mergeNumber(current.reasoningTokens, incoming.reasoningTokens),
    rawUsage: mergeRawUsage(current.rawUsage, incoming.rawUsage),
  }
}

export function hasOutput(data: Record<string, unknown>): boolean {
  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    if (hasValue(delta?.content) || hasValue(delta?.tool_calls) || hasValue(delta?.function_call) || hasValue(delta?.refusal)
      || hasValue(delta?.reasoning_content) || hasValue(delta?.reasoning)
      || hasValue(record?.text) || hasValue(message?.content)
      || hasValue(message?.reasoning_content) || hasValue(message?.reasoning)) return true
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    if (!delta) return false
    return (delta.type === 'text_delta' && hasValue(delta.text)) || (delta.type === 'thinking_delta' && hasValue(delta.thinking))
  }
  if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
    return hasValue(data.delta)
  }
  if (type === 'response.function_call_arguments.delta' || type === 'response.custom_tool_call_input.delta') {
    return hasValue(data.delta)
  }
  return false
}

export function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  return value !== null && value !== undefined
}

export function extractOutputText(data: Record<string, unknown>): string {
  let text = ''
  const append = (value: unknown): void => {
    if (typeof value === 'string') text += value
    else if (value !== null && value !== undefined && typeof value !== 'object') text += String(value)
  }

  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    append(delta?.content)
    append(delta?.reasoning_content)
    append(delta?.reasoning)
    append(record?.text)
    append(message?.content)
    append(message?.reasoning_content)
    append(message?.reasoning)
    if (hasValue(delta?.tool_calls)) append(stringifyForEstimate(delta?.tool_calls))
    if (hasValue(delta?.function_call)) append(stringifyForEstimate(delta?.function_call))
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    if (delta?.type === 'text_delta') append(delta.text)
    else if (delta?.type === 'thinking_delta') append(delta.thinking)
    else if (delta?.type === 'input_json_delta') append(delta.partial_json)
  } else if (type === 'response.output_text.delta'
    || type === 'response.reasoning_summary_text.delta'
    || type === 'response.reasoning_text.delta'
    || type === 'response.function_call_arguments.delta'
    || type === 'response.custom_tool_call_input.delta') {
    append(data.delta)
  }
  return text
}

function stringifyForEstimate(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

export function estimateOutputTokenWeight(text: string): number {
  let weight = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code === undefined) continue
    weight += isDenseScript(code) ? 1 : 0.25
  }
  return weight
}

function isDenseScript(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303f)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xffef)
}
