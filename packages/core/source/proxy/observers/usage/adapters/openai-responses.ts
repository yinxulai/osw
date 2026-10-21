import type { RawUsage } from '@common/schemas'
import { asRecord } from '../numbers'
import type { UsageAdapter } from '../types'

/**
 * Responses API。
 *
 * 这里的 `input_tokens` 与 Anthropic **同名**，因此它不能承担「输入是含缓存的总量」这个判断：
 * 拿它当判据，纯 Anthropic 报文就会被误判成含缓存，缓存那部分永远加不回来。判定只交给
 * Chat 的 `prompt_tokens`（见 `openai-chat.ts`），本适配器只负责读数。
 *
 * `total_input_tokens` / `total_output_tokens` / `reasoning_tokens` 是 OpenAI 家族的总量别名，
 * 按历史上的字段优先级排在 `input_tokens` / `output_tokens` 之后。
 */
export const openaiResponsesAdapter: UsageAdapter = {
  id: 'openai-responses',
  matches: raw => raw.input_tokens !== undefined
    || raw.output_tokens !== undefined
    || raw.input_tokens_details !== undefined
    || raw.output_tokens_details !== undefined
    || raw.total_input_tokens !== undefined
    || raw.total_output_tokens !== undefined
    || raw.reasoning_tokens !== undefined,
  read: (raw: RawUsage) => {
    const inputDetails = asRecord(raw.input_tokens_details)
    return {
      input: [raw.input_tokens, raw.total_input_tokens],
      output: [raw.output_tokens, raw.total_output_tokens],
      cachedInput: [inputDetails?.cached_tokens],
      cacheCreation: [inputDetails?.cache_write_tokens],
      reasoning: [asRecord(raw.output_tokens_details)?.reasoning_tokens, raw.reasoning_tokens],
    }
  },
}
