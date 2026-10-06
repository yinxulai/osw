// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientConfigFileState, ClientConfigOverviewItem, ClientConfigVersionSummary } from '@common/client-config'
import type { ClientConfigApplyValues } from '@/api/client-config'
import {
  clientConfigKeys,
  useClientConfigActions,
  useClientConfigFiles,
  useClientConfigFill,
  useClientConfigGenerate,
  useClientConfigOverview,
  useClientConfigOverviewStatus,
  useClientConfigPreviews,
  useClientConfigSaveMany,
  useClientConfigVersions,
} from '@/data/client-config'
import { createQueryFixture } from '@/test-support'

/*
 * 客户端配置数据层盯的是三件容易写错的事：
 *
 * 1. **空路径不发请求**：客户端还没声明文件时 `useQueries` 里会有一堆空 key 的查询，
 *    `enabled` 没写就是一群打到服务端的空路径请求；
 * 2. **一份失败不拦下其余**：「保存全部」是逐文件写的，一份语法坏了不该让另外几份也写不进去；
 * 3. **值没改就不预览**：`values === null` 时每个文件的内容就是原文，发请求只是白等。
 */

function fileState(overrides: Partial<ClientConfigFileState> = {}): ClientConfigFileState {
  return {
    clientKey: 'claude-code',
    filePath: '~/.claude/settings.json',
    resolvedPath: 'C:\\Users\\me\\.claude\\settings.json',
    format: 'json',
    exists: true,
    content: '{}',
    contentHash: 'hash_current',
    sizeBytes: 2,
    modifiedTime: 1,
    autoFill: 'ready',
    detected: {},
    ...overrides,
  }
}

function overviewItem(overrides: Partial<ClientConfigOverviewItem> = {}): ClientConfigOverviewItem {
  return {
    clientKey: 'claude-code',
    filePath: '~/.claude/settings.json',
    resolvedPath: 'C:\\Users\\me\\.claude\\settings.json',
    format: 'json',
    exists: true,
    sizeBytes: 2,
    modifiedTime: 1,
    autoFill: 'ready',
    coverage: 'pending',
    pendingChanges: 2,
    versionCount: 3,
    lastVersionTime: 1,
    ...overrides,
  }
}

function versionSummary(overrides: Partial<ClientConfigVersionSummary> = {}): ClientConfigVersionSummary {
  return {
    id: 'ver_1',
    clientKey: 'claude-code',
    filePath: '~/.claude/settings.json',
    contentHash: 'hash_old',
    sizeBytes: 2,
    origin: 'manual',
    note: '',
    createdTime: 1,
    preview: '{}',
    ...overrides,
  }
}

const state = vi.hoisted(() => ({
  file: null as ClientConfigFileState | null,
  getFileCalls: [] as { clientKey: string; filePath: string }[],
  versions: [] as unknown[],
  versionCalls: 0,
  preview: null as { content: string; changes: unknown[] } | null,
  previewCalls: [] as { clientKey: string; filePath: string; model: string; smallModel?: string }[],
  saveCalls: [] as { filePath: string; content: string }[],
  saveFailurePaths: [] as string[],
  restoreCalls: [] as { filePath: string; id: string }[],
  overview: [] as ClientConfigOverviewItem[],
  overviewCalls: 0,
  fillCalls: [] as (string | undefined)[],
}))

vi.mock('@/api/client-config', () => ({
  clientConfigApi: {
    getFile: async (clientKey: string, filePath: string) => {
      state.getFileCalls.push({ clientKey, filePath })
      return { success: true, data: state.file }
    },
    listOverview: async () => {
      state.overviewCalls += 1
      return { success: true, data: state.overview }
    },
    fill: async (clientKey?: string) => {
      state.fillCalls.push(clientKey)
      return { success: true, data: [] }
    },
    preview: async (clientKey: string, filePath: string, values: ClientConfigApplyValues) => {
      state.previewCalls.push({ clientKey, filePath, ...values })
      return { success: true, data: state.preview }
    },
    save: async (_clientKey: string, filePath: string, content: string) => {
      state.saveCalls.push({ filePath, content })
      if (state.saveFailurePaths.includes(filePath)) {
        return { success: false, errorCode: 'CLIENT_CONFIG_WRITE_FAILED', errorMessage: 'write failed' }
      }
      return { success: true, data: { state: fileState({ content }), backedUp: null } }
    },
    listVersions: async () => {
      state.versionCalls += 1
      return { success: true, data: state.versions }
    },
    restoreVersion: async (_clientKey: string, filePath: string, id: string) => {
      state.restoreCalls.push({ filePath, id })
      return { success: true, data: { state: fileState(), backedUp: null } }
    },
  },
}))

beforeEach(() => {
  state.file = null
  state.getFileCalls = []
  state.versions = []
  state.versionCalls = 0
  state.preview = null
  state.previewCalls = []
  state.saveCalls = []
  state.saveFailurePaths = []
  state.restoreCalls = []
  state.overview = []
  state.overviewCalls = 0
  state.fillCalls = []
})

describe('useClientConfigFiles', () => {
  it('每个路径一条，顺序与传入一致', async () => {
    state.file = fileState()
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useClientConfigFiles('claude-code', ['~/.claude/a.json', '~/.claude/b.json']), { wrapper })

    await waitFor(() => expect(result.current.every(entry => entry.state !== null)).toBe(true))
    expect(result.current.map(entry => entry.filePath)).toEqual(['~/.claude/a.json', '~/.claude/b.json'])
  })

  it('路径为空时不发请求，但仍然按同一套形状给出条目', () => {
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useClientConfigFiles('', ['~/.claude/a.json']), { wrapper })

    // 布局不随数据有无而变：条目照样在，只是状态还是「不知道」。
    expect(result.current).toHaveLength(1)
    expect(result.current[0].state).toBeNull()
    expect(result.current[0].loading).toBe(true)
    expect(state.getFileCalls).toEqual([])
  })
})

describe('useClientConfigVersions', () => {
  it('拿到版本列表；没配客户端时是空数组且不发请求', async () => {
    state.versions = [versionSummary()]
    const { wrapper } = createQueryFixture()
    const mounted = renderHook(() => useClientConfigVersions('claude-code', '~/.claude/settings.json'), { wrapper })
    await waitFor(() => expect(mounted.result.current).toHaveLength(1))

    const idle = renderHook(() => useClientConfigVersions('', ''), { wrapper })
    expect(idle.result.current).toEqual([])
    expect(state.versionCalls).toBe(1)
  })
})

describe('useClientConfigActions', () => {
  it('restore 之后同时失效文件、版本与概览：三者一定一起变了', async () => {
    const { wrapper } = createQueryFixture()
    // 三个查询都挂上观察者，失效才会真的重新取一次——没观察者的查询只是被标记，不会重取。
    const files = renderHook(() => useClientConfigFiles('claude-code', ['~/.claude/settings.json']), { wrapper })
    const versions = renderHook(() => useClientConfigVersions('claude-code', '~/.claude/settings.json'), { wrapper })
    const overview = renderHook(() => useClientConfigOverviewStatus(), { wrapper })
    await waitFor(() => expect(files.result.current[0].loading).toBe(false))
    await waitFor(() => expect(versions.result.current).toEqual([]))
    await waitFor(() => expect(overview.result.current.loading).toBe(false))
    const before = { files: state.getFileCalls.length, versions: state.versionCalls, overview: state.overviewCalls }

    const actions = renderHook(() => useClientConfigActions('claude-code', '~/.claude/settings.json'), { wrapper })
    await act(async () => actions.result.current.restore.mutateAsync({ id: 'ver_1' }))

    expect(state.restoreCalls).toEqual([{ filePath: '~/.claude/settings.json', id: 'ver_1' }])
    await waitFor(() => expect(state.getFileCalls.length).toBe(before.files + 1))
    expect(state.versionCalls).toBe(before.versions + 1)
    expect(state.overviewCalls).toBe(before.overview + 1)
  })
})

describe('useClientConfigSaveMany', () => {
  it('一份失败不拦下其余：好的写进去，坏的单独点名', async () => {
    state.saveFailurePaths = ['~/.claude/broken.json']
    const { wrapper } = createQueryFixture()
    const save = renderHook(() => useClientConfigSaveMany('claude-code'), { wrapper })

    const result = await act(async () =>
      save.result.current.mutateAsync({
        files: [
          { filePath: '~/.claude/good.json', content: '{"ok":true}' },
          { filePath: '~/.claude/broken.json', content: 'not json' },
          { filePath: '~/.claude/also-good.json', content: '{}' },
        ],
      }),
    )

    expect(state.saveCalls.map(call => call.filePath)).toEqual(['~/.claude/good.json', '~/.claude/broken.json', '~/.claude/also-good.json'])
    expect(result?.saved.map(entry => entry.filePath)).toEqual(['~/.claude/good.json', '~/.claude/also-good.json'])
    expect(result?.failed.map(entry => entry.filePath)).toEqual(['~/.claude/broken.json'])
    expect(result?.failed[0].message).not.toBe('')
  })

  it('全部成功时失败列表为空', async () => {
    const { wrapper } = createQueryFixture()
    const save = renderHook(() => useClientConfigSaveMany('claude-code'), { wrapper })

    const result = await act(async () =>
      save.result.current.mutateAsync({ files: [{ filePath: '~/.claude/a.json', content: '{}' }] }),
    )

    expect(result?.failed).toEqual([])
    expect(result?.saved).toHaveLength(1)
  })
})

describe('useClientConfigPreviews', () => {
  it('值没被改动时不发请求：那时每个文件的内容就是原文', () => {
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useClientConfigPreviews('claude-code', ['~/.claude/settings.json'], null), { wrapper })

    expect(result.current).toEqual([null])
    expect(state.previewCalls).toEqual([])
  })

  it('改动之后每个文件各问一次，键里带上两个模型值', async () => {
    state.preview = { content: '{"model":"gpt-5"}', changes: [] }
    const { client, wrapper } = createQueryFixture()
    const { result } = renderHook(
      () => useClientConfigPreviews('claude-code', ['~/.claude/a.json', '~/.claude/b.json'], { model: 'gpt-5', smallModel: 'gpt-5-mini' }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.every(entry => entry !== null)).toBe(true))
    expect(state.previewCalls).toEqual([
      { clientKey: 'claude-code', filePath: '~/.claude/a.json', model: 'gpt-5', smallModel: 'gpt-5-mini' },
      { clientKey: 'claude-code', filePath: '~/.claude/b.json', model: 'gpt-5', smallModel: 'gpt-5-mini' },
    ])
    // 键带上两值：换了模型就是另一份预览，不能复用上一份。
    expect(client.getQueryData(clientConfigKeys.preview('claude-code', '~/.claude/a.json', 'gpt-5', 'gpt-5-mini'))).not.toBeUndefined()
  })

  it('只填主模型时，请求里不带小模型，缓存键用空串占位', async () => {
    state.preview = { content: '{}', changes: [] }
    const { client, wrapper } = createQueryFixture()
    renderHook(() => useClientConfigPreviews('claude-code', ['~/.claude/a.json'], { model: 'gpt-5' }), { wrapper })

    await waitFor(() => expect(state.previewCalls).toHaveLength(1))
    // 请求体里省略：服务端按「没指定小模型」处理，而不是收到一个空名字去查。
    expect(state.previewCalls[0].smallModel).toBeUndefined()
    // 键位仍然齐整：'主模型 + 未指定小模型' 是它自己的一格，不会和别的组合撞在一起。
    expect(client.getQueryData(clientConfigKeys.preview('claude-code', '~/.claude/a.json', 'gpt-5', ''))).not.toBeUndefined()
  })
})

describe('useClientConfigGenerate', () => {
  it('只算不写：每份文件都问一次预览，但一个字节都不落盘', async () => {
    state.preview = { content: '{"model":"gpt-5"}', changes: [] }
    const { wrapper } = createQueryFixture()
    const generate = renderHook(() => useClientConfigGenerate('claude-code'), { wrapper })

    const generated = await act(async () =>
      generate.result.current.mutateAsync({ filePaths: ['~/.claude/a.json', '~/.claude/b.json'], model: 'gpt-5' }),
    )

    expect(generated).toEqual([
      { filePath: '~/.claude/a.json', content: '{"model":"gpt-5"}' },
      { filePath: '~/.claude/b.json', content: '{"model":"gpt-5"}' },
    ])
    expect(state.saveCalls).toEqual([])
  })
})

describe('useClientConfigOverview', () => {
  it('给出每个客户端的状态行；没数据时是空数组', async () => {
    state.overview = [overviewItem({ clientKey: 'codex', coverage: 'applied', pendingChanges: 0 })]
    const { wrapper } = createQueryFixture()
    const { result } = renderHook(() => useClientConfigOverview(), { wrapper })

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current[0].clientKey).toBe('codex')
    expect(result.current[0].pendingChanges).toBe(0)
  })

  it('加载态与错误态出自同一次查询', async () => {
    const { wrapper } = createQueryFixture()
    const status = renderHook(() => useClientConfigOverviewStatus(), { wrapper })

    await waitFor(() => expect(status.result.current.loading).toBe(false))
    expect(status.result.current.error).toBeNull()
    expect(state.overviewCalls).toBe(1)
  })
})

describe('useClientConfigFill', () => {
  it('不带 clientKey 就是全部客户端，并让概览重新取一次', async () => {
    const { wrapper } = createQueryFixture()
    const overview = renderHook(() => useClientConfigOverview(), { wrapper })
    await waitFor(() => expect(state.overviewCalls).toBe(1))

    const fill = renderHook(() => useClientConfigFill(), { wrapper })
    await act(async () => fill.result.current.mutateAsync({}))

    expect(state.fillCalls).toEqual([undefined])
    // 整个 client-config 命名空间被失效：概览说的就是「现在对不对」，填完必然变。
    await waitFor(() => expect(state.overviewCalls).toBe(2))
  })

  it('带上 clientKey 只填这一个', async () => {
    const { wrapper } = createQueryFixture()
    const fill = renderHook(() => useClientConfigFill(), { wrapper })

    await act(async () => fill.result.current.mutateAsync({ clientKey: 'claude-code' }))

    expect(state.fillCalls).toEqual(['claude-code'])
  })
})
