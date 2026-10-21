import type { RawUsage } from '@common/schemas'
import { asRecord, sumNumbers } from '../numbers'
import type { UsageAdapter } from '../types'

/**
 * Anthropic Messages。
 *
 * 这家是唯一把「缓存**不**含在输入里」写在明面上的：`input_tokens` 只是未命中缓存的那部分，
 * 真正喂给模型的量要把 `cache_read_input_tokens`（读命中）与 `cache_creation_input_tokens`
 * （写缓存）加回去。所以它声明 `inputExcludesCache`，由注册表决定是否加回。
 *
 * `cache_creation` 是个嵌套记录，按 TTL 分档（5 分钟 / 1 小时）。两档相加才是这一轮的写入量；
 * 只给了半档时就只算那一档——不能按「缺一档就是 0」补齐，那会把 1 小时缓存报成半量。
 *
 * 另外三个写入别名（`cache_creation_tokens` / `cached_creation_input_tokens` / `cache_write_tokens`）
 * 只用于读数，**不是**输入语义的触发字段：只有上面那三个「明面上的」字段才代表这套语义。
 */
export const anthropicAdapter: UsageAdapter = {
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
