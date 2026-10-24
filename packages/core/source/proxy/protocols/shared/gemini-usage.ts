import type { RawUsage } from '@common/schemas'
import type { UsageAdapter } from './usage'

export const geminiUsageAdapter: UsageAdapter = {
  id: 'gemini',
  matches: raw => raw.promptTokenCount !== undefined
    || raw.candidatesTokenCount !== undefined
    || raw.cachedContentTokenCount !== undefined,
  read: (raw: RawUsage) => ({
    input: [raw.promptTokenCount],
    output: [raw.candidatesTokenCount],
    cachedInput: [raw.cachedContentTokenCount],
    cacheCreation: [],
    reasoning: [],
  }),
}
