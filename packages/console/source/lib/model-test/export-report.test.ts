// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ModelTestTaskResult } from '@common/diagnostics'
import { createAppTranslator } from '@common/i18n/catalogs'
import { buildModelTestReport, downloadModelTestReport, type ModelTestReportFile } from './export-report'
import type { TestRow } from './tasks'

const t = createAppTranslator('en')
const zh = createAppTranslator('zh-CN')
const EXPORTED_AT = Date.UTC(2026, 10, 2, 8, 30, 5)

function result(overrides: Partial<ModelTestTaskResult> = {}): ModelTestTaskResult {
  return {
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: 'Example Channel',
    protocol: 'openai-completions',
    mode: 'streaming',
    success: false,
    statusCode: 429,
    durationMilliseconds: 1200,
    errorMessage: 'rate limited, retry later',
    rounds: [
      { round: 1, success: true, statusCode: 200, durationMilliseconds: 600, ttftMilliseconds: 120, tokensPerSecond: 8.5, outputTokens: 40, inputTokens: 100, cachedInputTokens: 25 },
      { round: 2, success: false, statusCode: 429, durationMilliseconds: 1800, errorMessage: 'rate limited, retry later' },
    ],
    ...overrides,
  }
}

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    id: 'v1:m1:openai-completions:streaming:1:0',
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: 'Example Channel',
    protocol: 'openai-completions',
    converted: false,
    status: 'failed',
    result: result(),
    enqueuedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_003_000,
    ...overrides,
  }
}

function reportLines(report: ModelTestReportFile): string[] {
  return report.text.replace(/^﻿/, '').split('\r\n').filter(Boolean)
}

describe('buildModelTestReport', () => {
  it('returns null when there is nothing to export', () => {
    expect(buildModelTestReport([], { exportedAt: EXPORTED_AT, t })).toBeNull()
  })

  it('uses a stable timestamped file name', () => {
    const report = buildModelTestReport([row()], { exportedAt: EXPORTED_AT, t })!
    expect(report.name).toBe('osw-channel-diagnostics-20261102T083005Z.csv')
  })

  it('writes one line per round with the task summary repeated', () => {
    const report = buildModelTestReport([row()], { exportedAt: EXPORTED_AT, t })!
    const lines = reportLines(report)
    expect(lines).toHaveLength(3)

    const header = lines[0].split(',')
    expect(header).toEqual([
      'Channel', 'Model', 'Protocol', 'Protocol converted', 'Diagnostic mode', 'Round', 'Status',
      'Round status', 'HTTP status', 'TTFT', 'TPS', 'Duration', 'Output tokens', 'Input tokens',
      'Cached input tokens', 'Rounds passed', 'Success rate', 'Error', 'Started at', 'Finished at',
      'Report range start', 'Report range end', 'Exported at',
    ])

    const first = lines[1].split(',')
    expect(first[0]).toBe('Example Channel')
    expect(first[1]).toBe('gpt-4o')
    expect(first[2]).toBe('OpenAI Completions')
    expect(first[3]).toBe('No')
    expect(first[4]).toBe('Streaming')
    expect(first[5]).toBe('1')
    expect(first[6]).toBe('Failed')
    expect(first[7]).toBe('Passed')
    expect(first[8]).toBe('200')
    expect(first[9]).toBe('120')
    expect(first[10]).toBe('8.5')
    expect(first[11]).toBe('600')
    expect(first[12]).toBe('40')
    expect(first[13]).toBe('100')
    expect(first[14]).toBe('25')
    expect(first[15]).toBe('1/2')
    expect(first[16]).toBe('50')
    expect(first[17]).toBe('')

    const failedRound = lines[2]
    expect(failedRound).toContain('"rate limited, retry later"')
  })

  it('includes queued rows as a bare status line instead of inventing metrics', () => {
    const queued: TestRow = {
      id: 'v1:m2:anthropic-messages:streaming:1:0',
      modelId: 'm2',
      modelName: 'claude',
      providerId: 'prov_1',
      providerName: 'Example Channel',
      protocol: 'anthropic-messages',
      converted: true,
      status: 'queued',
    }
    const report = buildModelTestReport([queued], { exportedAt: EXPORTED_AT, t })!
    const line = reportLines(report)[1].split(',')
    expect(line[0]).toBe('Example Channel')
    expect(line[1]).toBe('claude')
    expect(line[2]).toBe('Anthropic Messages')
    expect(line[3]).toBe('Yes')
    expect(line[6]).toBe('Queued')
    expect(line[7]).toBe('')
    expect(line[15]).toBe('')
    expect(line[18]).toBe('')
    expect(line[19]).toBe('')
  })

  it('derives the report time range from task timestamps and leaves it empty when absent', () => {
    const report = buildModelTestReport([row()], { exportedAt: EXPORTED_AT, t })!
    const first = reportLines(report)[1].split(',')
    expect(first[18]).toBe('2023-11-14T22:13:20.000Z')
    expect(first[19]).toBe('2023-11-14T22:13:23.000Z')
    expect(first[20]).toBe('2023-11-14T22:13:20.000Z')
    expect(first[21]).toBe('2023-11-14T22:13:23.000Z')
    expect(first[22]).toBe('2026-11-02T08:30:05.000Z')

    const withoutTimestamps = buildModelTestReport([row({ enqueuedAt: undefined, finishedAt: undefined })], { exportedAt: EXPORTED_AT, t })!
    const empty = reportLines(withoutTimestamps)[1].split(',')
    expect(empty[18]).toBe('')
    expect(empty[19]).toBe('')
    expect(empty[20]).toBe('')
    expect(empty[21]).toBe('')
  })

  it('never serializes credentials or arbitrary extra fields', () => {
    const leakyRow = {
      ...row(),
      apiKey: 'sk-live-should-not-appear',
      authorization: 'Bearer secret',
      result: { ...result(), apiKey: 'sk-inside-result', token: 'secret-token' },
    } as TestRow
    const text = buildModelTestReport([leakyRow], { exportedAt: EXPORTED_AT, t })!.text
    expect(text).not.toContain('sk-live-should-not-appear')
    expect(text).not.toContain('Bearer secret')
    expect(text).not.toContain('sk-inside-result')
    expect(text).not.toContain('secret-token')
  })

  it('quotes commas/quotes/newlines and neutralizes spreadsheet formulas in error text', () => {
    const formulaRow = row({
      errorMessage: '=HYPERLINK("https://evil.example", "x")\nnext line',
      result: result({
        errorMessage: '=HYPERLINK("https://evil.example", "x")\nnext line',
        rounds: undefined,
      }),
    })
    const quotedRow = row({
      result: result({
        rounds: [{ round: 1, success: false, statusCode: 500, durationMilliseconds: 10, errorMessage: 'a "quoted", message' }],
      }),
    })
    const report = buildModelTestReport([formulaRow, quotedRow], { exportedAt: EXPORTED_AT, t })!
    const text = report.text.replace(/^﻿/, '')
    expect(text).toContain("'=HYPERLINK")
    expect(text).toContain('"a ""quoted"", message"')
  })

  it('localizes headers and statuses through the catalog', () => {
    const report = buildModelTestReport([row()], { exportedAt: EXPORTED_AT, t: zh })!
    const lines = reportLines(report)
    expect(lines[0]).toContain('渠道')
    expect(lines[0]).toContain('导出时间')
    expect(lines[1]).toContain('失败')
    expect(lines[1]).toContain('流式诊断')
  })
})

describe('downloadModelTestReport', () => {
  it('creates and revokes an object URL and clicks an anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    vi.useFakeTimers()
    try {
      downloadModelTestReport({ name: 'report.csv', text: 'a,b' })
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(click).toHaveBeenCalledOnce()
      vi.runAllTimers()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    } finally {
      vi.useRealTimers()
      click.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
