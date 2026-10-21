import type { RawUsage } from '@common/schemas'
import { asRecord, sumNumbers } from '../shared/usage'
import type { UsageAdapter } from '../shared/usage'

export const anthropicMessagesUsageAdapter: UsageAdapter = {
  id: 'anthropic',
  matches: raw => raw.cache_read_input_tokens !== undefined
    || raw.cache_creation_input_tokens !== undefined
    || raw.cache_creation !== undefined,
  inputExcludesCache: true,
  read: (raw: RawUsage) => {
    const cacheCreation = asRecord(raw.cache_creation)
    return {
      input: [raw.input_tokens],
      output: [raw.output_tokens],
      cachedInput: [raw.cache_read_input_tokens, raw.cached_input_tokens, raw.cache_read_tokens],
      cacheCreation: [
        raw.cache_creation_input_tokens,
        raw.cache_creation_tokens,
        raw.cached_creation_input_tokens,
        raw.cache_write_tokens,
        sumNumbers(cacheCreation?.ephemeral_5m_input_tokens, cacheCreation?.ephemeral_1h_input_tokens) ?? undefined,
      ],
      reasoning: [],
    }
  },
}
