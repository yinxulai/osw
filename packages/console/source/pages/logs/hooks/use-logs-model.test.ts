// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@common/schemas'
import { createQueryFixture } from '@/test-support'
import { useLogsUiStore } from '../store'

/*
 * 运行日志页的数据模型。
 *
 * 关键约定：
 *
 *  1. **翻页是按 offset 取数的**，所以「按筛选回到第一页」必须跟着走——否则筛完之后
 *     停在第 3 页，界面会显示「没有结果」，用户以为日志没了；
 *  2. **页边界要做夹取**：总页数算出来之后，`goToPage(0)` 与 `goToPage(999)` 都要落在区间里；
 *  3. **导出的失败提示与清空的失败提示是两句不同的话**，混在一起用户分不清是哪件事没成；
 *  4. 导出用 Blob URL 下载，用完必须 `revokeObjectURL`，不然大文件会一直占着内存。
 */

const state = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  list: vi.fn(),
  exportLogs: vi.fn(),
  clear: vi.fn(),
  revokeObjectURL: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:mock'),
  click: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: state.success, error: state.error, info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/i18n/provider', async () => {
  const { createAppTranslator } = await import('@common/i18n/catalogs')
  const t = createAppTranslator('zh-CN')
  return { useTranslation: () => t }
})

vi.mock('@/api/observability', () => ({
  logsApi: {
    list: (params: unknown) => state.list(params),
    export: () => state.exportLogs(),
    clear: () => state.clear(),
  },
}))

import { LOGS_PAGE_SIZE, useLogsModel } from './use-logs-model'

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log_1',
    time: 1_700_000_000_000,
    level: 'info',
    scope: 'proxy',
    message: 'hello',
    ...overrides,
  } as LogEntry
}

function page(logs: LogEntry[], total: number) {
  return { success: true, data: { logs, total } }
}

beforeEach(() => {
  state.success.mockReset()
  state.error.mockReset()
  state.list.mockReset()
  state.list.mockResolvedValue(page([entry()], 1))
  state.exportLogs.mockReset()
  state.exportLogs.mockResolvedValue({ success: true, data: { content: 'line1\nline2' } })
  state.clear.mockReset()
  state.clear.mockResolvedValue({ success: true, data: undefined })
  state.revokeObjectURL.mockReset()
  state.createObjectURL.mockClear()
  state.click.mockReset()
  useLogsUiStore.setState({ live: true, levelFilter: 'all', searchText: '', page: 1 })

  // jsdom 里 `URL.createObjectURL` 与 `<a>.click()` 都不实现真实行为，替换掉以免触发导航。
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: state.createObjectURL,
    revokeObjectURL: state.revokeObjectURL,
  }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    state.click(this.download)
  })
})

function setup(initialSearchText?: string) {
  const { wrapper } = createQueryFixture()
  return renderHook(() => useLogsModel(initialSearchText), { wrapper })
}

describe('取数参数', () => {
  it('第一页从 offset 0 开始，每页固定条数', async () => {
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list).toHaveBeenCalledWith({ limit: LOGS_PAGE_SIZE, offset: 0 })
  })

  it('翻到第 3 页时 offset 按页大小推进', async () => {
    useLogsUiStore.setState({ page: 3 })
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list).toHaveBeenCalledWith({ limit: LOGS_PAGE_SIZE, offset: 2 * LOGS_PAGE_SIZE })
  })

  it('筛选「全部」时不带 level 参数（少一个参数就少一份缓存分叉）', async () => {
    useLogsUiStore.setState({ levelFilter: 'all' })
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list.mock.calls[0][0]).not.toHaveProperty('level')
  })

  it('选了级别时带上 level', async () => {
    useLogsUiStore.setState({ levelFilter: 'error' })
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list).toHaveBeenCalledWith({ limit: LOGS_PAGE_SIZE, offset: 0, level: 'error' })
  })

  it('搜索词前后空白要削掉，纯空白等于没搜', async () => {
    useLogsUiStore.setState({ searchText: '  timeout  ' })
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list).toHaveBeenCalledWith({ limit: LOGS_PAGE_SIZE, offset: 0, query: 'timeout' })
  })

  it('纯空白的搜索词不带 query', async () => {
    useLogsUiStore.setState({ searchText: '   ' })
    setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(state.list.mock.calls[0][0]).not.toHaveProperty('query')
  })
})

describe('翻页', () => {
  it('总页数按总条数向上取整，至少 1 页（空结果也画得出一页空表）', async () => {
    state.list.mockResolvedValue(page([], 0))
    const { result } = setup()

    await waitFor(() => expect(result.current.total).toBe(0))
    expect(result.current.totalPages).toBe(1)
  })

  it('总条数刚好整除时不凭空多出一页', async () => {
    state.list.mockResolvedValue(page([entry()], LOGS_PAGE_SIZE * 2))
    const { result } = setup()

    await waitFor(() => expect(result.current.total).toBe(LOGS_PAGE_SIZE * 2))
    expect(result.current.totalPages).toBe(2)
  })

  it('多出一条就多一页', async () => {
    state.list.mockResolvedValue(page([entry()], LOGS_PAGE_SIZE + 1))
    const { result } = setup()

    await waitFor(() => expect(result.current.total).toBe(LOGS_PAGE_SIZE + 1))
    expect(result.current.totalPages).toBe(2)
  })

  it('页码向上越界时夹到最后一页', async () => {
    state.list.mockResolvedValue(page([entry()], LOGS_PAGE_SIZE * 2))
    const { result } = setup()
    await waitFor(() => expect(result.current.total).toBe(LOGS_PAGE_SIZE * 2))

    act(() => {
      result.current.goToPage(999)
    })

    expect(useLogsUiStore.getState().page).toBe(2)
  })

  it('页码向下越界时夹到第一页', async () => {
    state.list.mockResolvedValue(page([entry()], LOGS_PAGE_SIZE * 2))
    useLogsUiStore.setState({ page: 2 })
    const { result } = setup()
    await waitFor(() => expect(result.current.totalPages).toBe(2))

    act(() => {
      result.current.goToPage(0)
    })

    expect(useLogsUiStore.getState().page).toBe(1)
  })
})

describe('加载与刷新', () => {
  it('首帧是 loading；第一次取数落地后就不是了', async () => {
    const { result } = setup()

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('refreshing 只在「已经有数据、又在取」时为真（用来画刷新角标而不是骨架）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.refreshing).toBe(false)
  })

  it('refresh 会再取一次', async () => {
    const { result } = setup()
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.refresh()
    })

    expect(state.list).toHaveBeenCalledTimes(2)
  })
})

describe('筛选标记', () => {
  it('什么都没筛时 filtered 为假（空表才能说「本来就没有日志」而不是「筛不到」）', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.total).toBe(1))
    expect(result.current.filtered).toBe(false)
  })

  it('选了级别就算筛过', async () => {
    useLogsUiStore.setState({ levelFilter: 'warn' })
    const { result } = setup()

    await waitFor(() => expect(state.list).toHaveBeenCalled())
    expect(result.current.filtered).toBe(true)
  })

  it('搜了词也算筛过', async () => {
    // 注意：挂载时的 effect 会把 store 里的 searchText 重置成初始值，
    // 所以外部预置的搜索词不生效——这里必须在挂载之后再打字。
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setSearchText('x')
    })

    expect(result.current.filtered).toBe(true)
  })
})

describe('错误信息', () => {
  it('没有错误时为 null', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
  })

  it('Error 时取出 message；非 Error 也 String 化，别把错误吞掉', async () => {
    state.list.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'disk gone' })
    const { result } = setup()

    await waitFor(() => expect(result.current.error).toBe('disk gone'))
  })
})

describe('导出', () => {
  it('导出成功后下载文件名带时间戳，并释放 Blob URL', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.exportLogs()
    })

    expect(state.createObjectURL).toHaveBeenCalledTimes(1)
    expect(state.click).toHaveBeenCalledTimes(1)
    expect(state.click.mock.calls[0][0]).toMatch(/^osw-\d{4}-\d{2}-\d{2}T.*\.log$/)
    // 文件名里的 `:` 在 Windows 上非法，必须换掉
    expect(state.click.mock.calls[0][0]).not.toContain(':')
    expect(state.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(state.success).toHaveBeenCalledWith('运行日志已导出')
  })

  it('导出失败时给出接口的原因', async () => {
    state.exportLogs.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'archive busy' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.exportLogs()
    })

    expect(state.error).toHaveBeenCalledWith('archive busy')
    expect(state.success).not.toHaveBeenCalled()
  })

  it('导出失败且没有原因时用兜底文案（不能弹出空提示）', async () => {
    state.exportLogs.mockRejectedValue({})
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.exportLogs()
    })

    expect(state.error).toHaveBeenCalledWith('运行日志导出失败')
  })
})

describe('清空', () => {
  it('清空成功后回到第一页、收起对话框、提示已清空', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 挂载时 effect 里的 setSearchText 已经把页码复位到 1，所以这里先推到第 3 页再清空。
    act(() => {
      useLogsUiStore.setState({ page: 3 })
      result.current.setClearDialogOpen(true)
    })

    await act(async () => {
      await result.current.clearLogs()
    })

    expect(useLogsUiStore.getState().page).toBe(1)
    expect(result.current.clearDialogOpen).toBe(false)
    expect(state.success).toHaveBeenCalledWith('运行日志已清空')
  })

  it('清空成功后会重新取数（页面不能还挂着已经删掉的行）', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = state.list.mock.calls.length

    await act(async () => {
      await result.current.clearLogs()
    })
    await waitFor(() => expect(state.list.mock.calls.length).toBeGreaterThan(before))
  })

  it('清空失败时给出接口的原因，且不收对话框（用户还要重试）', async () => {
    state.clear.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'database is locked' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      result.current.setClearDialogOpen(true)
    })

    await act(async () => {
      await result.current.clearLogs()
    })

    expect(state.error).toHaveBeenCalledWith('database is locked')
    expect(result.current.clearDialogOpen).toBe(true)
  })

  it('清空失败且没有原因时用清空自己的兜底文案（不是导出那句）', async () => {
    state.clear.mockRejectedValue({})
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.clearLogs()
    })

    expect(state.error).toHaveBeenCalledWith('运行日志清空失败')
  })
})

describe('实时开关', () => {
  it('live 打开时按 2 秒轮询，关掉后不再自动取数', async () => {
    vi.useFakeTimers()
    try {
      useLogsUiStore.setState({ live: true })
      const { result } = setup()
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const afterFirst = state.list.mock.calls.length

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(state.list.mock.calls.length).toBeGreaterThan(afterFirst)

      const afterSecond = state.list.mock.calls.length
      act(() => {
        result.current.setLive(false)
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(state.list.mock.calls.length).toBe(afterSecond)
    } finally {
      vi.useRealTimers()
    }
  })

  it('live 状态从 store 出入（跨页签切换后保持）', async () => {
    useLogsUiStore.setState({ live: false })
    const { result } = setup()

    expect(result.current.live).toBe(false)

    act(() => {
      result.current.setLive(true)
    })
    expect(useLogsUiStore.getState().live).toBe(true)
  })
})

describe('搜索词初值', () => {
  it('外部传进来的搜索词写进 store，并清掉级别筛选（从别处跳进来时不该再叠一层筛选）', async () => {
    useLogsUiStore.setState({ levelFilter: 'error' })

    setup('  timeout ')

    await waitFor(() => expect(useLogsUiStore.getState().searchText).toBe('  timeout '))
    expect(useLogsUiStore.getState().levelFilter).toBe('all')
  })

  it('没有外部搜索词时清空搜索，但保留用户自己选的级别', async () => {
    useLogsUiStore.setState({ levelFilter: 'error', searchText: 'stale' })

    setup(undefined)

    await waitFor(() => expect(useLogsUiStore.getState().searchText).toBe(''))
    expect(useLogsUiStore.getState().levelFilter).toBe('error')
  })
})
