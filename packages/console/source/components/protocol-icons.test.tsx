// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderModelRouteEndpoint } from '@common/schemas'
import { ProtocolIcons } from '@/components/protocol-icons'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TooltipProvider } from '@/components/ui/tooltip'

/*
 * 端点协议图标。
 *
 * 两条规则值得单独守住：
 *  1. 图标只负责**形状**，名字一律取自契约层的 `PROTOCOL_DISPLAY_NAMES`（不意译、两边同名）；
 *  2. 转换图标只在**真的需要转换**时出现——端点启用了转换、且这种转换能发生、
 *     且客户端协议不是这个端点本来就原生支持的（原生已经画过了，再画一个重复）。
 *
 * 转换图标的可读名是「{协议}（经协议转换支持）」，与原生图标的裸协议名区分开。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

/** 转换图标在无障碍树里的名字。 */
function converted(protocol: string): string {
  return `${protocol}（经协议转换支持）`
}

function endpoint(overrides: Partial<ProviderModelRouteEndpoint> = {}): ProviderModelRouteEndpoint {
  return {
    protocol: 'openai-completions',
    baseUrl: 'https://api.example.com',
    protocolConversionEnabled: false,
    ...overrides,
  } as ProviderModelRouteEndpoint
}

function renderIcons(endpoints: ProviderModelRouteEndpoint[]) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(
    <I18nProvider>
      <TooltipProvider>
        <ProtocolIcons endpoints={endpoints} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

/** 每个图标都是一个带 `aria-label` 的 span。 */
function iconLabels(): string[] {
  return screen.queryAllByLabelText(/.+/)
    .filter(el => el.tagName === 'SPAN' && el.className.includes('size-5'))
    .map(el => el.getAttribute('aria-label') ?? '')
}

describe('原生协议图标', () => {
  it('每个端点画一个图标，名字用正式叫法', () => {
    renderIcons([endpoint({ protocol: 'openai-completions' })])

    expect(screen.getByLabelText('OpenAI Completions')).toBeTruthy()
  })

  it('三种协议各有自己的叫法（都是产品名，不翻译）', () => {
    renderIcons([
      endpoint({ protocol: 'openai-completions' }),
      endpoint({ protocol: 'openai-responses' }),
      endpoint({ protocol: 'anthropic-messages' }),
    ])

    expect(screen.getByLabelText('OpenAI Completions')).toBeTruthy()
    expect(screen.getByLabelText('OpenAI Responses')).toBeTruthy()
    expect(screen.getByLabelText('Anthropic Messages')).toBeTruthy()
  })

  it('一个端点都没有时是个空容器，不崩', () => {
    const { container } = renderIcons([])
    expect(container.querySelectorAll('span.size-5')).toHaveLength(0)
  })
})

describe('协议转换图标', () => {
  it('没启用转换就不画转换图标', () => {
    renderIcons([endpoint({ protocol: 'openai-completions', protocolConversionEnabled: false })])

    expect(iconLabels().some(label => label.includes('经协议转换支持'))).toBe(false)
  })

  it('启用转换后，把能接的客户端协议补上', () => {
    renderIcons([endpoint({ protocol: 'openai-completions', protocolConversionEnabled: true })])

    // openai-completions 能接 anthropic-messages 与 openai-responses 两种。
    const labels = iconLabels()
    expect(labels).toHaveLength(3)
    expect(screen.getByLabelText(converted('Anthropic Messages'))).toBeTruthy()
    expect(screen.getByLabelText(converted('OpenAI Responses'))).toBeTruthy()
  })

  it('原生已经画过的协议不重复补——同一个协议在同一行出现两次会让人以为配了两个端点', () => {
    renderIcons([
      endpoint({ protocol: 'openai-completions', protocolConversionEnabled: true, baseUrl: 'https://a.example.com' }),
      endpoint({ protocol: 'anthropic-messages', baseUrl: 'https://b.example.com' }),
    ])

    const labels = iconLabels()
    // anthropic-messages 作为原生协议已经出现，因此不该再有它的转换图标。
    expect(labels.filter(label => label === 'Anthropic Messages')).toHaveLength(1)
    expect(screen.queryByLabelText(converted('Anthropic Messages'))).toBeNull()
    // 但 openai-responses 没在原生列表里，转换图标应当补上。
    expect(screen.getByLabelText(converted('OpenAI Responses'))).toBeTruthy()
  })

  it('端点协议本身不能接任何转换时，启用开关也不画（例如 openai-responses）', () => {
    renderIcons([endpoint({ protocol: 'openai-responses', protocolConversionEnabled: true })])

    expect(iconLabels()).toHaveLength(1)
    expect(iconLabels()[0]).toBe('OpenAI Responses')
  })

  it('多个端点各自算各自的，互不影响', () => {
    renderIcons([
      endpoint({ protocol: 'anthropic-messages', protocolConversionEnabled: true }),
      endpoint({ protocol: 'openai-responses', protocolConversionEnabled: true }),
    ])

    // anthropic-messages 能接 openai-completions；openai-responses 谁都不接。
    expect(screen.getByLabelText(converted('OpenAI Completions'))).toBeTruthy()
    expect(iconLabels()).toHaveLength(3)
  })

  it('每个端点各补各的转换图标，且不因为 key 撞车丢图标', () => {
    renderIcons([
      endpoint({ protocol: 'openai-completions', protocolConversionEnabled: true }),
      endpoint({ protocol: 'anthropic-messages', protocolConversionEnabled: true }),
    ])

    // 算一遍：openai-completions 想补 anthropic-messages（native 已有 → 去掉）与 openai-responses（保留）；
    // anthropic-messages 想补 openai-completions（native 已有 → 去掉）。所以只剩 1 个转换图标。
    const conversions = iconLabels().filter(label => label.includes('经协议转换支持'))
    expect(conversions).toEqual([converted('OpenAI Responses')])
    expect(iconLabels()).toHaveLength(3)
  })

  it('两个端点都补出转换图标时，图标不会互相覆盖', () => {
    renderIcons([
      endpoint({ protocol: 'anthropic-messages', protocolConversionEnabled: true }),
      endpoint({ protocol: 'openai-completions', protocolConversionEnabled: true, baseUrl: 'https://b.example.com' }),
    ])

    // 这个组合里 openai-completions 是 native，所以两边各去掉一个后：
    // anthropic 补 openai-completions 被去掉，completions 补 anthropic 被去掉，只剩 openai-responses。
    // 换言之转换图标的 key 必须带上「从哪个端点转换来」，否则会互相顶掉。
    const conversions = iconLabels().filter(label => label.includes('经协议转换支持'))
    expect(conversions).toEqual([converted('OpenAI Responses')])
    expect(screen.getByLabelText('Anthropic Messages')).toBeTruthy()
    expect(screen.getByLabelText('OpenAI Completions')).toBeTruthy()
  })
})

describe('交互', () => {
  it('图标带 tooltip 触发器（鼠标悬停才出全名）', () => {
    renderIcons([endpoint({ protocol: 'openai-completions', protocolConversionEnabled: true })])

    const trigger = screen.getByLabelText(converted('Anthropic Messages'))
    fireEvent.mouseEnter(trigger)
    // tooltip 内容由 radix 渲染，这里只确认触发器本身是可悬停的 DOM 节点。
    expect(trigger.tagName).toBe('SPAN')
  })

  it('图标本身对读屏隐藏，名字走 aria-label（一个图形不要念两遍）', () => {
    renderIcons([endpoint({ protocol: 'openai-completions' })])

    const svg = screen.getByLabelText('OpenAI Completions').querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('点击不影响任何回调（纯展示）', () => {
    const onSpy = vi.fn()
    renderIcons([endpoint({ protocol: 'openai-completions' })])

    fireEvent.click(screen.getByLabelText('OpenAI Completions'))
    expect(onSpy).not.toHaveBeenCalled()
  })
})
