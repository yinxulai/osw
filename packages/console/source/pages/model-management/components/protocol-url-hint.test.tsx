// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { PROTOCOL_EXAMPLES } from '../lib/protocols'
import { ProtocolUrlHint } from './protocol-url-hint'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 期望文案直接取自真实中文目录，而不是抄一份字面量：抄一份就会在改词时静默过期。
const zh = createAppTranslator('zh-CN')

/** 示例行左半边的期望文本：有 `providerKey` 的走本地化名，其余用品牌原文。 */
function expectedLabel(example: (typeof PROTOCOL_EXAMPLES)['openai-completions'][number]): string {
  return `${example.providerKey ? zh(example.providerKey) : example.provider}${zh('providers.protocolHint.exampleSeparator')}`
}

interface WrapperProps { children: ReactNode }

function wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
})

describe('ProtocolUrlHint', () => {
  it('首行是「前缀 + 协议名 + 后缀」，协议名单独用等宽字', () => {
    const { container } = render(<ProtocolUrlHint protocol="anthropic-messages" />, { wrapper })

    const firstLine = container.querySelector('p') as HTMLElement
    expect(firstLine.textContent).toBe('完整接口地址需包含协议、主机、路径，指向该模型真实的 anthropic-messages 端点')
    expect(firstLine.querySelector('span')?.textContent).toBe('anthropic-messages')
    expect(firstLine.querySelector('span')?.className).toContain('font-mono')
  })

  it.each([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
  ] as const)('%s 逐行列出该协议的示例地址', protocol => {
    const { container } = render(<ProtocolUrlHint protocol={protocol} />, { wrapper })

    const rows = [...container.querySelectorAll('.grid.gap-0\\.5 > div')]
    expect(rows).toHaveLength(PROTOCOL_EXAMPLES[protocol].length)

    rows.forEach((row, index) => {
      const example = PROTOCOL_EXAMPLES[protocol][index]
      // 示例是 `厂商名：地址`，地址在 `<code>` 里。
      expect(row.querySelector('code')?.textContent).toBe(example.url)
      expect(row.querySelector('span')?.textContent).toBe(expectedLabel(example))
    })
  })

  it('带 providerKey 的示例用本地化名称，不显示原始品牌名', () => {
    const { container } = render(<ProtocolUrlHint protocol="openai-completions" />, { wrapper })

    const rows = [...container.querySelectorAll('.grid.gap-0\\.5 > div')]
    // Ollama 那条有 providerKey，落成中文展示名；OpenAI / DeepSeek 用品牌原文。
    expect(rows.map(row => row.querySelector('span')?.textContent)).toEqual(
      PROTOCOL_EXAMPLES['openai-completions'].map(expectedLabel),
    )
  })

  it('示例地址是可复制的纯文本，不做链接化', () => {
    const { container } = render(<ProtocolUrlHint protocol="openai-responses" />, { wrapper })

    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('code')).toHaveLength(PROTOCOL_EXAMPLES['openai-responses'].length)
  })
})
