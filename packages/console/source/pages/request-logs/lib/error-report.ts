/**
 * 把一次失败的尝试整理成一份可以直接发给供应商的报告。
 *
 * 供应商跟进时真正需要的不是一张截图，而是**能对上账的原文**：哪一次尝试、请求的是什么
 * （改写与协议转换之后的 headers / body）、上游回了什么、错误码与错误信息、以及本地的耗时口径。
 * 这些内容本来就在库里逐列存着，缺的只是一个把它们装进同一个文件的动作。
 *
 * 因此这里只做「编排」，不做任何再加工：正文按 `prettyRequestBody` 重排（只改排版，内容一字不改），
 * 头本来就是脱敏后的 JSON 原样。缺失的部分显式写成「未采集」，而不是悄悄留白——
 * 供应商看不到的字段，正是需要回来问我们的字段。
 */

import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'
import { factsOf, formatCreatedTime, protocolLabel } from './contents'
import { prettyRequestBody, sanitizeFileSegment } from './request-body-download'

export interface ErrorReportInput {
  t: AppTranslator
  /** 界面语言，用来格式化生成时间。 */
  locale: string
  requestId: string
  /** 失败的那次尝试。 */
  attempt: RequestLogEntryAttempt
  /** 客户端协议；`null` 表示这次请求连 API 路径都未识别。 */
  clientProtocol: string | null
  /** 该尝试的上游视角正文；`null` 表示没有这一行（没采到，或已被保留策略清理）。 */
  attemptContent: AttemptContent | null
  /** 客户端视角正文；每个请求至多一行。 */
  clientContent: RequestContent | null
  /**
   * 这次尝试是否就是把响应写回客户端的那一次。
   *
   * 为假时「返回客户端的响应」根本不属于它（那时客户端拿到的是另一次尝试的结果，
   * 甚至是代理合成的 502），把它写进报告只会让供应商以为那是自己回的。
   */
  servesClient: boolean
  /** 生成时间。由调用方传入，报告才可测。 */
  generatedTime: number
}

export interface ReportFile {
  name: string
  text: string
}

interface ReportBlock {
  label: string
  value: string | null
}

/** 正文块：统一用无语言标记的围栏，SSE 与 JSON 都不会被错误地着色或转义。 */
function appendBlock(lines: string[], block: ReportBlock, t: AppTranslator): void {
  lines.push(`### ${block.label}`, '')
  if (block.value === null || block.value === '') {
    lines.push(t('requestLogs.contents.errorReport.notCaptured'), '')
    return
  }
  lines.push('```', prettyRequestBody(block.value), '```', '')
}

function appendSection(lines: string[], t: AppTranslator, title: string, meta: string[], blocks: ReportBlock[]): void {
  lines.push(`## ${title}`, '')
  for (const line of meta) lines.push(line)
  if (meta.length > 0) lines.push('')
  for (const block of blocks) appendBlock(lines, block, t)
}

/**
 * 生成报告。
 *
 * 顺序就是供应商复现的顺序：先给结论（错误码、错误信息、耗时），再给发出去的请求，
 * 然后是上游回的响应；客户端那两份放在最后，只在需要判断「谁的责任」时才看。
 */
export function buildErrorReport(input: ErrorReportInput): ReportFile {
  const { t, locale, attempt, attemptContent, clientContent, servesClient } = input
  const lines: string[] = []

  lines.push(`# ${t('requestLogs.contents.errorReport.title')}`, '')
  lines.push(`${t('requestLogs.contents.errorReport.generatedAt')}: ${formatCreatedTime(locale, input.generatedTime)}`)
  lines.push(`${t('requestLogs.detail.requestId')}: ${input.requestId}`, '')

  // 事实清单已经是排障第一屏的内容（结果、错误码、错误信息、上游地址、时间），
  // 报告只是把它原样带上，不另写一套措辞。
  lines.push(`## ${t('requestLogs.contents.attemptFacts.title')}`, '')
  for (const fact of factsOf(t, locale, attempt)) lines.push(`- ${fact.label}: ${fact.value}`)
  lines.push('')

  const clientLabel = protocolLabel(t, input.clientProtocol)
  const upstreamLabel = protocolLabel(t, attempt.upstreamProtocol)
  const upstreamStatus = attemptContent === null
    ? t('requestLogs.contents.errorReport.notCaptured')
    : attemptContent.responseStatus === null
      ? t('requestLogs.contents.status.upstreamNoResponse')
      : `HTTP ${attemptContent.responseStatus}`

  appendSection(lines, t, t('requestLogs.contents.stage.upstreamRequest'), [attempt.url], [
    { label: t('requestLogs.contents.section.requestHeader', { protocol: upstreamLabel }), value: attemptContent?.requestHeaders ?? null },
    { label: t('requestLogs.contents.section.requestBody', { protocol: upstreamLabel }), value: attemptContent?.requestBody ?? null },
  ])

  appendSection(lines, t, t('requestLogs.contents.stage.upstreamResponse'), [upstreamStatus], [
    { label: t('requestLogs.contents.section.responseHeader', { protocol: upstreamLabel }), value: attemptContent?.responseHeaders ?? null },
    { label: t('requestLogs.contents.section.responseBody', { protocol: upstreamLabel }), value: attemptContent?.responseBody ?? null },
  ])

  appendSection(lines, t, t('requestLogs.contents.stage.clientRequest'), [], [
    { label: t('requestLogs.contents.section.requestHeader', { protocol: clientLabel }), value: clientContent?.requestHeaders ?? null },
    { label: t('requestLogs.contents.section.requestBody', { protocol: clientLabel }), value: clientContent?.requestBody ?? null },
  ])

  if (servesClient) {
    appendSection(lines, t, t('requestLogs.contents.stage.clientResponse'), [], [
      { label: t('requestLogs.contents.section.responseHeader', { protocol: clientLabel }), value: clientContent?.responseHeaders ?? null },
      { label: t('requestLogs.contents.section.responseBody', { protocol: clientLabel }), value: clientContent?.responseBody ?? null },
    ])
  }

  const safeId = sanitizeFileSegment(input.requestId, 'request')
  const attemptNo = String(attempt.attemptIndex + 1)
  return { name: `error-report-${safeId}-att${attemptNo}.md`, text: `${lines.join('\n').trimEnd()}\n` }
}
