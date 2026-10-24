import { afterEach, describe, expect, it } from 'vitest'
import { shiftLocalCalendarDays } from './calendar-day'

const HOUR_MS = 60 * 60 * 1000

describe('shiftLocalCalendarDays', () => {
  const previousTz = process.env.TZ

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })

  it('回拨日的次日零点比当天零点晚 25 小时', () => {
    process.env.TZ = 'America/New_York'
    const start = new Date(2026, 10, 1).getTime()
    const end = shiftLocalCalendarDays(start, 1)
    expect(end).toBe(new Date(2026, 10, 2).getTime())
    expect(end - start).toBe(25 * HOUR_MS)
  })

  it('春令时日的次日零点比当天零点晚 23 小时', () => {
    process.env.TZ = 'America/New_York'
    const start = new Date(2026, 2, 8).getTime()
    const end = shiftLocalCalendarDays(start, 1)
    expect(end).toBe(new Date(2026, 2, 9).getTime())
    expect(end - start).toBe(23 * HOUR_MS)
  })

  it('跨春令时往前 6 个日历日停在第 7 天的零点', () => {
    process.env.TZ = 'America/New_York'
    const end = new Date(2026, 2, 14).getTime()
    expect(shiftLocalCalendarDays(end, -6)).toBe(new Date(2026, 2, 8).getTime())
  })

  it('非切换日仍相差 24 小时', () => {
    process.env.TZ = 'America/New_York'
    const start = new Date(2026, 0, 15).getTime()
    expect(shiftLocalCalendarDays(start, 1) - start).toBe(24 * HOUR_MS)
  })

  it('先前进一天再退回一天，回到原来的本地零点', () => {
    process.env.TZ = 'America/New_York'
    const midnights = [new Date(2026, 10, 1), new Date(2026, 2, 8), new Date(2026, 0, 15)]
    for (const midnight of midnights) {
      const start = midnight.getTime()
      expect(shiftLocalCalendarDays(shiftLocalCalendarDays(start, 1), -1)).toBe(start)
    }
  })
})
