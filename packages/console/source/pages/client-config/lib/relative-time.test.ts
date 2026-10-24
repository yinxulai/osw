import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { formatVersionTime } from './relative-time'

const t = createAppTranslator('zh-CN')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = new Date('2026-01-02T12:00:00Z').getTime()

afterEach(() => {
  vi.useRealTimers()
})

function formatAt(ago: number): string {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  return formatVersionTime(t, NOW - ago)
}

describe('formatVersionTime', () => {
  it('一分钟以内说「刚刚」，而不是「0 分钟前」', () => {
    expect(formatAt(0)).toBe('刚刚')
    expect(formatAt(MINUTE - 1)).toBe('刚刚')
  })

  it('一小时以内按分钟计，向下取整', () => {
    expect(formatAt(MINUTE)).toBe('1 分钟前')
    expect(formatAt(59 * MINUTE)).toBe('59 分钟前')
  })

  it('一天以内按小时计', () => {
    expect(formatAt(HOUR)).toBe('1 小时前')
    expect(formatAt(23 * HOUR)).toBe('23 小时前')
  })

  // 只做到「天」为止：再往上精确到日期反而更难扫，而列表本身有顺序。
  it('一天以上按天计，且不再细分', () => {
    expect(formatAt(DAY)).toBe('1 天前')
    expect(formatAt(40 * DAY)).toBe('40 天前')
  })
})
