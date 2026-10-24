import { describe, expect, it } from 'vitest'
import { formatBytes } from './format-bytes'

describe('formatBytes', () => {
  it('零字节就说零，不写成 0.0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('按 1024 进制换档', () => {
    expect(formatBytes(1)).toBe('1.0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  it('保留一位小数：这个数字是给人看趋势的，不是给人做算术的', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 ** 2 * 2.25)).toBe('2.3 MB')
  })

  it('不到下一档时留在原档，不会提前进位', () => {
    expect(formatBytes(1023)).toBe('1023.0 B')
    expect(formatBytes(1024 ** 2 - 1)).toBe('1024.0 KB')
  })

  it('指数有上限：涨到 TB 级也只会显示大 GB 数，不会吐出 undefined', () => {
    expect(formatBytes(1024 ** 4)).toBe('1024.0 GB')
    expect(formatBytes(1024 ** 5)).toBe('1048576.0 GB')
  })
})
