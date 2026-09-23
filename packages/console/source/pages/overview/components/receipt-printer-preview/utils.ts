import { receiptOffsetMin, receiptPixelsPerMeter, receiptPullMax } from './constants'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 偏移量：负 = 把纸条卷回机器（到 `receiptOffsetMin` 为止），
 * 正 = 继续往下拉，纸条顶端续出空白（到 `receiptPullMax` 为止）。
 */
export function clampReceiptOffset(offset: number) {
  return clamp(offset, receiptOffsetMin, receiptPullMax)
}

/**
 * 小票的平移量。只有「往机器里塞」才需要平移纸条本身；
 * 往下拉（正值）不但不平移，还要把纸条顶端的空白续长（见 `root.tsx`），
 * 否则纸条会和出纸口脱开一道缝。
 */
export function clampReceiptTranslate(offset: number) {
  return clamp(offset, receiptOffsetMin, 0)
}

/** 已经拉出来的纸条长度（米），直接给「拉了多少」的进度文案用。 */
export function receiptMeters(offset: number) {
  return Math.max(0, offset) / receiptPixelsPerMeter
}
