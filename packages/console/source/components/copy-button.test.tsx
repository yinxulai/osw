// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CopyButton } from '@/components/copy-button'

/*
 * 复制按钮。
 *
 * 这个组件的形状被刻意钉死成**一种**（只有图标、没有文字）。用例守着两件事：
 *  1. 回执是按 `itemKey` 记的——同一行里好几个复制按钮，只有一个会变勾；
 *  2. 值拼不出来时是**禁用**，不是隐藏（布局不跟着数据有无变形）。
 */

describe('复制按钮', () => {
  it('回执只落在被点的那一个上（同一行里多个复制按钮互不串号）', () => {
    const onCopy = vi.fn()
    render(
      <>
        <CopyButton itemKey="baseUrl" value="http://127.0.0.1:8787" copiedKey="baseUrl" onCopy={onCopy} label="复制地址" />
        <CopyButton itemKey="apiKey" value="sk-osw-x" copiedKey={null} onCopy={onCopy} label="复制密钥" />
      </>,
    )

    // 「已复制」的那一个换成勾，另一个仍是复制图标。
    expect(screen.getByLabelText('复制地址').querySelector('.lucide-check')).toBeTruthy()
    expect(screen.getByLabelText('复制密钥').querySelector('.lucide-check')).toBeNull()
    expect(screen.getByLabelText('复制密钥').querySelector('.lucide-copy')).toBeTruthy()
  })

  it('点击把 key 与值一起回传（回执由上层记录，按钮自己无状态）', () => {
    const onCopy = vi.fn()
    render(<CopyButton itemKey="endpoint" value="http://127.0.0.1:8787/v1" copiedKey={null} onCopy={onCopy} label="复制地址" />)

    fireEvent.click(screen.getByLabelText('复制地址'))

    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledWith('endpoint', 'http://127.0.0.1:8787/v1')
  })

  it('值是空串时禁用而不是隐藏——服务没起来也要留原位', () => {
    const onCopy = vi.fn()
    const { container } = render(<CopyButton itemKey="baseUrl" value="" copiedKey={null} onCopy={onCopy} label="复制地址" />)

    const button = screen.getByLabelText('复制地址')
    expect(button.disabled).toBe(true)
    // 按钮还在 DOM 里。
    expect(container.querySelectorAll('button')).toHaveLength(1)

    fireEvent.click(button)
    expect(onCopy).not.toHaveBeenCalled()
  })

  it('名字同时写在 aria-label 与 title 上（读屏念一遍，鼠标悬停也能看到）', () => {
    render(<CopyButton itemKey="baseUrl" value="http://127.0.0.1:8787" copiedKey={null} onCopy={vi.fn()} label="复制服务地址" />)

    const button = screen.getByLabelText('复制服务地址')
    expect(button.getAttribute('title')).toBe('复制服务地址')
  })

  it('同值不同形态：名字不受「已复制」状态影响', () => {
    const { rerender } = render(<CopyButton itemKey="baseUrl" value="x" copiedKey={null} onCopy={vi.fn()} label="复制地址" />)
    expect(screen.getByLabelText('复制地址')).toBeTruthy()

    rerender(<CopyButton itemKey="baseUrl" value="x" copiedKey="baseUrl" onCopy={vi.fn()} label="复制地址" />)
    expect(screen.getByLabelText('复制地址')).toBeTruthy()
  })
})
