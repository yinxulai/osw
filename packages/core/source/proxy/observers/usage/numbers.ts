import type { RawUsage } from '@common/schemas'

export function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawUsage : null
}

export function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

/**
 * 取第一个可用的数值：优先正数，全为 0 时回落到 0。
 *
 * 有些聚合网关会在同一个 `usage` 报文里同时给两套字段，并且把其中一套写成占位 0：
 * Chat 风格的 `prompt_tokens` / `completion_tokens` 是 0，真实值在 Responses 风格的
 * `input_tokens` / `output_tokens`（以及 `input_tokens_details.cached_tokens`）里。
 * 按字段顺序取「第一个数字」会先撞上占位 0，于是输入、输出、缓存全被记成 0，
 * TPS 与缓存命中率因为分子为 0 直接算不出来。
 *
 * 判据只能是「0 是不是占位」——上游真报 0 时所有候选都是 0，此时回落值仍是 0，
 * 不会把「真实的 0」变成「没上报」。反过来只要有一个正数候选，它一定比占位 0 可信：
 * 没有哪家上游会用正数表达「没有用量」。
 */
export function firstNumber(...values: unknown[]): number | null {
  let fallback: number | null = null
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > 0) return value
    if (fallback === null) fallback = value
  }
  return fallback
}

export function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

/**
 * 合并两次读数。
 *
 * 「后到的覆盖先到的」是常态：上游常在收尾事件里才报完整用量，先到的读数往往只有半份。
 * 但 0 既可能是真实的 0 也可能是占位，而正数一定不是「没有用量」，所以一个 0 读数不许
 * 盖掉已经读到的正数——否则逐事件在两套字段间切换的网关会先报出真实值，再被后一个只带
 * 占位 0 的事件抹掉。这与 {@link firstNumber} 先撞上占位 0 是同一个错误，
 * 只是发生在事件之间而不是字段之间。
 */
export function mergeNumber(current: number | null, incoming: number | null): number | null {
  if (incoming === null) return current
  if (incoming === 0 && current !== null && current > 0) return current
  return incoming
}

export function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }
  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue ? mergeRawUsage(currentValue, incomingValue) : value
  }
  return merged
}
