// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { CLIENT_CONFIG_SAMPLE_API_KEY } from '@common/client-config'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AddressCard } from './address-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

/** `hintStyle="icon"` 那一档会挂出 `Tooltip`，它需要一个 Provider（真实应用里在 `App.tsx`）。 */
function TooltipWrapper(props: WrapperProps) {
  return (
    <Wrapper>
      <TooltipProvider>{props.children}</TooltipProvider>
    </Wrapper>
  )
}

const ORIGIN = 'http://127.0.0.1:5178'

describe('AddressCard', () => {
  beforeEach(() => {
    // 固定语言，避免测试结果依赖运行环境的系统语言。
    useLanguageStore.setState({ preference: 'en' })
  })

  it('只给一条地址，另两个值当作占位值摆在设置行里', () => {
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    // 地址是全页唯一的主角，另一种写法是一句说明，不是第二条值。
    expect(screen.getAllByText(ORIGIN)).toHaveLength(1)
    expect(screen.getByText(CLIENT_CONFIG_SAMPLE_API_KEY)).not.toBeNull()
    expect(screen.getByText(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME)).not.toBeNull()
  })

  it('地址读不出来时摆占位符并把复制按钮禁用，而不是收掉这一行', () => {
    render(<AddressCard origin="" copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    expect(screen.getByText('—')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy address' })).toHaveProperty('disabled', true)
  })

  it('三个入口各自报出自己的回执 key，回执才能落到具体那一行', () => {
    const onCopy = vi.fn()
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={onCopy} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy API Key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy model name' }))

    expect(onCopy.mock.calls).toEqual([
      ['origin', ORIGIN],
      ['apiKey', CLIENT_CONFIG_SAMPLE_API_KEY],
      ['modelName', BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME],
    ])
  })

  it('hintStyle="icon" 把两行长说明收进标题行：默认视图只剩要抄的值', () => {
    render(
      <AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} hintStyle="icon" />,
      { wrapper: TooltipWrapper },
    )

    // 说明没有删掉，它成了图标的可访问名——悬停/聚焦就能读到同一句话。
    const apiKeyHint = screen.getByLabelText(/Auth is not checked locally/)
    const modelHint = screen.getByLabelText(/Not a fixed value/)
    expect(apiKeyHint.tagName).toBe('BUTTON')
    expect(modelHint.tagName).toBe('BUTTON')

    // 值是这段视图的全部内容：三个入口一个不少，地址那一句常驻的说明也还在。
    expect(screen.getAllByText(ORIGIN)).toHaveLength(1)
    expect(screen.getByText(CLIENT_CONFIG_SAMPLE_API_KEY)).not.toBeNull()
    expect(screen.getByText(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy model name' })).not.toBeNull()
  })

  it('不摆模型名时那一行整条不在，复制入口也跟着少一个', () => {
    render(
      <AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} showModelName={false} />,
      { wrapper: Wrapper },
    )

    expect(screen.queryByText(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy model name' })).toBeNull()
    // 地址与密钥不受影响：少了模型名不等于这张卡变空。
    expect(screen.getAllByText(ORIGIN)).toHaveLength(1)
    expect(screen.getByText(CLIENT_CONFIG_SAMPLE_API_KEY)).not.toBeNull()
  })

  it('footer 槽位收在卡片内部：调用方补的那句话与这些值同属一张卡', () => {
    render(
      <AddressCard
        origin={ORIGIN}
        copiedKey={null}
        onCopy={() => {}}
        footer={<span>Every write keeps a version</span>}
      />,
      { wrapper: Wrapper },
    )

    const card = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    expect(card?.textContent).toContain('Every write keeps a version')
  })

  it('不传 footer 时不留下空的收尾行', () => {
    render(<AddressCard origin={ORIGIN} copiedKey={null} onCopy={() => {}} />, { wrapper: Wrapper })

    const card = screen.getByText(ORIGIN).closest('[data-slot="card"]')
    // 卡片下边缘就是最后一行：多一条空行会让卡片看上去少了一行内容。
    expect(card?.textContent).toBe([
      'Local service address',
      'The one address a client should point at',
      ORIGIN,
      'Copy address',
      'Add /v1 or leave it out, either works: every accepted path is registered in both forms',
      'API Key',
      'Auth is not checked locally, so this value only has to be non-empty',
      CLIENT_CONFIG_SAMPLE_API_KEY,
      'Copy API Key',
      'Model name',
      'Not a fixed value: any non-empty model name is accepted, because it only feeds routing — which logical model it hits, and which upstream that lands on, are both decided by routing. If unsure, use default, the fallback one',
      BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME,
      'Copy model name',
    ].join(''))
  })
})
