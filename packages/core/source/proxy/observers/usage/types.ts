import type { RawUsage } from '@common/schemas'

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

/**
 * 用量累积器。
 *
 * 上游把用量藏在哪一层各家不同（`usage` / `usageMetadata` / `message.usage` …），
 * 也可能分散在多个 SSE 事件里（首个事件只报输入、末个事件才报输出），
 * 因此这里既能吃整段 JSON，也能逐块吃 SSE 并在返回后合并。
 *
 * 「有没有真实生成内容」由返回值告诉调用方：TTFT 只在真正收到输出时才成立，
 * 只有 role 的起始事件、只报用量的收尾事件都不算。
 */
export interface UsageTracker {
  usage(): ExtractedUsage
  /** 吃一段完整 JSON 报文；返回其中是否含有真实生成内容。 */
  consumeJson(body: string): boolean
  /** 吃一段 SSE 字节流；返回其中是否出现了真实生成内容。 */
  consumeSseChunk(text: string): boolean
  /** 收尾：把最后一段没有换行结尾的 SSE 行也吃掉。 */
  flush(): boolean
  /**
   * 按已读到的正文**估算**的输出 Token 数（详见 `stream-signals.ts` 的权重说明）。
   *
   * 上游几乎只在收尾那一帧才报真实用量，流式期间读数一直是「还没到账」。这一路估算就是给
   * 那段空窗兜底：让实时指标在正文已经流动时先有一个数，等真实用量到达再被覆盖。它**只供
   * 实时展示**，绝不参与落库——落库一律以上游报的 `usage` 为准。
   */
  estimatedOutputTokens(): number
}

/**
 * 一个适配器从同一份 rawUsage 里读到的候选值。
 *
 * 每个数组都**按优先级排列**：位置靠前的字段先被采用。注册表把各适配器的数组按适配器顺序
 * 首尾相接，于是「字段之间的优先级」= 适配器顺序 × 适配器内部的书写顺序。
 */
export interface UsageReading {
  input: readonly unknown[]
  output: readonly unknown[]
  cachedInput: readonly unknown[]
  cacheCreation: readonly unknown[]
  reasoning: readonly unknown[]
}

/**
 * 一家上游的用量读法。
 *
 * 只回答三件事：这份报文像不像我、我承认哪些字段、我的「输入」是不是含缓存的总量。
 * 读取本身是**全函数**（字段不在就返回空数组），所以注册表可以对每个适配器都调 `read`，
 * 从而保证候选集合与顺序不依赖识别结果。
 */
export interface UsageAdapter {
  readonly id: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini'
  /** 这份报文是否带着这套协议的用量特征（用于判定输入语义，见 `registry.ts`）。 */
  matches(raw: RawUsage): boolean
  /** 这套协议承认的字段，按优先级排列。 */
  read(raw: RawUsage): UsageReading
  /**
   * 这套协议是否用「输入总量（含缓存）」表达输入。
   *
   * 给出谓词而不是布尔常量，是因为要判的是**这一份报文**：同一个字段在占位 0 时不能作数。
   */
  inputTotal?(raw: RawUsage): boolean
  /** 这套协议用「输入不含缓存」语义：缓存要从总量里加回来。 */
  readonly inputExcludesCache?: boolean
}
