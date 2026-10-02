// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ClientConfigEditor } from './client-config-editor'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

/*
 * 这一层守两件事：
 * 1. 客户端宫格——一卡一个工具、单选、点一下就换编辑对象；
 * 2. 写在「配置内容」那张卡卡头右边的那排写入动作——生成 / 撤销 / 保存何时出现、何时可用、按下去转成什么。
 * 注册表压成两只、图标换占位；状态层回一个受控的假编辑器（真状态由
 * `use-client-config-editor.test.tsx` 守着），于是断言只落在版面上。
 */
const CLIENTS = vi.hoisted(() => [
  { key: 'alpha', name: 'Alpha' },
  { key: 'beta', name: 'Beta' },
])

const state = vi.hoisted(() => ({
  clientKey: '',
  /** 文件是否已到手（`client` 在不在、`files` 空不空、`loading` 真假都跟着它走）。 */
  ready: false,
  canGenerate: false,
  generating: false,
  saving: false,
  dirty: false,
  dirtyFilePaths: [] as string[],
  /** 记下那排写入动作转回来的调用。 */
  calls: { generate: 0, generateKeep: null as boolean | null, save: 0, discard: [] as string[] },
}))

vi.mock('@/catalog/clients', () => ({ AGENT_CLIENT_DEFINITIONS: CLIENTS }))

interface ClientIconStubProps { clientKey: string }

vi.mock('./client-icon', () => ({
  ClientIcon: (props: ClientIconStubProps) => <span data-testid={`icon-${props.clientKey}`} />,
}))

vi.mock('../hooks/use-client-config-editor', () => ({
  useClientConfigEditor: (clientKey: string) => {
    state.clientKey = clientKey
    const filePath = '~/.alpha/settings.json'
    const file = { filePath, loading: false, error: null, content: '{}', dirty: state.dirty, state: { contentHash: 'h' } }
    return {
      clientKey,
      client: state.ready ? { key: 'alpha', name: 'Alpha' } : undefined,
      files: state.ready ? [file] : [],
      activeFilePath: state.ready ? filePath : '',
      selectFile: () => {},
      loading: !state.ready,
      error: null,
      changeValues: () => {},
      changeContent: () => {},
      discardFile: (target: string) => state.calls.discard.push(target),
      generateConfig: (keepDetectedModel?: boolean) => {
        state.calls.generate += 1
        state.calls.generateKeep = keepDetectedModel ?? true
      },
      generating: state.generating,
      canGenerate: state.canGenerate,
      dirtyFilePaths: state.dirtyFilePaths,
      saveAll: () => { state.calls.save += 1 },
      saving: state.saving,
      slots: 0,
      configurable: false,
      model: '',
      valuesFile: state.ready ? file : undefined,
      draftReset: 0,
      versions: [],
      versionsLoading: false,
      restoreVersion: () => {},
      restoringId: null,
    }
  },
}))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

const en = createAppTranslator('en')

// 卡头那颗「保存」的文案随改动份数变：0 份或 1 份是「保存内容」，多份才是「保存全部（n）」。
const saveLabel = () => en('clientConfig.saveContent')

describe('ClientConfigEditor', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    state.clientKey = ''
    state.ready = false
    state.canGenerate = false
    state.generating = false
    state.saving = false
    state.dirty = false
    state.dirtyFilePaths = []
    state.calls = { generate: 0, generateKeep: null, save: 0, discard: [] }
  })

  it('客户端摆成宫格：一卡一个、每张带品牌图标与名字，且是单选', () => {
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    // 一整组同名 radio：宫格是互斥的，键盘能走、`aria-checked` 自动正确。
    const group = screen.getByRole('radiogroup', { name: en('clientConfig.selectClient') })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(CLIENTS.length)
    expect(group.contains(radios[0])).toBe(true)

    // 每张卡都摆出那一个客户端：图标（认得出）+ 名字。
    for (const client of CLIENTS) {
      expect(screen.getByTestId(`icon-${client.key}`)).not.toBeNull()
      expect(screen.getByText(client.name)).not.toBeNull()
    }
  })

  it('默认落在清单里第一个客户端，编辑对象就是它', () => {
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    expect(state.clientKey).toBe(CLIENTS[0].key)
    expect((screen.getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true)
  })

  it('点另一张卡就把编辑对象换成它，选中的也跟着挪过去', () => {
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    fireEvent.click(screen.getAllByRole('radio')[1])

    expect(state.clientKey).toBe(CLIENTS[1].key)
    expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true)
  })

  it('文件还没到手时不摆写入按钮：那会儿既没有「当前文件」，也谈不上改动', () => {
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    expect(screen.queryByRole('button', { name: en('clientConfig.generate') })).toBeNull()
    expect(screen.queryByRole('button', { name: en('clientConfig.discard') })).toBeNull()
    expect(screen.queryByRole('button', { name: saveLabel() })).toBeNull()
  })

  it('就绪后「配置内容」卡头就是「生成 / 撤销 / 保存」三颗：引导页没有选模型这一步，生成一律按内置默认', () => {
    state.ready = true
    state.canGenerate = true
    state.dirty = true
    state.dirtyFilePaths = ['~/.alpha/settings.json']
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: en('clientConfig.generate') }))
    // 「不沿用文件里的旧模型」这条契约由参数带出去：引导页传 `false`，详情页才传 `true`。
    expect(state.calls.generate).toBe(1)
    expect(state.calls.generateKeep).toBe(false)

    expect(screen.getByRole('button', { name: en('clientConfig.discard') })).not.toBeNull()
    expect(screen.getByRole('button', { name: saveLabel() })).not.toBeNull()
  })

  it('没有配方的客户端不摆生成按钮，但撤销 / 保存仍在', () => {
    state.ready = true
    state.canGenerate = false
    state.dirty = true
    state.dirtyFilePaths = ['~/.alpha/settings.json']
    render(<ClientConfigEditor />, { wrapper: Wrapper })

    expect(screen.queryByRole('button', { name: en('clientConfig.generate') })).toBeNull()
    expect(screen.getByRole('button', { name: en('clientConfig.discard') })).not.toBeNull()
    expect(screen.getByRole('button', { name: saveLabel() })).not.toBeNull()
  })

  it('没改动时保存 / 撤销不可用，写入进行中时三颗一起锁住', () => {
    state.ready = true
    state.canGenerate = true
    // 没有改动：两颗写入按钮都按不动。
    const { unmount } = render(<ClientConfigEditor />, { wrapper: Wrapper })
    expect((screen.getByRole('button', { name: saveLabel() }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: en('clientConfig.discard') }) as HTMLButtonElement).disabled).toBe(true)
    unmount()

    // 有改动、但正在生成 / 保存：三颗一起锁住，避免半截状态下再点一次。
    state.dirty = true
    state.dirtyFilePaths = ['~/.alpha/settings.json']
    state.generating = true
    state.saving = true
    render(<ClientConfigEditor />, { wrapper: Wrapper })
    expect((screen.getByRole('button', { name: en('clientConfig.generating') }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: en('clientConfig.discard') }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: en('clientConfig.saving') }) as HTMLButtonElement).disabled).toBe(true)
  })
})
