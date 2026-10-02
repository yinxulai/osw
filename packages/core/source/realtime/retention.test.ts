import { describe, expect, it } from 'vitest'
import { pruneNewestFirst } from './retention'

/**
 * 保留口径是**共享**的：台账与推送通道读的是同一组数字，这里只验裁剪函数本身
 * ——「按新→旧排列」这个输入约定是否真的能在第一个过期项处停下、两个上限如何一起生效。
 */
describe('pruneNewestFirst', () => {
  /** 造一个按 `at` 倒序排列的记录数组（新→旧）。 */
  function recordsOf(ats: number[]): { at: number }[] {
    return ats.map(at => ({ at }))
  }

  it('按条数截断，保留最新的那一端', () => {
    const items = recordsOf([500, 400, 300, 200, 100])

    const result = pruneNewestFirst(items, { newestAt: item => item.at, max: 3, ttlMilliseconds: 10_000, now: 500 })

    expect(result).toBe(items)
    expect(result.map(item => item.at)).toEqual([500, 400, 300])
  })

  it('按时间砍掉尾巴：从第一个过期项起，后面的整段都不再保留', () => {
    const items = recordsOf([400, 300, 200, 100])

    const result = pruneNewestFirst(items, { newestAt: item => item.at, max: 50, ttlMilliseconds: 250, now: 500 })

    // deadline = 250：300 及之前保留，200 起过期。
    expect(result.map(item => item.at)).toEqual([400, 300])
  })

  it('没有过期也没有超量时原样返回', () => {
    const items = recordsOf([500, 400])

    const result = pruneNewestFirst(items, { newestAt: item => item.at, max: 50, ttlMilliseconds: 10_000, now: 500 })

    expect(result.map(item => item.at)).toEqual([500, 400])
  })

  it('空数组是平凡的：不越界、不报错', () => {
    const items: { at: number }[] = []

    const result = pruneNewestFirst(items, { newestAt: item => item.at, max: 50, ttlMilliseconds: 1_000, now: 500 })

    expect(result).toEqual([])
  })
})
