// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { LogEntry } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { useLogsUiStore } from './store'
import { LogsTable } from './components/logs-table'
import { LogsToolbar } from './components/logs-toolbar'

/*
 * 运行日志页的三块拼装件：UI 状态、表格、工具栏。
 *
 * 这三份都是「把 props 画出来」的纯展示件，唯一值得钉住的是几个**分支口径**：
 * 加载中优先于错误、错误只在列表为空时出现（有数据就别把错误糊在数据上）、
 * 筛选后的空态与从没有过日志的空态是两句不同的话，以及那些「没数据就不该能点」的按钮。
 *
 * 时间戳用的是 `Intl.DateTimeFormat`，断言只比「和同一个 formatter 算出来的一致」，
 * 不硬编码时区。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

function log(overrides: Partial<LogEntry> = {}): LogEntry {
  return { id: 'log_1', level: 'info', message: 'hello', timestamp: 1_700_000_000_000, ...overrides }
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  useLogsUiStore.setState({ live: true, levelFilter: 'all', searchText: '', page: 1 })
})

describe('运行日志页的界面状态', () => {
  it('默认跟随实时、全部级别、第一页', () => {
    expect(useLogsUiStore.getState()).toMatchObject({ live: true, levelFilter: 'all', searchText: '', page: 1 })
  })

  it('改级别 / 搜索词都会退回第一页（旧页码在新结果里没有意义）', () => {
    useLogsUiStore.getState().setPage(7)
    useLogsUiStore.getState().setLevelFilter('error')
    expect(useLogsUiStore.getState()).toMatchObject({ levelFilter: 'error', page: 1 })

    useLogsUiStore.getState().setPage(3)
    useLogsUiStore.getState().setSearchText('boom')
    expect(useLogsUiStore.getState()).toMatchObject({ searchText: 'boom', page: 1 })
  })

  it('翻页单独改页码，不影响筛选', () => {
    useLogsUiStore.getState().setLevelFilter('warn')
    useLogsUiStore.getState().setPage(2)
    expect(useLogsUiStore.getState()).toMatchObject({ levelFilter: 'warn', page: 2 })
  })

  it('setLive 同时接受值和更新函数', () => {
    useLogsUiStore.getState().setLive(false)
    expect(useLogsUiStore.getState().live).toBe(false)

    useLogsUiStore.getState().setLive(current => !current)
    expect(useLogsUiStore.getState().live).toBe(true)
  })
})

describe('日志表格', () => {
  function renderTable(overrides: Partial<Parameters<typeof LogsTable>[0]> = {}) {
    const onRetry = vi.fn()
    render(
      <LogsTable logs={[]} loading={false} error={null} filtered={false} onRetry={onRetry} {...overrides} />,
      { wrapper: Wrapper },
    )
    return { onRetry }
  }

  it('表头就是时间 / 级别 / 消息三列', () => {
    renderTable()
    expect(screen.getByText('时间')).toBeTruthy()
    expect(screen.getByText('级别')).toBeTruthy()
    expect(screen.getByText('消息')).toBeTruthy()
  })

  it('加载中渲染骨架行，而不是空态（避免闪一下「还没有日志」）', () => {
    renderTable({ loading: true })
    expect(screen.queryByText('还没有运行日志')).toBeNull()
    // 10 行 × 3 个单元格。
    expect(document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0)
    const rows = document.querySelectorAll('tbody tr')
    expect(rows.length).toBe(10)
  })

  it('报错且没有数据时给错误行与重试按钮', () => {
    const { onRetry } = renderTable({ error: '断网了' })
    expect(screen.getByText('运行日志读取失败')).toBeTruthy()
    expect(screen.getByText('断网了')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('有数据时错误不覆盖数据（错误另有出口，表格照常画）', () => {
    renderTable({ error: '断网了', logs: [log({ message: '仍然在的日志' })] })
    expect(screen.getByText('仍然在的日志')).toBeTruthy()
    expect(screen.queryByText('运行日志读取失败')).toBeNull()
  })

  it('筛选筛空与从没有过日志是两句不同的话', () => {
    renderTable({ filtered: true })
    expect(screen.getByText('没有匹配的运行日志')).toBeTruthy()
    expect(screen.queryByText('还没有运行日志')).toBeNull()

    renderTable()
    expect(screen.getByText('还没有运行日志')).toBeTruthy()
  })

  it('每条日志画成一行：级别写成大写标签、消息原样、时间不空', () => {
    renderTable({
      logs: [
        log({ id: 'a', level: 'warn', message: '慢请求', timestamp: 1_700_000_000_000 }),
        log({ id: 'b', level: 'debug', message: '细节' }),
      ],
    })

    expect(screen.getByText('WARN')).toBeTruthy()
    expect(screen.getByText('DEBUG')).toBeTruthy()
    expect(screen.getByText('慢请求')).toBeTruthy()
    expect(screen.getByText('细节')).toBeTruthy()

    const expected = new Intl.DateTimeFormat('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    }).format(1_700_000_000_000)
    // 两条日志落在毫秒级精度下有可能是同一个时刻，所以按集合比。
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('加载中优先于错误（两者同时为真时画骨架）', () => {
    renderTable({ loading: true, error: '断网了' })
    expect(screen.queryByText('运行日志读取失败')).toBeNull()
  })
})

describe('日志工具栏', () => {
  function renderToolbar(overrides: Partial<Parameters<typeof LogsToolbar>[0]> = {}) {
    const handlers = {
      onLiveChange: vi.fn(),
      onRefresh: vi.fn(),
      onExport: vi.fn(),
      onClear: vi.fn(),
      onDialogChange: vi.fn(),
      onLevelChange: vi.fn(),
      onSearchChange: vi.fn(),
    }
    render(
      <LogsToolbar
        total={0}
        live
        refreshing={false}
        levelFilter="all"
        searchText=""
        clearDialogOpen={false}
        {...handlers}
        {...overrides}
      />,
      { wrapper: Wrapper },
    )
    return handlers
  }

  it('搜索框把输入原样交出去', () => {
    const handlers = renderToolbar()
    fireEvent.change(screen.getByLabelText('搜索日志内容'), { target: { value: 'timeout' } })
    expect(handlers.onSearchChange).toHaveBeenCalledWith('timeout')
  })

  it('显示总条数', () => {
    renderToolbar({ total: 42 })
    expect(screen.getByText('共 42 条')).toBeTruthy()
  })

  it('实时 / 暂停两侧的文案与按钮互相对上', () => {
    const handlers = renderToolbar({ live: true })
    expect(screen.getByText('实时更新')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /暂停/ }))
    expect(handlers.onLiveChange).toHaveBeenCalledTimes(1)

    renderToolbar({ live: false })
    expect(screen.getByText('已暂停')).toBeTruthy()
    expect(screen.getByRole('button', { name: /继续/ })).toBeTruthy()
  })

  it('刷新时按钮禁用（正在刷就别再点一次）', () => {
    renderToolbar({ refreshing: true })
    const refresh = screen.getByRole('button', { name: '刷新日志' }) as HTMLButtonElement
    expect(refresh.disabled).toBe(true)

    renderToolbar({ refreshing: false })
    expect((screen.getAllByRole('button', { name: '刷新日志' })[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('没有日志时清空按钮禁用（没东西可清）', () => {
    renderToolbar({ total: 0 })
    expect((screen.getByRole('button', { name: '清空日志' }) as HTMLButtonElement).disabled).toBe(true)

    renderToolbar({ total: 3 })
    expect((screen.getAllByRole('button', { name: '清空日志' })[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('导出按钮不随条数禁用', () => {
    const handlers = renderToolbar({ total: 0 })
    fireEvent.click(screen.getByRole('button', { name: '导出日志' }))
    expect(handlers.onExport).toHaveBeenCalledTimes(1)
  })

  it('清空要先弹确认框，点了确认才回调', async () => {
    const first = renderToolbar({ total: 5 })
    fireEvent.click(screen.getByRole('button', { name: '清空日志' }))
    expect(first.onDialogChange).toHaveBeenCalledWith(true)

    // 弹窗由外部 `clearDialogOpen` 控制；它不自己关自己。
    cleanup()
    const second = renderToolbar({ total: 5, clearDialogOpen: true })
    // 确认按钮与工具栏那个图标按钮同名，必须在弹窗里取。
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('清空运行日志？')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '清空日志' }))
    await waitFor(() => expect(second.onClear).toHaveBeenCalled())
  })

  it('取消弹窗不上报确认', async () => {
    const handlers = renderToolbar({ total: 5, clearDialogOpen: true })
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(handlers.onClear).not.toHaveBeenCalled()
    // 取消要告诉外部把弹窗关掉。
    await waitFor(() => expect(handlers.onDialogChange).toHaveBeenCalledWith(false))
  })
})
