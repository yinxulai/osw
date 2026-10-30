import { describe, expect, it } from 'vitest'
import {
  clampReceiptOffset,
  clampReceiptTranslate,
  receiptMeters,
  receiptOffsetMin,
  receiptPixelsPerMeter,
  receiptPullMax,
} from './receipt-metrics'

describe('clampReceiptOffset', () => {
  it('keeps an in-range offset untouched', () => {
    expect(clampReceiptOffset(120)).toBe(120)
  })

  it('clamps a push past the machine to the lower bound', () => {
    expect(clampReceiptOffset(receiptOffsetMin - 500)).toBe(receiptOffsetMin)
  })

  it('clamps an endless pull to the defensive upper bound', () => {
    expect(clampReceiptOffset(receiptPullMax + 9000)).toBe(receiptPullMax)
  })
})

describe('clampReceiptTranslate', () => {
  it('never translates the paper while being pulled out (positive offset)', () => {
    expect(clampReceiptTranslate(240)).toBe(0)
  })

  it('translates the paper back into the machine for negative offsets', () => {
    expect(clampReceiptTranslate(-120)).toBe(-120)
    expect(clampReceiptTranslate(receiptOffsetMin - 100)).toBe(receiptOffsetMin)
  })
})

describe('receiptMeters', () => {
  it('reports zero while the paper is tucked in', () => {
    expect(receiptMeters(-80)).toBe(0)
  })

  it('converts a pulled offset into meters by the pixel scale', () => {
    expect(receiptMeters(receiptPixelsPerMeter * 3)).toBe(3)
  })
})
