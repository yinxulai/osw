// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { AsyncState, AsyncStateSkeleton } from './async-state'

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps {
  children: ReactNode
}

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

afterEach(() => {
  cleanup()
})

describe('AsyncState', () => {
  it('加载中优先于错误与空态，且不露出「暂无数据」', () => {
    render(
      <Wrapper>
        <AsyncState loading error="boom" empty emptyState={{ icon: Inbox, title: '暂无数据' }}>
          <p>内容</p>
        </AsyncState>
      </Wrapper>,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByText('暂无数据')).toBeNull()
    expect(screen.queryByText('boom')).toBeNull()
    expect(screen.queryByText('内容')).toBeNull()
  })

  it('错误态给出原始信息与可重试动作', () => {
    const onRetry = vi.fn()
    render(
      <Wrapper>
        <AsyncState loading={false} error="管理服务未启动" onRetry={onRetry}>
          <p>内容</p>
        </AsyncState>
      </Wrapper>,
    )

    expect(screen.getByText('管理服务未启动')).toBeTruthy()
    expect(screen.queryByText('内容')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('空态显示图标、标题、说明与主行动按钮', () => {
    render(
      <Wrapper>
        <AsyncState
          loading={false}
          empty
          emptyState={{
            icon: Inbox,
            title: '还没有规则',
            description: '新建一条规则后就会出现在这里。',
            action: <button type="button">新建规则</button>,
          }}
        >
          <p>内容</p>
        </AsyncState>
      </Wrapper>,
    )

    expect(screen.getByText('还没有规则')).toBeTruthy()
    expect(screen.getByText('新建一条规则后就会出现在这里。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建规则' })).toBeTruthy()
    expect(screen.queryByText('内容')).toBeNull()
  })

  it('有数据时只渲染内容', () => {
    render(
      <Wrapper>
        <AsyncState loading={false} error={null} empty={false}>
          <p>内容</p>
        </AsyncState>
      </Wrapper>,
    )

    expect(screen.getByText('内容')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('AsyncStateSkeleton', () => {
  it('按行数渲染并带可访问的加载语义', () => {
    const { container } = render(
      <Wrapper>
        <AsyncStateSkeleton rows={3} />
      </Wrapper>,
    )

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})
