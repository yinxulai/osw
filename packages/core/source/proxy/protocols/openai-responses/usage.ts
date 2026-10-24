import type { RawUsage } from '@common/schemas'
import { asRecord } from '../shared/usage'
import type { UsageAdapter } from '../shared/usage'

export const openAiResponsesUsageAdapter: UsageAdapter = {
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
