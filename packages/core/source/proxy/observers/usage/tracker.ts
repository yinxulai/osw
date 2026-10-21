import { mergeNumber, mergeRawUsage } from './numbers'
import { extractTokenUsage } from './registry'
import { estimateOutputTokenWeight, extractOutputText, hasOutput } from './stream-signals'
import { emptyUsage, type ExtractedUsage, type UsageTracker } from './types'

/**
 * 合并两次读数（逐事件累积）。
 *
 * 跨事件的合并与跨字段的取值是同一个问题的两种形态：占位 0 不许盖掉已经读到的正数。
 * 区别只在「谁覆盖谁」——字段之间是「第一个正数胜出」，事件之间是「后来的胜出，除非它是 0」。
 */
function mergeUsage(current: ExtractedUsage, incoming: ExtractedUsage): ExtractedUsage {
  return {
    inputTokens: mergeNumber(current.inputTokens, incoming.inputTokens),
    outputTokens: mergeNumber(current.outputTokens, incoming.outputTokens),
    cachedInputTokens: mergeNumber(current.cachedInputTokens, incoming.cachedInputTokens),
    cacheCreationInputTokens: mergeNumber(current.cacheCreationInputTokens, incoming.cacheCreationInputTokens),
    reasoningTokens: mergeNumber(current.reasoningTokens, incoming.reasoningTokens),
    rawUsage: mergeRawUsage(current.rawUsage, incoming.rawUsage),
  }
}

export function createUsageTracker(): UsageTracker {
  let usage = emptyUsage()
  let estimatedOutputTokens = 0
  let pending = ''
  return {
    usage: () => usage,
    estimatedOutputTokens: () => estimatedOutputTokens,
    consumeJson(body: string): boolean {
      return accumulateJson(body, current => { usage = current })
    },
    consumeSseChunk(text: string): boolean {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      let hasOutputLine = false
      for (const line of lines) {
        if (accumulateSseLine(line, current => { usage = current })) hasOutputLine = true
      }
      return hasOutputLine
    },
    flush(): boolean {
      const line = pending
      pending = ''
      return accumulateSseLine(line, current => { usage = current })
    },
  }

  function accumulateSseLine(line: string, apply: (usage: ExtractedUsage) => void): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return false
    return accumulateJson(data, apply)
  }

  function accumulateJson(body: string, apply: (usage: ExtractedUsage) => void): boolean {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      // 用量是尽力而为的观察：上游事件格式不对也必须继续转发。
      return false
    }
    apply(mergeUsage(usage, extractTokenUsage(data)))
    const outputText = extractOutputText(data)
    if (outputText.length > 0) estimatedOutputTokens += estimateOutputTokenWeight(outputText)
    return hasOutput(data)
  }
}
