import type { ModelTestRoundResult } from '@common/diagnostics'
import type { ModelTestMode } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import type { Translator } from '@common/i18n'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { TestRow, TestRowStatus } from './tasks'
import { getResultRounds, getRoundSuccessRate } from './results'

export type ReportTranslator = Translator<UiCatalogKey>

export interface ModelTestReportFile {
  name: string
  text: string
}

const STATUS_LABEL_KEYS: Record<TestRowStatus, UiCatalogKey> = {
  queued: 'modelTest.status.queued',
  running: 'modelTest.status.running',
  success: 'modelTest.status.success',
  failed: 'modelTest.status.failed',
  cancelled: 'modelTest.status.cancelled',
}

const MODE_LABEL_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  streaming: 'modelTest.mode.streaming',
  speed: 'modelTest.mode.speed',
}

const REPORT_COLUMNS = [
  'channel', 'model', 'protocol', 'converted', 'mode', 'round', 'status', 'roundStatus',
  'httpStatus', 'ttft', 'tps', 'duration', 'outputTokens', 'inputTokens', 'cachedInputTokens',
  'roundsPassed', 'successRate', 'error', 'startedAt', 'finishedAt', 'reportRangeStart',
  'reportRangeEnd', 'exportedAt',
] as const

type ReportColumn = (typeof REPORT_COLUMNS)[number]

const COLUMN_KEYS: Record<ReportColumn, UiCatalogKey> = {
  channel: 'modelTest.report.column.channel',
  model: 'modelTest.report.column.model',
  protocol: 'modelTest.table.protocol',
  converted: 'modelTest.report.column.converted',
  mode: 'modelTest.mode.label',
  round: 'modelTest.detail.roundColumn',
  status: 'modelTest.table.status',
  roundStatus: 'modelTest.report.column.roundStatus',
  httpStatus: 'modelTest.detail.httpStatus',
  ttft: 'modelTest.detail.ttft',
  tps: 'modelTest.detail.tps',
  duration: 'modelTest.detail.duration',
  outputTokens: 'modelTest.detail.outputTokens',
  inputTokens: 'modelTest.report.column.inputTokens',
  cachedInputTokens: 'modelTest.report.column.cachedInputTokens',
  roundsPassed: 'modelTest.report.column.roundsPassed',
  successRate: 'modelTest.detail.successRate',
  error: 'modelTest.report.column.error',
  startedAt: 'modelTest.report.column.startedAt',
  finishedAt: 'modelTest.report.column.finishedAt',
  reportRangeStart: 'modelTest.report.column.reportRangeStart',
  reportRangeEnd: 'modelTest.report.column.reportRangeEnd',
  exportedAt: 'modelTest.report.column.exportedAt',
}

export interface ModelTestReportOptions {
  exportedAt: number
  t: ReportTranslator
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const text = String(value)
  // Prevent spreadsheet formula execution from untrusted upstream error text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function timestamp(value: number | undefined): string {
  if (value == null) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function fileTimestamp(value: number): string {
  return new Date(value).toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')
}

function reportFileName(exportedAt: number): string {
  return `osw-channel-diagnostics-${fileTimestamp(exportedAt)}.csv`
}

function roundStatusKey(round: ModelTestRoundResult): UiCatalogKey {
  return round.success ? STATUS_LABEL_KEYS.success : STATUS_LABEL_KEYS.failed
}

interface ReportRange {
  start: string
  end: string
}

function reportRange(rows: readonly TestRow[]): ReportRange {
  const starts = rows.map(row => row.enqueuedAt).filter((value): value is number => value != null)
  const ends = rows.map(row => row.finishedAt).filter((value): value is number => value != null)
  return {
    start: starts.length === 0 ? '' : timestamp(Math.min(...starts)),
    end: ends.length === 0 ? '' : timestamp(Math.max(...ends)),
  }
}

function taskRows(row: TestRow): readonly (ModelTestRoundResult | null)[] {
  const rounds = getResultRounds(row.result ?? { rounds: undefined })
  return rounds.length > 0 ? rounds : [null]
}

function reportRow(row: TestRow, round: ModelTestRoundResult | null, range: ReportRange, exportedAt: string, t: ReportTranslator): Record<ReportColumn, string | number> {
  const result = row.result
  const rounds = getResultRounds(result ?? { rounds: undefined })
  const successRate = result
    ? rounds.length > 0 ? getRoundSuccessRate(rounds) : result.success ? 100 : 0
    : ''
  const passed = rounds.filter(item => item.success).length
  const totalRounds = rounds.length > 0 ? rounds.length : ''
  const mode = result?.mode ?? row.progress?.mode
  const status = t(STATUS_LABEL_KEYS[row.status])
  const roundValues = round ? {
    round: round.round,
    roundStatus: t(roundStatusKey(round)),
    httpStatus: round.statusCode ?? '',
    ttft: round.ttftMilliseconds ?? '',
    tps: round.tokensPerSecond ?? '',
    duration: round.durationMilliseconds,
    outputTokens: round.outputTokens ?? '',
    inputTokens: round.inputTokens ?? '',
    cachedInputTokens: round.cachedInputTokens ?? '',
    error: round.errorMessage ?? (round.success ? '' : row.errorMessage ?? ''),
  } : {
    round: '',
    roundStatus: '',
    httpStatus: result?.statusCode ?? '',
    ttft: result?.ttftMilliseconds ?? '',
    tps: result?.tokensPerSecond ?? '',
    duration: result?.durationMilliseconds ?? '',
    outputTokens: result?.outputTokens ?? '',
    inputTokens: result?.inputTokens ?? '',
    cachedInputTokens: result?.cachedInputTokens ?? '',
    error: row.errorMessage ?? '',
  }
  return {
    channel: row.providerName,
    model: row.modelName,
    protocol: PROTOCOL_DISPLAY_NAMES[row.protocol],
    converted: row.converted ? t('common.state.yes') : t('common.state.no'),
    mode: mode ? t(MODE_LABEL_KEYS[mode]) : '',
    round: roundValues.round,
    status,
    roundStatus: roundValues.roundStatus,
    httpStatus: roundValues.httpStatus,
    ttft: roundValues.ttft,
    tps: roundValues.tps,
    duration: roundValues.duration,
    outputTokens: roundValues.outputTokens,
    inputTokens: roundValues.inputTokens,
    cachedInputTokens: roundValues.cachedInputTokens,
    roundsPassed: totalRounds === '' ? '' : `${passed}/${totalRounds}`,
    successRate: successRate === '' ? '' : successRate,
    error: roundValues.error,
    startedAt: timestamp(row.enqueuedAt),
    finishedAt: timestamp(row.finishedAt),
    reportRangeStart: range.start,
    reportRangeEnd: range.end,
    exportedAt,
  }
}

/** Build a whitelist-only CSV; no task key, provider id, credential, or raw result object is serialized. */
export function buildModelTestReport(rows: readonly TestRow[], options: ModelTestReportOptions): ModelTestReportFile | null {
  if (rows.length === 0) return null
  const range = reportRange(rows)
  const exportedAt = timestamp(options.exportedAt)
  const header = REPORT_COLUMNS.map(column => csvCell(options.t(COLUMN_KEYS[column] as UiCatalogKey))).join(',')
  const lines = [header]
  for (const row of rows) {
    for (const round of taskRows(row)) {
      const values = reportRow(row, round, range, exportedAt, options.t)
      lines.push(REPORT_COLUMNS.map(column => csvCell(values[column])).join(','))
    }
  }
  return { name: reportFileName(options.exportedAt), text: `﻿${lines.join('\r\n')}\r\n` }
}

/** Browser-only download side effect kept separate from the pure report builder. */
export function downloadModelTestReport(file: ModelTestReportFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
