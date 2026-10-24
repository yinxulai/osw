import { describe, expect, it } from 'vitest'
import { cn } from './utils'

/*
 * `cn` 只有一件事要说清楚：它不是把类名拼起来，而是**最后写的赢**。
 *
 * 这条语义是整份界面的前提——组件默认样式写在前面、调用方传的 `className` 接在后面，
 * 靠的就是 tailwind-merge 把冲突的那一个删掉。如果它退化成 `clsx`，
 * 所有「外部覆盖内部」的地方都会变成样式打架（谁生效看 CSS 里谁的顺序更靠后）。
 */
describe('cn', () => {
  it('把多个类名合成一个字符串', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center')
  })

  it('丢弃假值，保留条件类名', () => {
    expect(cn('flex', false && 'hidden', undefined, null, 'gap-2')).toBe('flex gap-2')
  })

  it('支持数组与对象写法', () => {
    expect(cn(['flex', 'gap-2'], { hidden: false, 'text-sm': true })).toBe('flex gap-2 text-sm')
  })

  it('同类冲突时以后写的为准（这是它和 clsx 的区别）', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('后写的方向覆盖前写的整体，且不误删不冲突的方向', () => {
    expect(cn('p-2', 'px-4')).toBe('p-2 px-4')
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('后写的色板/尺寸覆盖前写的，即使属性前缀相同', () => {
    expect(cn('text-sm text-quaternary', 'text-sm text-secondary')).toBe('text-sm text-secondary')
  })

  it('非 Tailwind 的自定义类名原样保留', () => {
    expect(cn('module-border', 'data-[state=open]:bg-card')).toBe('module-border data-[state=open]:bg-card')
  })

  it('没有输入时返回空串', () => {
    expect(cn()).toBe('')
  })
})
