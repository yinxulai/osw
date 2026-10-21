import type { RawUsage } from '@common/schemas'
import type { UsageAdapter } from '../types'

/**
 * Gemini `usageMetadata`。
 *
 * 字段名是驼峰且自成一套（`promptTokenCount` / `candidatesTokenCount` / `cachedContentTokenCount`），
 * 与 OpenAI 家族没有重名，所以它既不参与输入语义的判断，也不会和别的适配器抢字段。
 * 缓存单独一列（`cachedContentTokenCount`），与 `promptTokenCount` 是否含它无关——这里只负责读数。
 */
export const geminiAdapter: UsageAdapter = {
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
