import { describe, expect, it } from 'vitest'
import type { LiveRequestEventLevel } from '@common/schemas'
import { liveActivityToneOf } from './live-activity'

/*
 * 语气表是「事件等级 → 状态颜色」的唯一定义。这里把它逐项钉死：换个颜色名、少写一档，
 * 都会让某一级事件悄悄退回默认色，界面上看不出来但语义已经错了。
 */
describe('liveActivityToneOf', () => {
  it.each<[LiveRequestEventLevel, string]>([
    ['info', 'neutral'],
    ['success', 'success'],
    ['warn', 'warning'],
    ['error', 'error'],
  ])('把 %s 级事件映到 %s 语气', (level, tone) => {
    expect(liveActivityToneOf(level)).toBe(tone)
  })
})
