// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'

import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'

import { SaveVersionDialog, type VersionDraft } from './save-version-dialog'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps {
  children: ReactNode
}

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

type HarnessProps = {
  initialName: string
  initialDescription: string
  onConfirm?: (draft: VersionDraft) => void
}

/** 弹窗是受控的，测试里得自己提供一个能开能关的宿主。 */
function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <SaveVersionDialog
        open={open}
        nextVersion={4}
        description="Publishing a new version takes effect immediately."
        initialName={props.initialName}
        initialDescription={props.initialDescription}
        saving={false}
        onOpenChange={setOpen}
        onConfirm={props.onConfirm ?? (() => {})}
      />
    </>
  )
}

function renderDialog(props: Partial<HarnessProps> = {}) {
  const view = render(
    <Harness initialName={props.initialName ?? ''} initialDescription={props.initialDescription ?? ''} onConfirm={props.onConfirm} />,
    { wrapper: Wrapper },
  )
  return {
    ...view,
    open: () => fireEvent.click(screen.getByRole('button', { name: 'open' })),
    nameInput: () => screen.getByLabelText('Name') as HTMLInputElement,
    descriptionInput: () => screen.getByLabelText('Notes') as HTMLTextAreaElement,
  }
}

describe('SaveVersionDialog', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('打开时带出上一版的名字与说明', () => {
    const view = renderDialog({ initialName: '按 UA 分流', initialDescription: '先把 UA 分流出来' })
    view.open()

    expect(view.nameInput().value).toBe('按 UA 分流')
    expect(view.descriptionInput().value).toBe('先把 UA 分流出来')
  })

  it('没有来源版本时留空，placeholder 只做格式示范', () => {
    const view = renderDialog()
    view.open()

    expect(view.nameInput().value).toBe('')
    expect(view.nameInput().placeholder).toBe('e.g. Route by client')
    expect(view.descriptionInput().value).toBe('')
  })

  it('重新打开时回到来源版本的名字，而不是上次敲的内容', () => {
    const view = renderDialog({ initialName: '第一版' })
    view.open()
    fireEvent.change(view.nameInput(), { target: { value: '临时打的字' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    view.open()

    expect(view.nameInput().value).toBe('第一版')
  })

  it('打开期间来源版本变化不冲掉已输入的内容', () => {
    // 保存失败时弹窗故意不关，此时上层若把初值改了，用户刚敲的字必须留着。
    const view = renderDialog({ initialName: '第一版' })
    view.open()
    fireEvent.change(view.nameInput(), { target: { value: '手写的名字' } })

    view.rerender(<Harness initialName="第二版" initialDescription="换了" />)

    expect(view.nameInput().value).toBe('手写的名字')
    expect(view.descriptionInput().value).toBe('')
  })

  it('提交时把两个字段去空白后交给调用方', () => {
    const onConfirm = vi.fn()
    const view = renderDialog({ onConfirm })
    view.open()
    fireEvent.change(view.nameInput(), { target: { value: '  按 UA 分流  ' } })
    fireEvent.change(view.descriptionInput(), { target: { value: '  第一条  ' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))

    expect(onConfirm).toHaveBeenCalledWith({ name: '按 UA 分流', description: '第一条' })
  })

  it('取消不触发保存', () => {
    const onConfirm = vi.fn()
    const view = renderDialog({ onConfirm })
    view.open()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
