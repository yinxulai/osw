// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ClientConfigAutoFill, ClientConfigCoverage } from '@common/client-config'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { CoverageBadge } from './coverage-badge'

/*
 * 「覆盖状态」徽标。
 *
 * 四档状态各有各的颜色与文案，其中 `unavailable`（仅手动）是最容易被误解成「出错了」的一档，
 * 所以它额外挂一枚可点开的口径图标——但只在**真有原因可说**（`autoFill !== 'ready'`）时才挂。
 */

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <TooltipProvider>{props.children}</TooltipProvider>
    </I18nProvider>
  )
}

function renderBadge(coverage: ClientConfigCoverage, pendingChanges = 0, autoFill: ClientConfigAutoFill = 'ready') {
  return render(<CoverageBadge coverage={coverage} pendingChanges={pendingChanges} autoFill={autoFill} />, { wrapper })
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('CoverageBadge', () => {
  it.each([
    ['applied', 'success', '已生效'],
    ['pending', 'warning', '待写入 0 项'],
    ['absent', 'muted', '尚未创建'],
    ['unavailable', 'outline', '仅手动'],
  ] as const)('%s 档用 %s 变体与对应文案', (coverage, variant, label) => {
    const { container } = renderBadge(coverage)

    const badge = container.querySelector('[data-slot="badge"]') as HTMLElement
    expect(badge.getAttribute('data-variant')).toBe(variant)
    expect(badge.textContent).toBe(label)
  })

  it('只有 pending 会把「还差几处」写进徽标文字', () => {
    expect(renderBadge('pending', 3).container.querySelector('[data-slot="badge"]')?.textContent).toBe('待写入 3 项')
    // 其它档的插值参数没有落点，文案里也不该冒出数字。
    expect(renderBadge('applied', 3).container.querySelector('[data-slot="badge"]')?.textContent).toBe('已生效')
    expect(renderBadge('absent', 3).container.querySelector('[data-slot="badge"]')?.textContent).toBe('尚未创建')
    expect(renderBadge('unavailable', 3).container.querySelector('[data-slot="badge"]')?.textContent).toBe('仅手动')
  })

  it('其它三档不挂口径图标（它们不是「为什么不能自动生效」）', () => {
    // `autoFill` 给一个非 ready 的值，若组件不按 coverage 收口就会漏出图标。
    for (const coverage of ['applied', 'pending', 'absent'] as const) {
      const { container } = renderBadge(coverage, 0, 'unparsable')
      expect(container.querySelectorAll('button')).toHaveLength(0)
    }
  })

  it('unavailable 且 autoFill=ready 时不挂图标（没有原因可说）', () => {
    const { container } = renderBadge('unavailable', 0, 'ready')
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it.each([
    ['unparsable', '内容无法解析，因而无法自动写入；请在下方手动编辑。'],
    ['unsupported-format', '暂不支持自动写入这个格式，请在下方手动编辑内容。'],
    ['unsupported-client', '这个客户端没有可指向本地服务的地址配置，请在下方手动编辑内容。'],
    ['unsupported-environment', '这个客户端只能配一个 provider，开发环境不写入它，以免覆盖你的正式配置；请在下方手动编辑。'],
  ] as const)('unavailable + %s 时图标的口径就是那一档的原因', (autoFill, reason) => {
    renderBadge('unavailable', 0, autoFill)

    // `InfoHint` 的说明文本同时是图标的可访问名。
    expect(screen.getByLabelText(reason)).toBeTruthy()
  })

  it('四档的原因文案互不相同（否则分流就没有意义）', () => {
    const labels = (['unparsable', 'unsupported-format', 'unsupported-client', 'unsupported-environment'] as const)
      .map((autoFill) => {
        const { container, unmount } = renderBadge('unavailable', 0, autoFill)
        const label = container.querySelector('button')?.getAttribute('aria-label') ?? ''
        unmount()
        return label
      })

    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.every(label => label.length > 0)).toBe(true)
  })
})
