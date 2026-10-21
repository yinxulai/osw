import type { RawUsage } from '@common/schemas'
import { anthropicAdapter } from './adapters/anthropic'
import { geminiAdapter } from './adapters/gemini'
import { openaiChatAdapter } from './adapters/openai-chat'
import { openaiResponsesAdapter } from './adapters/openai-responses'
import { asRecord, collectUsage, firstNumber, mergeRawUsage } from './numbers'
import type { ExtractedUsage, UsageAdapter, UsageReading } from './types'

/**
 * 适配器的**顺序就是字段的优先级**：注册表把各家的候选值按这个顺序首尾相接，
 * 再由 {@link firstNumber} 取第一个正数。顺序按下述理由固定，不要随手调整：
 *
 * 1. `openai-chat` 在前：`prompt_tokens` / `completion_tokens` 是最常见的一对；
 * 2. `openai-responses` 其次：`input_tokens` / `output_tokens` 与 Anthropic 同名同义，
 *    但总量别名（`total_*`）必须排在裸字段之后；
 * 3. `anthropic` 再次：语义上它排在 OpenAI 之后，混合网关才不会被它先抢走读数；
 * 4. `gemini` 最后：字段名自成一套，不与前几家重叠，位置只影响扫描成本。
 */
export const USAGE_ADAPTERS: readonly UsageAdapter[] = [
  openaiChatAdapter,
  openaiResponsesAdapter,
  anthropicAdapter,
  geminiAdapter,
]

/**
 * 不属于任何一家的聚合别名。
 *
 * `total_cached_tokens` 是网关自己算的缓存总量，既不是 OpenAI 的 details 也不是 Anthropic 的
 * 计费字段。它排在所有适配器之后：有明细时明细更可信，没有明细才用这个汇总值。
 */
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

  // 每个适配器都读，不做「先识别再读」的短路：`read` 是全函数（字段不在就返回空），
  // 这样候选集合与顺序只由声明决定，不会因为某个 matches 写得不准而少一列。
  const readings = USAGE_ADAPTERS.map(adapter => adapter.read(raw))
  const pick = (key: keyof UsageReading): unknown[] => readings.flatMap(reading => [...reading[key]])

  const cachedInputTokens = firstNumber(
    ...pick('cachedInput'),
    ...AGGREGATE_CACHE_ALIASES.map(key => raw[key]),
  )
  const cacheCreationInputTokens = firstNumber(...pick('cacheCreation'))
  // 报文顶层的裸字段是最后才回落的来源：容器里的值一定更具体。
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

/**
 * 混合网关的**显式规则**（依次判定，先命中者胜出）：
 *
 * 1. 有哪家声明了「输入是含缓存的总量」，并且**这一份报文里**该字段确实报了正数
 *    → 就按总量算，缓存字段只当别名。这是 Chat 的 `prompt_tokens`。
 * 2. 否则若有哪家声明「输入不含缓存」并且出现了它的特征字段 → 把缓存加回总量。
 *    这是 Anthropic 的 `cache_read_input_tokens` / `cache_creation_input_tokens` / `cache_creation`。
 * 3. 都不成立 → 上游报什么就是什么。
 *
 * 这不是一个 `isMixedGateway` 开关：判据是「报文里出现了谁的语义」，而不是「这个网关叫什么」。
 * 同一个网关可以逐事件在两套字段间切换，规则也就能逐个事件得出不同但正确的答案。
 */
function resolveInputTokens(raw: RawUsage, reported: number | null, cached: number | null, cacheCreation: number | null): number | null {
  if (reported === null) return null
  const declaresTotal = USAGE_ADAPTERS.some(adapter => adapter.inputTotal?.(raw) === true)
  if (declaresTotal) return reported
  const excludesCache = USAGE_ADAPTERS.some(adapter => adapter.inputExcludesCache === true && adapter.matches(raw))
  return excludesCache ? reported + (cached ?? 0) + (cacheCreation ?? 0) : reported
}
