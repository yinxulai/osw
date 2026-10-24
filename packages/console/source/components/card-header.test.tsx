// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardSectionHeader } from './card-section-header'
import { SettingsCardHeader } from './settings-card-header'

/*
 * 卡片头是「一个模块」的门面，形态必须被钉住，否则每个页面都会各拼一套：
 *   - 白底 + 一条底部发丝线（`bordered`），不要灰底满铺；
 *   - 标题栏右侧的控件容器自己带 8px 间距（调用方会把两个按钮直接塞进来）；
 *   - 图标只在标题里出现，且是唯一装饰（不占一整列、不撑大行高）。
 */

describe('CardSectionHeader', () => {
  it('默认不画边框线（只有显式要求模块感时才加）', () => {
    render(<CardSectionHeader title="模型" />)

    // 基础 `CardHeader` 的类名里带一个 `[.border-b]:…` 变体选择器，所以只断言真正的边框色。
    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    expect(header.className).not.toContain('border-border/50')
  })

  it('bordered 时画底部发丝线，并自带内边距', () => {
    render(<CardSectionHeader title="模型" bordered />)

    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('border-b border-border/50')
    expect(header.className).toContain('px-4 py-4')
  })

  it('compact 压缩底部留白', () => {
    render(<CardSectionHeader title="模型" compact />)

    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('pb-1.5')
  })

  it('标题与说明分别落在 CardTitle / CardDescription 上', () => {
    render(<CardSectionHeader title="模型" description="按优先级路由" />)

    expect(screen.getByText('模型').getAttribute('data-slot')).toBe('card-title')
    expect(screen.getByText('按优先级路由').getAttribute('data-slot')).toBe('card-description')
  })

  it('没有说明时不留一个空的说明节点（否则会多出一条空白行）', () => {
    render(<CardSectionHeader title="模型" />)

    expect(screen.queryByText('', { selector: '[data-slot="card-description"]' })).toBeNull()
  })

  it('有控件时头变成横向两段布局，控件容器自带 gap-2', () => {
    render(<CardSectionHeader title="模型" actions={<><button>改</button><button>存</button></>} />)

    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('flex flex-row items-start justify-between')
    const actions = screen.getByText('改').parentElement!
    expect(actions.className).toContain('gap-2')
    // 两个按钮进的是同一个容器，不会被拆到两端。
    expect(actions.contains(screen.getByText('存'))).toBe(true)
  })

  it('没有控件时头保持纵向单列（不凭空占出一列）', () => {
    render(<CardSectionHeader title="模型" />)

    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    // 只断言「只有一个子节点」：基础类名里自带的 `has-data-[slot=card-action]:flex-row`
    // 会命中 flex-row 这个子串，不能拿字符串包含当判据。
    expect(header.children).toHaveLength(1)
  })

  it('外部 className 会叠加而不是替换掉既有形态', () => {
    render(<CardSectionHeader title="模型" className="mt-2" />)

    const header = screen.getByText('模型').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('mt-2')
    expect(header.className).toContain('pb-3')
  })
})

describe('SettingsCardHeader', () => {
  it('就是带边框的卡片头（白底 + 一条发丝线）', () => {
    render(<SettingsCardHeader title="常规" />)

    const header = screen.getByText('常规').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('border-b border-border/50')
  })

  it('靠负上边距贴住卡片顶部，并把内边距收扁（设置卡片头不该厚）', () => {
    render(<SettingsCardHeader title="常规" />)

    const header = screen.getByText('常规').closest('[data-slot="card-header"]')!
    expect(header.className).toContain('-mt-4')
    expect(header.className).toContain('py-3')
  })

  it('图标与标题在同一行，且图标是唯一装饰', () => {
    render(<SettingsCardHeader title="常规" icon={<svg data-testid="icon" />} />)

    // 标题文字挂在一个 <span> 上（图标与文字同一个行内盒），这个 span 是 CardTitle 的唯一子节点。
    const row = document.querySelector('[data-slot="card-title"]')!.firstElementChild as HTMLElement
    expect(row.className).toContain('flex items-center gap-2')
    expect(row.contains(screen.getByTestId('icon'))).toBe(true)
  })

  it('不传图标时不渲染图标占位', () => {
    render(<SettingsCardHeader title="常规" />)

    expect(document.querySelector('[data-slot="card-title"]')!.querySelector('svg')).toBeNull()
  })

  it('控件与说明照常透传下去', () => {
    render(<SettingsCardHeader title="常规" description="启动时的行为" actions={<button>保存</button>} />)

    expect(screen.getByText('启动时的行为')).toBeTruthy()
    expect(screen.getByText('保存')).toBeTruthy()
  })
})
