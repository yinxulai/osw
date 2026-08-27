import { describe, expect, it } from 'vitest'
import { formatTTFT, formatTPS } from './format'

describe('request log metrics formatting', () => {
  it('formats TTFT in seconds with two decimal places', () => {
    expect(formatTTFT(0)).toBe('0.00s')
    expect(formatTTFT(1250)).toBe('1.25s')
    expect(formatTTFT(null)).toBe('—')
  })

  it('calculates TPS from output tokens and total duration', () => {
    expect(formatTPS(120, 5_000)).toBe('24')
    expect(formatTPS(10, 3_000)).toBe('3.3')
    expect(formatTPS(null, 3_000)).toBe('—')
  })
})
