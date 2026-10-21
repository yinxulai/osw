import type { RawUsage } from '@common/schemas'
import { asRecord } from '../numbers'
import type { UsageAdapter } from '../types'

/**
 * Chat Completions。
 *
 * 它的 `prompt_tokens` 是**含缓存的总输入**。这一条同时决定了混合网关的算法（见 `../registry.ts`）：
 * 只要这个字段报了正数，报文里出现的 Anthropic 缓存字段就只是同一批缓存的别名，不得再加一次。
 * 反过来说，`prompt_tokens` 缺省或为占位 0 时，它就不能替别人的语义作证——所以这里给的是
 * 针对**这一份报文**的谓词，不是「我是 OpenAI 所以输入含缓存」的常量。
 */
export const openaiChatAdapter: UsageAdapter = {
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
