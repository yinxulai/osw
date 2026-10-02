// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientConfigFileState, ClientConfigPreviewResult } from '@common/client-config'
import type { AgentClientDefinition } from '@common/clients'

/*
 * 被测的是「一套状态怎么在**多份文件**上分头记账、怎么一次写回所有改动过的那几份」，
 * 不是数据层怎么发请求，所以数据层与注册表都换成受控桩：断言的是这套状态算出来的
 * `files[].content` / `dirty` / `dirtyFilePaths`，以及 `saveAll` 到底提交了什么。
 */

// `vi.mock` 的工厂会被提升到文件顶部，桩数据与共享状态都得从这里出去。
const state = vi.hoisted(() => {
  // 两份文件：settings 承载模型，credentials 只放凭证（没有模型槽位）。
  const definition = {
    key: 'demo',
    name: 'Demo',
    order: 1,
    description: 'demo client',
    configDir: '~/.demo',
    files: [
      { path: '~/.demo/settings.json', format: 'json' },
      { path: '~/.demo/credentials.json', format: 'json' },
    ],
    fields: [
      { key: 'model', path: 'model', file: '~/.demo/settings.json', description: 'main model' },
    ],
  }
  // 磁盘上的原文。
  const baseContent: Record<string, string> = {
    '~/.demo/settings.json': '{\n  "model": "old"\n}\n',
    '~/.demo/credentials.json': '{\n  "token": "x"\n}\n',
  }
  // 把模型值写进去之后每份文件会变成什么样；credentials 没有模型字段，预览与原文一致。
  const previewContent: Record<string, string> = {
    '~/.demo/settings.json': '{\n  "model": "gpt"\n}\n',
    '~/.demo/credentials.json': '{\n  "token": "x"\n}\n',
  }
  return {
    definition,
    baseContent,
    previewContent,
    savePayload: null as { files: { filePath: string; content: string }[] } | null,
    mutated: { restore: 0 },
  }
})

const { baseContent, mutated } = state

type AgentClientFieldRef = { file?: string }
type SaveManyPayload = { files: { filePath: string; content: string }[] }
interface SaveManyOptions { onSuccess?: (result: unknown) => void }


vi.mock('@/catalog/clients', () => ({
  AGENT_CLIENT_DEFINITION_BY_KEY: { demo: state.definition },
}))

vi.mock('@common/clients', () => ({
  findAgentClientApplyConfig: (clientKey: string) => (clientKey === 'demo'
    ? { roles: { model: 'model' }, ignored: [] }
    : null),
  agentClientModelSlots: () => ['model'],
  agentClientFieldFile: (client: AgentClientDefinition, field: AgentClientFieldRef) => field.file ?? client.files[0].path,
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: () => {}, error: () => {} }),
}))

vi.mock('@/i18n/provider', () => ({ useTranslation: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }))

vi.mock('@/data/client-config', () => ({
  useClientConfigFiles: (_clientKey: string, filePaths: readonly string[]) => filePaths.map(filePath => ({
    filePath,
    state: {
      clientKey: 'demo',
      filePath,
      resolvedPath: filePath.replace('~', '/home/demo'),
      format: 'json',
      exists: true,
      content: state.baseContent[filePath] ?? '',
      contentHash: `hash-${state.baseContent[filePath] ?? ''}`,
      sizeBytes: (state.baseContent[filePath] ?? '').length,
      modifiedTime: 1700000000000,
      autoFill: 'ready',
      detected: { model: 'old' },
    } satisfies ClientConfigFileState,
    loading: false,
    error: null,
  })),
  useClientConfigVersions: () => [],
  useClientConfigVersionsLoading: () => false,
  useClientConfigActions: () => ({
    restore: { isPending: false, variables: undefined, mutate: () => { state.mutated.restore += 1 } },
    refresh: async () => {},
  }),
  useClientConfigPreviews: (_clientKey: string, filePaths: readonly string[], values: unknown) =>
    filePaths.map(filePath => (values
      ? ({ content: state.previewContent[filePath] ?? state.baseContent[filePath] ?? '', changes: [] } satisfies ClientConfigPreviewResult)
      : null)),
  useClientConfigSaveMany: () => ({
    isPending: false,
    mutate: (payload: SaveManyPayload, options?: SaveManyOptions) => {
      state.savePayload = payload
      options?.onSuccess?.({ saved: payload.files.map(file => ({ filePath: file.filePath, backedUp: null })), failed: [] })
    },
  }),
}))

import { useClientConfigEditor } from './use-client-config-editor'

beforeEach(() => {
  state.savePayload = null
  mutated.restore = 0
})

describe('useClientConfigEditor (multi-file)', () => {
  it('reads every file the client declares and opens the first one', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    const editor = result.current

    expect(editor.files.map(file => file.filePath)).toEqual(['~/.demo/settings.json', '~/.demo/credentials.json'])
    expect(editor.activeFilePath).toBe('~/.demo/settings.json')
    expect(editor.loading).toBe(false)
    expect(editor.error).toBeNull()
    // 一进来没有任何改动。
    expect(editor.dirtyFilePaths).toEqual([])
    expect(editor.files.every(file => file.dirty)).toBe(false)
  })

  it('switches the active file without touching drafts', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeContent('~/.demo/settings.json', 'dirty settings') })
    act(() => { result.current.selectFile('~/.demo/credentials.json') })

    expect(result.current.activeFilePath).toBe('~/.demo/credentials.json')
    // 切走只挪标签，改了一半的那份还在。
    expect(result.current.dirtyFilePaths).toEqual(['~/.demo/settings.json'])
  })

  it('tracks each edited file separately and reports only the dirty ones', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeContent('~/.demo/settings.json', 'settings v2') })
    act(() => { result.current.changeContent('~/.demo/credentials.json', 'credentials v2') })

    const settings = result.current.files.find(file => file.filePath === '~/.demo/settings.json')
    const credentials = result.current.files.find(file => file.filePath === '~/.demo/credentials.json')
    expect(settings?.content).toBe('settings v2')
    expect(settings?.dirty).toBe(true)
    expect(credentials?.content).toBe('credentials v2')
    expect(credentials?.dirty).toBe(true)
    expect(result.current.dirtyFilePaths).toEqual(['~/.demo/settings.json', '~/.demo/credentials.json'])
  })

  it('writes every dirty file on saveAll, and nothing else', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeContent('~/.demo/settings.json', 'settings v2') })
    act(() => { result.current.changeContent('~/.demo/credentials.json', 'credentials v2') })
    act(() => { result.current.saveAll() })

    expect(state.savePayload?.files).toEqual([
      { filePath: '~/.demo/settings.json', content: 'settings v2' },
      { filePath: '~/.demo/credentials.json', content: 'credentials v2' },
    ])
  })

  it('saves only the file that was actually touched', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeContent('~/.demo/credentials.json', 'credentials v2') })
    act(() => { result.current.saveAll() })

    expect(state.savePayload?.files).toEqual([{ filePath: '~/.demo/credentials.json', content: 'credentials v2' }])
  })

  it('does not call the save path when nothing changed', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.saveAll() })

    expect(state.savePayload).toBeNull()
  })

  it('discards only the file it was asked to, leaving the others dirty', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeContent('~/.demo/settings.json', 'settings v2') })
    act(() => { result.current.changeContent('~/.demo/credentials.json', 'credentials v2') })
    act(() => { result.current.discardFile('~/.demo/settings.json') })

    const settings = result.current.files.find(file => file.filePath === '~/.demo/settings.json')
    expect(settings?.content).toBe(baseContent['~/.demo/settings.json'])
    expect(settings?.dirty).toBe(false)
    expect(result.current.dirtyFilePaths).toEqual(['~/.demo/credentials.json'])
  })

  it('spreads a model choice across every file, and marks dirty only where the file changes', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))
    act(() => { result.current.changeValues({ model: 'gpt', smallModel: '' }) })

    expect(result.current.model).toBe('gpt')
    const settings = result.current.files.find(file => file.filePath === '~/.demo/settings.json')
    const credentials = result.current.files.find(file => file.filePath === '~/.demo/credentials.json')
    // 承载模型的 settings 变成预览里的内容，credentials 没有模型字段、预览与原文一致。
    expect(settings?.content).toBe('{\n  "model": "gpt"\n}\n')
    expect(settings?.dirty).toBe(true)
    expect(credentials?.content).toBe(baseContent['~/.demo/credentials.json'])
    expect(credentials?.dirty).toBe(false)
    expect(result.current.dirtyFilePaths).toEqual(['~/.demo/settings.json'])
  })

  it('exposes the file that carries the model as valuesFile', () => {
    const { result } = renderHook(() => useClientConfigEditor('demo'))

    expect(result.current.valuesFile?.filePath).toBe('~/.demo/settings.json')
    expect(result.current.configurable).toBe(true)
    expect(result.current.slots).toBe(1)
  })

  it('ignores a remembered file that does not belong to the current client', () => {
    const { result } = renderHook(() => useClientConfigEditor('unknown'))

    // 没登记的客户端没有文件，也没有可编的东西。
    expect(result.current.client).toBeUndefined()
    expect(result.current.files).toEqual([])
    expect(result.current.activeFilePath).toBe('')
    expect(result.current.valuesFile).toBeUndefined()
  })
})
