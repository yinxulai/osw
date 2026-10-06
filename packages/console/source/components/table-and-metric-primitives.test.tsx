// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TableFrame, TableHeaderSurface, TablePager, TableViewport } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { FilterBar } from '@/components/filter-bar'
import { MetricGrid } from '@/components/metric-grid'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AlertCircle, Search } from 'lucide-react'

/*
 * 表格零件与筛选栏、指标格。
 *
 * 这里守的是「表格在什么情况下给人哪条出路」：分页条在首页/末页各自禁掉一个方向，
 * 空状态行跨满整行且带图标，筛选栏保留截图锚点。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

function wrap(children: React.ReactNode) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(
    <I18nProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>,
  )
}

describe('表格分页条', () => {
  it('用「第 X / Y 页」报数，两个方向各一个图标按钮', () => {
    wrap(<TablePager page={2} totalPages={5} onPageChange={vi.fn()} />)

    expect(screen.getByText('第 2 / 5 页')).toBeTruthy()
    expect(screen.getByLabelText('上一页')).toBeTruthy()
    expect(screen.getByLabelText('下一页')).toBeTruthy()
  })

  it('第一页禁掉「上一页」，末页禁掉「下一页」', () => {
    const { rerender } = wrap(<TablePager page={1} totalPages={3} onPageChange={vi.fn()} />)
    expect((screen.getByLabelText('上一页') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('下一页') as HTMLButtonElement).disabled).toBe(false)

    rerender(
      <I18nProvider>
        <TooltipProvider>
          <TablePager page={3} totalPages={3} onPageChange={vi.fn()} />
        </TooltipProvider>
      </I18nProvider>,
    )
    expect((screen.getByLabelText('上一页') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('下一页') as HTMLButtonElement).disabled).toBe(true)
  })

  it('只有一页时两个方向都禁用（不会点出越界的页）', () => {
    wrap(<TablePager page={1} totalPages={1} onPageChange={vi.fn()} />)

    expect((screen.getByLabelText('上一页') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('下一页') as HTMLButtonElement).disabled).toBe(true)
  })

  it('disabled 传入时整体锁死，即使页码允许翻页', () => {
    wrap(<TablePager page={2} totalPages={5} onPageChange={vi.fn()} disabled />)

    expect((screen.getByLabelText('上一页') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('下一页') as HTMLButtonElement).disabled).toBe(true)
  })

  it('点击回传目标页码（上一页 = page-1、下一页 = page+1）', () => {
    const onPageChange = vi.fn()
    wrap(<TablePager page={2} totalPages={5} onPageChange={onPageChange} />)

    fireEvent.click(screen.getByLabelText('上一页'))
    fireEvent.click(screen.getByLabelText('下一页'))

    expect(onPageChange).toHaveBeenCalledTimes(2)
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3)
  })

  it('禁用状态下点击不触发回调', () => {
    const onPageChange = vi.fn()
    wrap(<TablePager page={1} totalPages={1} onPageChange={onPageChange} />)

    fireEvent.click(screen.getByLabelText('上一页'))
    fireEvent.click(screen.getByLabelText('下一页'))

    expect(onPageChange).not.toHaveBeenCalled()
  })
})

describe('表格外壳', () => {
  it('外壳是圆角加边框（模块容器用边框圈出来）', () => {
    const { container } = wrap(<TableFrame>内容</TableFrame>)
    const frame = container.firstElementChild
    expect(frame?.className).toContain('border-module-border')
    expect(frame?.className).toContain('rounded-lg')
    expect(frame?.textContent).toBe('内容')
  })

  it('视口负责横向滚动（列多时不撑破卡片）', () => {
    const { container } = wrap(<TableViewport>内容</TableViewport>)
    expect(container.firstElementChild?.className).toContain('overflow-x-auto')
  })

  it('表头带底色与左对齐（数字列靠右由调用方覆盖）', () => {
    const { container } = wrap(<TableHeaderSurface>表头</TableHeaderSurface>)
    const header = container.firstElementChild
    expect(header?.className).toContain('text-left')
    expect(header?.className).toContain('bg-inset')
  })

  it('可以追加外部类名', () => {
    const { container } = wrap(<TableFrame className="mt-4">内容</TableFrame>)
    expect(container.firstElementChild?.className).toContain('mt-4')
  })
})

describe('表格状态行', () => {
  it('跨满指定列数（列数从 3 到 10 不等，靠调用方给）', () => {
    const { container } = wrap(
      <table>
        <tbody>
          <TableStateRow colSpan={7} icon={Search} title="没有匹配的记录" />
        </tbody>
      </table>,
    )

    expect(container.querySelector('td')?.getAttribute('colspan')).toBe('7')
  })

  it('默认是「中性」色调（读取不到数据不是错误）', () => {
    const { container } = wrap(
      <table>
        <tbody>
          <TableStateRow colSpan={3} icon={Search} title="暂无数据" description="换个时间范围" />
        </tbody>
      </table>,
    )

    const icon = container.querySelector('svg')
    expect(icon?.getAttribute('class')).toContain('text-text-quaternary')
    expect(screen.getByText('换个时间范围')).toBeTruthy()
  })

  it('destructive 色调同时改图标与标题颜色', () => {
    wrap(
      <table>
        <tbody>
          <TableStateRow colSpan={3} icon={AlertCircle} title="读取失败" tone="destructive" />
        </tbody>
      </table>,
    )

    const title = screen.getByText('读取失败')
    expect(title.className).toContain('text-text-destructive')
  })

  it('可以放一个操作按钮（空结果常常带一条出路）', () => {
    wrap(
      <table>
        <tbody>
          <TableStateRow colSpan={3} icon={Search} title="暂无数据" action={<button type="button">清空筛选</button>} />
        </tbody>
      </table>,
    )

    expect(screen.getByText('清空筛选')).toBeTruthy()
  })

  it('图标对读屏隐藏（标题已经说清楚了）', () => {
    const { container } = wrap(
      <table>
        <tbody>
          <TableStateRow colSpan={3} icon={Search} title="暂无数据" />
        </tbody>
      </table>,
    )

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('筛选栏', () => {
  it('截图锚点原样落到 DOM 上（局部取景靠它选中整条筛选栏）', () => {
    const { container } = wrap(<FilterBar dataScreenshot="request-logs-filters">控件</FilterBar>)

    expect(container.firstElementChild?.getAttribute('data-screenshot')).toBe('request-logs-filters')
  })

  it('不给锚点时该属性不渲染（不写一个空字符串）', () => {
    const { container } = wrap(<FilterBar>控件</FilterBar>)

    // React 对 `undefined` 的属性直接不输出，所以这里既不等于空串，也不是 `data-screenshot=""`。
    expect(container.firstElementChild?.hasAttribute('data-screenshot')).toBe(false)
  })

  it('换行排列（窄窗口下控件不掉出容器）', () => {
    const { container } = wrap(<FilterBar>控件</FilterBar>)
    expect(container.firstElementChild?.className).toContain('flex-wrap')
  })
})

describe('指标格', () => {
  it('每个指标一张卡，标签在上、数值在下（只有两行）', () => {
    const { container } = wrap(<MetricGrid items={[{ label: '请求数', value: 128 }]} />)

    expect(screen.getByText('请求数')).toBeTruthy()
    expect(screen.getByText('128')).toBeTruthy()
    // 卡片容器是表格化数字，避免数字跳动时抖动。
    expect(container.querySelector('.tabular-nums')).toBeTruthy()
  })

  it('带口径说明时标签行出现 info 图标，说明就是它的可访问名', () => {
    wrap(<MetricGrid items={[{ label: 'TTFT', value: '320 ms', info: '含 TTFT 的样本中位数' }]} />)

    expect(screen.getByLabelText('含 TTFT 的样本中位数')).toBeTruthy()
  })

  it('不带口径说明时标签行没有多余图标', () => {
    const { container } = wrap(<MetricGrid items={[{ label: '请求数', value: 1 }]} />)

    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('数值可以是节点（方便挂单位或涨跌色）', () => {
    wrap(<MetricGrid items={[{ label: '成功率', value: <span>99.8%</span> }]} />)

    expect(screen.getByText('99.8%')).toBeTruthy()
  })

  it('没有数据的指标用同一个格子加占位符，不换布局', () => {
    wrap(
      <MetricGrid
        items={[
          { label: '请求数', value: 12 },
          { label: '平均耗时', value: '—' },
        ]}
      />,
    )

    expect(screen.getByText('平均耗时')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('网格在窄屏两列、宽屏四列', () => {
    const { container } = wrap(<MetricGrid items={[{ label: '请求数', value: 1 }]} />)

    const grid = container.firstElementChild
    expect(grid?.className).toContain('grid-cols-2')
    expect(grid?.className).toContain('sm:grid-cols-4')
  })
})
