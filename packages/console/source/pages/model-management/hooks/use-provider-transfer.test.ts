// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryFixture } from '@/test-support'
import { useProviderTransfer } from './use-provider-transfer'

/*
 * 供应商包导入导出。
 *
 * 这里要钉死的是「用户看到什么」而不是「调了几个接口」：
 *  - 导出前先问一句是否带上密钥，导出完成后开始下载并且提示里是**供应商名字**；
 *  - 导入是「同名整体覆盖」的破坏性操作，所以文件要先解析、预览，确认之后才提交；
 *  - 三种坏文件（不是 JSON、JSON 但不认识、JSON 认识但内容非法）各有各的说法，不能都吞成一句。
 */

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
  exportImpl: vi.fn(),
  importImpl: vi.fn(),
  downloaded: [] as { content: string; fileName: string }[],
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: state.success,
    error: state.error,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

// 文案走真的 zh-CN 目录，插值结果才测得出来（「已导出供应商"X"」里的名字）。
vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/providers', () => ({
  providerTransferApi: {
    export: async (input: unknown) => ({ success: true, data: await state.exportImpl(input) }),
    import: async (bundle: unknown) => ({ success: true, data: await state.importImpl(bundle) }),
  },
}))

/** 挡住真正落盘：jsdom 里 `URL.createObjectURL` 根本没实现，且落盘也不是被测对象。 */
function stubDownload() {
  state.downloaded = []
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  }))
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      state.downloaded.push({ content: '', fileName: this.download })
    })
  return click
}

function validBundle(name = 'Example') {
  return {
    format: 'osw/provider-bundle',
    version: 1,
    exportedAt: 1_700_000_000_000,
    providers: [{ name, models: [] }],
  }
}

function fileFrom(content: string, name = 'bundle.json'): File {
  return { name, text: async () => content } as unknown as File
}

/** 两个供应商的导出结果，用来验证「多个」时的文案与文件名。 */
function exportResult(names: string[]) {
  return {
    content: '{ "format": "osw/provider-bundle" }',
    bundle: { providers: names.map(name => ({ name })) },
  }
}

beforeEach(() => {
  state.success.mockClear()
  state.error.mockClear()
  state.exportImpl.mockReset()
  state.importImpl.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(reload = vi.fn(async () => undefined)) {
  const view = renderHook(() => useProviderTransfer({ reload }), {
    wrapper: createQueryFixture().wrapper,
  })
  return { ...view, reload }
}

describe('导出', () => {
  it('默认带上密钥', () => {
    const { result } = setup()
    expect(result.current.includeApiKeys).toBe(true)
  })

  it('没有打开导出对话框时确认是空操作', async () => {
    const click = stubDownload()
    const { result } = setup()

    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.exportImpl).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('单个供应商：把 id 传下去，文件名带供应商名，提示里也带名字', async () => {
    const click = stubDownload()
    state.exportImpl.mockResolvedValue(exportResult(['Example']))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'provider', provider: { id: 'prov_a', name: 'Example' } as never })
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.exportImpl).toHaveBeenCalledWith({ providerIds: ['prov_a'], includeApiKeys: true })
    expect(state.success).toHaveBeenCalledWith('已导出供应商“Example”')
    expect(click).toHaveBeenCalledTimes(1)
    expect(state.downloaded[0].fileName).toMatch(/^osw-provider-Example-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('全部导出：不带 id，文件名是合集，提示里是数量', async () => {
    stubDownload()
    state.exportImpl.mockResolvedValue(exportResult(['A', 'B']))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'all' })
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.exportImpl).toHaveBeenCalledWith({ providerIds: undefined, includeApiKeys: true })
    expect(state.success).toHaveBeenCalledWith('已导出 2 个供应商')
    expect(state.downloaded[0].fileName).toMatch(/^osw-providers-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('关掉「带上密钥」后请求里如实反映', async () => {
    stubDownload()
    state.exportImpl.mockResolvedValue(exportResult(['A']))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'all' })
      result.current.setIncludeApiKeys(false)
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.exportImpl).toHaveBeenCalledWith({ providerIds: undefined, includeApiKeys: false })
  })

  it('文件名里的非法字符被换掉，但中文保留', async () => {
    stubDownload()
    state.exportImpl.mockResolvedValue(exportResult(['我的供应商/主力']))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'all' })
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.downloaded[0].fileName).toContain('osw-provider-我的供应商_主力-')
  })

  it('导出成功后关掉对话框', async () => {
    stubDownload()
    state.exportImpl.mockResolvedValue(exportResult(['A']))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'all' })
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(result.current.exportScope).toBeNull()
  })

  it('导出失败：提示里带上真正的原因，不下载也不关对话框', async () => {
    const click = stubDownload()
    state.exportImpl.mockRejectedValue(new Error('磁盘不可写'))
    const { result } = setup()

    act(() => {
      result.current.openExportDialog({ kind: 'all' })
    })
    await act(async () => {
      await result.current.confirmExport()
    })

    expect(state.error).toHaveBeenCalledWith('导出失败：磁盘不可写')
    expect(state.success).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(result.current.exportScope).not.toBeNull()
  })
})

describe('导入', () => {
  it('合法文件先变成待确认的预览，不直接提交', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify(validBundle('Example')), 'my.json'))
    })

    expect(state.importImpl).not.toHaveBeenCalled()
    expect(result.current.pendingImport?.fileName).toBe('my.json')
    expect(result.current.pendingImport?.bundle.providers[0].name).toBe('Example')
  })

  it('内容不是 JSON 时给出「不是合法 JSON」', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom('{ not json'))
    })

    expect(state.error).toHaveBeenCalledWith('导入失败：文件内容不是合法的 JSON')
    expect(result.current.pendingImport).toBeNull()
  })

  it('是 JSON 但不是供应商包时给出「不可识别」', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify({ format: 'osw/other', version: 1, providers: [] })))
    })

    expect(state.error).toHaveBeenCalledWith('导入失败：这不是一个可识别的供应商导出文件')
    expect(result.current.pendingImport).toBeNull()
  })

  it('版本对不上（旧包/新包）同样拒绝，不会猜着读', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(
        fileFrom(JSON.stringify({ ...validBundle(), version: 2 })),
      )
    })

    expect(state.error).toHaveBeenCalledWith('导入失败：这不是一个可识别的供应商导出文件')
  })

  it('包是空的（没有任何供应商）也拒绝', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify({ ...validBundle(), providers: [] })))
    })

    expect(state.error).toHaveBeenCalledWith('导入失败：这不是一个可识别的供应商导出文件')
  })

  it('确认导入：提示导入数量，关掉预览并重新拉数据', async () => {
    state.importImpl.mockResolvedValue({ imported: { providers: 3, models: 8 } })
    const { result, reload } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify(validBundle())))
    })
    await act(async () => {
      await result.current.confirmImport()
    })

    expect(state.success).toHaveBeenCalledWith('已导入 3 个供应商 / 8 个供应商模型')
    expect(result.current.pendingImport).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('导入失败：提示原因，预览留着让用户能再试一次', async () => {
    state.importImpl.mockRejectedValue(new Error('同名供应商被占用'))
    const { result, reload } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify(validBundle())))
    })
    await act(async () => {
      await result.current.confirmImport()
    })

    expect(state.error).toHaveBeenCalledWith('导入失败：同名供应商被占用')
    expect(result.current.pendingImport).not.toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it('没有待确认的包时确认是空操作', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.confirmImport()
    })

    expect(state.importImpl).not.toHaveBeenCalled()
  })

  it('提交的是解析后的包体，而不是整个请求包装', async () => {
    state.importImpl.mockResolvedValue({ imported: { providers: 1, models: 0 } })
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify(validBundle('Example'))))
    })
    await act(async () => {
      await result.current.confirmImport()
    })

    const argument = state.importImpl.mock.calls[0][0] as { format: string }
    expect(argument.format).toBe('osw/provider-bundle')
  })
})

describe('对话框开关', () => {
  it('关掉导入预览会清空待确认的包', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.prepareImport(fileFrom(JSON.stringify(validBundle())))
    })
    act(() => {
      result.current.closeImportDialog()
    })

    await waitFor(() => expect(result.current.pendingImport).toBeNull())
  })

  it('点「选择文件」真的去点了隐藏的 input', () => {
    const click = vi.fn()
    const { result } = setup()
    // hook 内部持有 ref，这里模拟已经挂上了 DOM 节点。
    ;(result.current.fileInputRef as { current: HTMLInputElement | null }).current = {
      click,
    } as unknown as HTMLInputElement

    act(() => {
      result.current.openImportFilePicker()
    })

    expect(click).toHaveBeenCalledTimes(1)
  })
})
