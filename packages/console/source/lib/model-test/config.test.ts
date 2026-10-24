import { describe, expect, it } from 'vitest'
import { clampConfigNumber } from './config'

/**
 * 输入框能塞进来的东西：空（`valueAsNumber` 是 NaN）、负数、小数、超大值。
 * 合法化只有两条——不小于下界、取整；上界故意不给。
 */
describe('clampConfigNumber', () => {
  it('空输入与非法数字落回下界', () => {
    expect(clampConfigNumber(Number.NaN, 1)).toBe(1)
    expect(clampConfigNumber(Number.POSITIVE_INFINITY, 3)).toBe(3)
  })

  it('低于下界时抬到下界，下界是 0 时负数归 0', () => {
    expect(clampConfigNumber(-5, 1)).toBe(1)
    expect(clampConfigNumber(-5, 0)).toBe(0)
  })

  it('小数截断而不是四舍五入', () => {
    expect(clampConfigNumber(3.9, 1)).toBe(3)
    expect(clampConfigNumber(2.5, 1)).toBe(2)
  })

  it('没有上界：写多大就是多大', () => {
    expect(clampConfigNumber(2_000_000, 1)).toBe(2_000_000)
  })
})
