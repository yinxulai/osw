// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { RequestLogFilter } from '../service'
import { RequestLogsFilters } from './request-logs-filters'

/*
 * 请求日志的日期筛选。选择器交出的是含当天的本地零点，查询是
 * `createdTime < createdTimeTo`，所以上界必须是次日本地零点。
 * 夏令时切换日不是 24 小时，日界按日历日算。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const HOUR_MS = 60 * 60 * 1000

const EMPTY_FILTER: RequestLogFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  apiKeyId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

function renderFilters(filter: RequestLogFilter = EMPTY_FILTER) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  const applyFilter = vi.fn<(next: Partial<RequestLogFilter>) => void>()
  render(
    <I18nProvider>
      <RequestLogsFilters filter={filter} providerModelOptions={[]} apiKeys={[]} showApiKeyFilter total={0} applyFilter={applyFilter} />
    </I18nProvider>,
  )
  return applyFilter
}

function pickPreset(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: '按时间范围筛选' }))
  fireEvent.click(screen.getByRole('button', { name: label }))
}

/** 把「现在」钉在纽约的某一刻。调用方负责在结束后恢复时区。 */
function pinNewYork(year: number, monthIndex: number, day: number, hour: number) {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(year, monthIndex, day, hour))
}

describe('请求日志日期筛选的日界', () => {
  const previousTz = process.env.TZ

  afterEach(() => {
    vi.useRealTimers()
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })

  it('回拨日选「今天」包含当天最后一小时', () => {
    pinNewYork(2026, 10, 1, 12)
    expect(new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime()).toBe(25 * HOUR_MS)

    const applyFilter = renderFilters()
    pickPreset('今天')

    const from = new Date(2026, 10, 1).getTime()
    const exclusiveEnd = new Date(2026, 10, 2).getTime()
    expect(applyFilter).toHaveBeenCalledWith({ createdTimeFrom: from, createdTimeTo: exclusiveEnd })

    const late = new Date(2026, 10, 1, 23, 30).getTime()
    const next = applyFilter.mock.calls[0][0]
    expect(late).toBeGreaterThanOrEqual(next.createdTimeFrom ?? 0)
    expect(late).toBeLessThan(next.createdTimeTo ?? 0)
  })

  it('春令时日选「今天」不包含次日凌晨', () => {
    pinNewYork(2026, 2, 8, 12)
    expect(new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()).toBe(23 * HOUR_MS)

    const applyFilter = renderFilters()
    pickPreset('今天')

    const from = new Date(2026, 2, 8).getTime()
    const exclusiveEnd = new Date(2026, 2, 9).getTime()
    expect(applyFilter).toHaveBeenCalledWith({ createdTimeFrom: from, createdTimeTo: exclusiveEnd })

    const nextMorning = new Date(2026, 2, 9, 0, 30).getTime()
    const next = applyFilter.mock.calls[0][0]
    expect(nextMorning).toBeGreaterThanOrEqual(next.createdTimeTo ?? 0)
  })

  it('近 7 天跨春令时覆盖含首尾的 7 个日历日', () => {
    pinNewYork(2026, 2, 14, 12)
    const applyFilter = renderFilters()
    pickPreset('近 7 天')

    const from = new Date(2026, 2, 8).getTime()
    const exclusiveEnd = new Date(2026, 2, 15).getTime()
    expect(applyFilter).toHaveBeenCalledWith({ createdTimeFrom: from, createdTimeTo: exclusiveEnd })
    expect(new Date(2026, 2, 7, 12).getTime()).toBeLessThan(from)
  })

  it('春令时日的排他上界在选择器上仍显示当天', () => {
    process.env.TZ = 'America/New_York'
    expect(new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime()).toBe(23 * HOUR_MS)

    renderFilters({
      ...EMPTY_FILTER,
      createdTimeFrom: new Date(2026, 2, 8).getTime(),
      createdTimeTo: new Date(2026, 2, 9).getTime(),
    })

    const text = screen.getByRole('combobox', { name: '按时间范围筛选' }).textContent ?? ''
    expect(text).toContain('2026/03/08')
    expect(text).not.toContain('2026/03/07')
  })

  it('非切换日的「今天」仍是完整的 24 小时', () => {
    pinNewYork(2026, 0, 15, 12)
    const applyFilter = renderFilters()
    pickPreset('今天')

    const from = new Date(2026, 0, 15).getTime()
    const exclusiveEnd = new Date(2026, 0, 16).getTime()
    expect(applyFilter).toHaveBeenCalledWith({ createdTimeFrom: from, createdTimeTo: exclusiveEnd })
    expect(exclusiveEnd - from).toBe(24 * HOUR_MS)
  })
})
