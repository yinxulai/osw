import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import {
  formatBillCount,
  formatBillRangeLabel,
  formatBillTokens,
  formatCount,
  formatIntervalDescription,
  formatPercent,
  formatTokens,
  getProviderColor,
  PROVIDER_COLORS,
} from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const t = createAppTranslator('zh-CN')

describe('formatIntervalDescription', () => {
  it('把服务端算出的桶宽翻成粒度文案', () => {
    expect(formatIntervalDescription(t, 5 * MINUTE)).toBe('每 5 分钟用量')
    expect(formatIntervalDescription(t, HOUR)).toBe('每小时用量')
    expect(formatIntervalDescription(t, 6 * HOUR)).toBe('每 6 小时用量')
    expect(formatIntervalDescription(t, DAY)).toBe('每日用量')
  })

  // 桶宽是随响应带回来的字段，界面比服务端新的那段时间里它是 undefined：
  // 以前会算出 `Math.round(undefined / 60000)` 并写出「每 NaN 分钟用量」。
  it('桶宽缺失时不写粒度，也不写出 NaN', () => {
    expect(formatIntervalDescription(t, Number.NaN)).toBeNull()
    expect(formatIntervalDescription(t, undefined as unknown as number)).toBeNull()
    expect(formatIntervalDescription(t, 0)).toBeNull()
  })
})

describe('formatTokens', () => {
  it('K / M 两档保留一位小数，整数 Token 不做任何包装', () => {
    expect(formatTokens(2_400_000)).toBe('2.4M')
    expect(formatTokens(2_400)).toBe('2.4K')
    expect(formatTokens(1_000_000)).toBe('1.0M') // 边界本身就要换档
    expect(formatTokens(1_000)).toBe('1.0K')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(0)).toBe('0')
  })
})

describe('formatBillTokens', () => {
  // 账单是给外人看的累计量，出现「1.4M」会显得像估算——任何一行都该是一串干净的整数。
  it('只取整，不出现小数', () => {
    expect(formatBillTokens(1_200_000)).toBe('1M')
    expect(formatBillTokens(1_600_000)).toBe('2M')
    expect(formatBillTokens(1_200)).toBe('1K')
    expect(formatBillTokens(1_600)).toBe('2K')
    expect(formatBillTokens(999.6)).toBe('1000')
    expect(formatBillTokens(1_000_000)).toBe('1M')
    expect(formatBillTokens(1_000)).toBe('1K')
  })
})

describe('formatPercent', () => {
  it('固定一位小数，调用方负责把 null 换成占位符', () => {
    expect(formatPercent(0.8265)).toBe('82.7%') // 82.65 → toFixed(1) → 82.7
    expect(formatPercent(0.5)).toBe('50.0%')
    expect(formatPercent(1)).toBe('100.0%')
    expect(formatPercent(0)).toBe('0.0%')
  })
})

describe('语言敏感的格式化', () => {
  // 千分位必须跟随界面语言：同一屏里用运行时默认语言会与界面文案对不上。
  it('千分位跟随传入的语言', () => {
    expect(formatCount('de-DE', 1_234_567)).toBe('1.234.567')
    expect(formatCount('en', 1_234_567)).toBe('1,234,567')
    expect(formatCount('zh-CN', 1_234_567)).toBe('1,234,567')
  })

  it('账单上的千分位与普通计数同口径', () => {
    expect(formatBillCount('de-DE', 1_234_567)).toBe('1.234.567')
    expect(formatBillCount('en', 1_234_567)).toBe('1,234,567')
  })
})

describe('formatBillRangeLabel', () => {
  const endAt = new Date(2026, 0, 15, 10, 30, 45) // 2026-01-15 10:30:45 本地时间

  // 区间口径与页面的 range 开关一致：today 从当天零点起，7d/30d 含当天往回数。
  it('today 从当天零点起算', () => {
    expect(formatBillRangeLabel('zh-CN', 'today', endAt)).toBe('2026/01/15 00:00:00 - 2026/01/15 10:30:45')
  })

  it('7d 含当天，往回数 6 天', () => {
    expect(formatBillRangeLabel('zh-CN', '7d', endAt)).toBe('2026/01/09 00:00:00 - 2026/01/15 10:30:45')
  })

  it('其余范围按 30 天处理，往回数 29 天', () => {
    expect(formatBillRangeLabel('zh-CN', '30d', endAt)).toBe('2025/12/17 00:00:00 - 2026/01/15 10:30:45')
  })

  it('不修改调用方传进来的时间对象', () => {
    const original = new Date(endAt)
    formatBillRangeLabel('zh-CN', '30d', endAt)
    expect(endAt.getTime()).toBe(original.getTime())
  })

  it('用 24 小时制，并且跟随传入的语言', () => {
    expect(formatBillRangeLabel('de-DE', 'today', endAt)).toBe('15.01.2026, 00:00:00 - 15.01.2026, 10:30:45')
  })
})

describe('getProviderColor', () => {
  it('按索引取色，超出后回绕', () => {
    expect(getProviderColor(0)).toBe(PROVIDER_COLORS[0])
    expect(getProviderColor(PROVIDER_COLORS.length - 1)).toBe(PROVIDER_COLORS[PROVIDER_COLORS.length - 1])
    // 供应商数量不设上限，颜色表必须回绕而不是给出 undefined。
    expect(getProviderColor(PROVIDER_COLORS.length)).toBe(PROVIDER_COLORS[0])
    expect(getProviderColor(PROVIDER_COLORS.length + 3)).toBe(PROVIDER_COLORS[3])
  })
})
