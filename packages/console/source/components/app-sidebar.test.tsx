// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { isSpuriousHoverLeave } from './app-sidebar'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  useNavigate: () => vi.fn(),
}))

// 侧栏盒：原点在左上、右侧 224px（展开宽度）。
const element = {
  getBoundingClientRect: () => ({
    left: 0, top: 0, right: 224, bottom: 800, width: 224, height: 800, x: 0, y: 0, toJSON: () => ({}),
  }),
} as unknown as Element

describe('app sidebar hover leave', () => {
  it('指针仍停在侧栏盒内时，离开判定为假——View Transition 的快照层会抢走命中测试', () => {
    expect(isSpuriousHoverLeave({ clientX: 100, clientY: 400, pointerType: 'mouse' }, element)).toBe(true)
    expect(isSpuriousHoverLeave({ clientX: 0.5, clientY: 0.5, pointerType: 'mouse' }, element)).toBe(true)
  })

  it('指针真的移到盒外时，离开判定为真', () => {
    // 越过右边缘进主内容区
    expect(isSpuriousHoverLeave({ clientX: 400, clientY: 400, pointerType: 'mouse' }, element)).toBe(false)
    // 向上离开
    expect(isSpuriousHoverLeave({ clientX: 100, clientY: 900, pointerType: 'mouse' }, element)).toBe(false)
    // 贴着边界（原点）也必须算真离开，否则侧栏会卡在展开态
    expect(isSpuriousHoverLeave({ clientX: 0, clientY: 0, pointerType: 'mouse' }, element)).toBe(false)
  })

  it('非鼠标指针没有可靠坐标，不参与判定', () => {
    expect(isSpuriousHoverLeave({ clientX: 100, clientY: 400, pointerType: 'touch' }, element)).toBe(false)
  })
})
