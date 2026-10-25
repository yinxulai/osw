import { describe, expect, it } from 'vitest'
import { formatLocalDate, formatLocalDateDisplay, parseLocalDate } from '@/lib/local-date'

/*
 * 本地日期串的换算。
 *
 * 守的是时区：`toISOString()` 那条路在东八区会把 8 月 1 日零点的值变成 7 月 31 日，
 * 在夏令时地区又会在切换日错一天。这里是日期选择器的取值口径，错一天就是「到期日差一天」。
 */

describe('本地日期串', () => {
  it('年月日补零成 `YYYY-MM-DD`', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('解析回当天本地零点', () => {
    const date = parseLocalDate('2026-01-31')
    expect(date).toBeDefined()
    expect(date!.getFullYear()).toBe(2026)
    expect(date!.getMonth()).toBe(0)
    expect(date!.getDate()).toBe(31)
    expect(date!.getHours()).toBe(0)
  })

  it('往返不丢日子', () => {
    for (const value of ['2026-01-31', '2026-06-15', '2026-12-31']) {
      expect(formatLocalDate(parseLocalDate(value)!)).toBe(value)
    }
  })

  it('东侧时区下不会被 `toISOString` 拉到前一天', () => {
    // CI 可能跑在任何时区，所以先看这台机器的偏移：只有东侧（`getTimezoneOffset()` 为负）
    // 才会出现「本地零点已经是前一个 UTC 日」的情况，否则这条用例无从复现。
    const offsetMinutes = new Date(2026, 7, 1).getTimezoneOffset()
    if (offsetMinutes < 0) {
      expect(new Date(2026, 7, 1).toISOString().slice(0, 10)).toBe('2026-07-31')
    }
    // 无论时区如何，本地年月日写出来永远是用户选的那一天。
    expect(formatLocalDate(new Date(2026, 7, 1))).toBe('2026-08-01')
  })

  it('非法值与不存在的日期都不解析', () => {
    expect(parseLocalDate('')).toBeUndefined()
    expect(parseLocalDate('2026-1-5')).toBeUndefined()
    expect(parseLocalDate('2026/01/05')).toBeUndefined()
    // 2 月 31 日会被 `new Date` 滚到 3 月 3 日，滚过去的日子不是用户填的日子。
    expect(parseLocalDate('2026-02-31')).toBeUndefined()
  })

  it('展示文案随语言走，空值返回 null', () => {
    expect(formatLocalDateDisplay('', 'zh-CN')).toBeNull()
    expect(formatLocalDateDisplay('2026-01-31', 'zh-CN')).toContain('2026')
    expect(formatLocalDateDisplay('2026-01-31', 'en')).not.toBeNull()
  })
})
