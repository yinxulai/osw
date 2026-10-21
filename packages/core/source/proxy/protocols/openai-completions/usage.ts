import type { RawUsage } from '@common/schemas'
import { asRecord } from '../shared/usage'
import type { UsageAdapter } from '../shared/usage'

export const openAiCompletionsUsageAdapter: UsageAdapter = {
  id: 'openai-chat',
  matches: raw => raw.prompt_tokens !== undefined
    || raw.completion_tokens !== undefined
    || raw.prompt_tokens_details !== undefined
    || raw.completion_tokens_details !== undefined,
  inputTotal: raw => typeof raw.prompt_tokens === 'number' && raw.prompt_tokens > 0,
  read: (raw: RawUsage) => {
    const promptDetails = asRecord(raw.prompt_tokens_details)
    return {
      input: [raw.prompt_tokens],
      output: [raw.completion_tokens],
      cachedInput: [promptDetails?.cached_tokens],
      cacheCreation: [promptDetails?.cache_write_tokens],
      reasoning: [asRecord(raw.completion_tokens_details)?.reasoning_tokens],
    }
  },
}
