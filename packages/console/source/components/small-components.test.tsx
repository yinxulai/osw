// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlertCircle, Server } from 'lucide-react'
import { DeletedTag } from '@/components/deleted-tag'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { InfoHint } from '@/components/info-hint'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TooltipProvider } from '@/components/ui/tooltip'

/*
 * 三个最小的展示件：已删除标签、口径提示、卡内轻量空状态。
 *
 * 它们的共同点是「一句话，但位置和可访问名有讲究」：
 *  - 已删除标签要让人看出「名字查得到、配置已不在」，且不拦截任何操作；
 *  - 口径提示的说明同时是图标的可访问名（键盘/读屏用户不会悬停）；
 *  - 空状态没给图标时不要留一个空占位。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function wrap(children: ReactNode) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(
    <I18nProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>,
  )
}

describe('已删除标签', () => {
  it('文案是「已删除」，不带任何操作', () => {
    const { container } = wrap(<DeletedTag />)

    expect(screen.getByText('已删除')).toBeTruthy()
    // 纯展示：没有按钮、没有链接。
    expect(container.querySelectorAll('button,a')).toHaveLength(0)
  })

  it('可以追加外部类名（同一张表里不同列宽）', () => {
    const { container } = wrap(<DeletedTag className="ml-1" />)
    expect(container.firstElementChild?.className).toContain('ml-1')
  })
})

describe('口径提示图标', () => {
  it('说明就是图标的可访问名（键盘用户不会悬停，得有条别的路读到同一句话）', () => {
    wrap(<InfoHint text="按已完成请求的 token 数统计" />)

    expect(screen.getByLabelText('按已完成请求的 token 数统计')).toBeTruthy()
  })

  it('图标本身对读屏隐藏（图形不念两遍）', () => {
    wrap(<InfoHint text="口径" />)

    const trigger = screen.getByLabelText('口径')
    expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('是可聚焦的触发器（键盘能进得去）', () => {
    wrap(<InfoHint text="口径" />)

    expect(screen.getByLabelText('口径').tagName).toBe('BUTTON')
  })
})

describe('卡内轻量空状态', () => {
  it('标题必给，说明可选', () => {
    const { rerender } = wrap(<InlineEmptyState title="暂无请求记录" />)
    expect(screen.getByText('暂无请求记录')).toBeTruthy()
    expect(screen.queryByText('换个时间范围看看')).toBeNull()

    rerender(
      <I18nProvider>
        <TooltipProvider>
          <InlineEmptyState title="暂无请求记录" description="换个时间范围看看" />
        </TooltipProvider>
      </I18nProvider>,
    )
    expect(screen.getByText('换个时间范围看看')).toBeTruthy()
  })

  it('没给图标就只出文字（不给一个空占位）', () => {
    const { container } = wrap(<InlineEmptyState title="暂无数据" />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('给了图标则图形对读屏隐藏（标题已经说清楚了）', () => {
    const { container } = wrap(<InlineEmptyState title="暂无数据" icon={Server} />)

    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('图标是可替换的任意 lucide 图标', () => {
    const { container } = wrap(<InlineEmptyState title="读取失败" icon={AlertCircle} />)
    expect(container.querySelector('.lucide-circle-alert')).toBeTruthy()
  })
})
