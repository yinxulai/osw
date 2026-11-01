/**
 * 把一次失败的尝试整理成一份可以直接发给供应商的报告。
 *
 * 收件人是**供应商**，因此报告里只出现供应商能对得上的事实：它收到了什么请求（改写与协议转换
 * 之后的真实 URL、头、正文）、它回了什么、以及我们对这次失败的判定（错误码、错误信息、耗时）。
 *
 * 本地的流水号一律不写：请求 ID、尝试 ID、Provider ID、上游模型 ID、命中的改写规则 ID
 * 在供应商那里查不到任何东西，写进去只会让人以为该拿它们去核对。上游模型写**名字**
 * （供应商认得的那个），不写它在我们库里的 id；地址放在「请求」小节里，不在事实清单里
 * 再列一遍——重复只会让两份值不一致时更难判断以哪份为准。
 *
 * 客户端视角的两段（客户端原始请求、返回客户端的响应）也不写。这份报告要答的是
 * 「这份报文供应商收到了吗、它回了什么」，客户端那一侧属于我们自己的链路；
 * 两个视角混在一个文件里，供应商第一眼看到的会是一份它从未见过的请求。
 *
 * 因此这里只做「编排」，不做任何再加工：正文按 `prettyRequestBody` 重排（只改排版，内容一字不改），
 * 头本来就是脱敏后的 JSON 原样。缺失的部分显式写成「未采集」，而不是悄悄留白——
 * 供应商看不到的字段，正是需要回来问我们的字段。
 */

import type { AttemptContent, RequestLogEntryAttempt } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'
import { formatCreatedTime, protocolLabel } from './contents'
import { distinctAttemptErrorCode, distinctAttemptErrorMessage, formatTransport } from './format'
import { prettyRequestBody, sanitizeFileSegment } from './request-body-download'

export interface ErrorReportInput {
  t: AppTranslator
  /** 界面语言，用来格式化生成时间。 */
  locale: string
  /** 报告针对的那次尝试。 */
  attempt: RequestLogEntryAttempt
  /** 该尝试的上游视角正文；`null` 表示没有这一行（没采到，或已被保留策略清理）。 */
  attemptContent: AttemptContent | null
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
 * 报告里的事实清单。
 *
 * 与界面上的「本次尝试事实」不是同一份：界面上那一份把内部 id 收进「更多事实」供深挖，
 * 报告这一份是给外面看的，**一个 id 都不该有**。因此这里单独列一份，
 * 而不是在界面的清单上做减法——两处要回答的问题本来就不同。
 */
function reportFactsOf(t: AppTranslator, locale: string, attempt: RequestLogEntryAttempt): Array<{ label: string; value: string }> {
  const errorCode = distinctAttemptErrorCode(attempt)
  const errorMessage = distinctAttemptErrorMessage(attempt)

  return [
    { label: t('requestLogs.contents.fact.provider'), value: attempt.providerName },
    { label: t('requestLogs.contents.fact.providerModel'), value: attempt.providerModelName },
    { label: t('requestLogs.contents.fact.upstreamProtocol'), value: attempt.upstreamProtocol ?? t('requestLogs.contents.fact.unrecognized') },
    { label: t('requestLogs.contents.fact.upstreamTransport'), value: formatTransport(t, attempt.upstreamTransport) },
    { label: t('requestLogs.contents.fact.attemptIndex'), value: String(attempt.attemptIndex + 1) },
    ...(errorCode ? [{ label: t('requestLogs.contents.fact.errorCode'), value: errorCode }] : []),
    ...(errorMessage ? [{ label: t('requestLogs.contents.fact.errorMessage'), value: errorMessage }] : []),
    { label: t('requestLogs.contents.fact.ttft'), value: attempt.ttftMilliseconds === null ? t('requestLogs.contents.fact.noOutput') : `${attempt.ttftMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.duration'), value: `${attempt.durationMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.createdTime'), value: formatCreatedTime(locale, attempt.createdTime) },
  ]
}

/**
 * 文件名。
 *
 * 优先用上游请求 ID：供应商在自己那边查日志时认的就是这个号，回信里也会引用它。
 * 没有时退回「第几次尝试」——这是我们与供应商都能对齐的最小坐标。
 */
function reportFileName(attempt: RequestLogEntryAttempt): string {
  const attemptNo = String(attempt.attemptIndex + 1)
  const upstreamId = sanitizeFileSegment(attempt.upstreamRequestId ?? '', '')
  return upstreamId === ''
    ? `error-report-att${attemptNo}.md`
    : `error-report-${upstreamId}-att${attemptNo}.md`
}

/**
 * 生成报告。
 *
 * 顺序就是供应商复现的顺序：先给结论（这次尝试是谁、错误码、错误信息、耗时），
 * 再给它收到的请求，最后是它回的响应。
 */
export function buildErrorReport(input: ErrorReportInput): ReportFile {
  const { t, locale, attempt, attemptContent } = input
  const lines: string[] = []

  lines.push(`# ${t('requestLogs.contents.errorReport.title')}`, '')
  lines.push(`${t('requestLogs.contents.errorReport.generatedAt')}: ${formatCreatedTime(locale, input.generatedTime)}`)
  // 上游请求 ID 是唯一值得写进抬头的号：它是供应商自己的流水号。没有就整行不写。
  if (attempt.upstreamRequestId) lines.push(`${t('requestLogs.contents.fact.upstreamRequestId')}: ${attempt.upstreamRequestId}`)
  lines.push('')

  lines.push(`## ${t('requestLogs.contents.attemptFacts.title')}`, '')
  for (const fact of reportFactsOf(t, locale, attempt)) lines.push(`- ${fact.label}: ${fact.value}`)
  lines.push('')

  const upstreamLabel = protocolLabel(t, attempt.upstreamProtocol)
  const upstreamStatus = attemptContent === null
    ? t('requestLogs.contents.errorReport.notCaptured')
    : attemptContent.responseStatus === null
      ? t('requestLogs.contents.status.upstreamNoResponse')
      : `HTTP ${attemptContent.responseStatus}`
  // 地址是请求段的元信息，空值也照位写「未采集」，免得整段少一行让人以为漏了。
  const upstreamUrl = attempt.url === '' ? t('requestLogs.contents.errorReport.notCaptured') : attempt.url

  appendSection(lines, t, t('requestLogs.contents.stage.upstreamRequest'), [upstreamUrl], [
    { label: t('requestLogs.contents.section.requestHeader', { protocol: upstreamLabel }), value: attemptContent?.requestHeaders ?? null },
    { label: t('requestLogs.contents.section.requestBody', { protocol: upstreamLabel }), value: attemptContent?.requestBody ?? null },
  ])

  appendSection(lines, t, t('requestLogs.contents.stage.upstreamResponse'), [upstreamStatus], [
    { label: t('requestLogs.contents.section.responseHeader', { protocol: upstreamLabel }), value: attemptContent?.responseHeaders ?? null },
    { label: t('requestLogs.contents.section.responseBody', { protocol: upstreamLabel }), value: attemptContent?.responseBody ?? null },
  ])

  return { name: reportFileName(attempt), text: `${lines.join('\n').trimEnd()}\n` }
}
