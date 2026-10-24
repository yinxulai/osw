import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'
import { PROTOCOL_LABEL, distinctAttemptErrorCode, distinctAttemptErrorMessage, formatTransport } from './format'
import { isLocalFailureBody } from './format-content'

/**
 * 「请求正文」面板里与 React 无关的那一层。
 *
 * 面板要画两样东西：这次尝试的事实清单，以及四个阶段的正文链路。两者的形状完全由数据决定、
 * 与渲染无关，因此放在这里——可以在没有 React、没有 jsdom 的地方单测，
 * 面板本身也只剩「取数 + 组合」。
 */

/** 协议枚举值转展示名；`null` 表示这次请求根本没识别出该协议。 */
export function protocolLabel(t: AppTranslator, protocol: string | null): string {
  if (protocol === null) return t('requestLogs.contents.unknownProtocol')
  return PROTOCOL_LABEL[protocol] ?? protocol
}

export interface FactItem {
  label: string
  value: string
  /** 内部 id、URL、规则 id 这类只在深挖时才看的事实，默认收进「更多事实」。 */
  advanced?: boolean
}

/** 时间戳是事实本身，展示时才变成可读时间；格式化跟随界面语言。 */
export function formatCreatedTime(locale: string, time: number): string {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleString(locale, { hour12: false })
}

/**
 * 尝试级事实。
 *
 * 前面几项是排障第一眼就要看的结论与性能；内部 id、URL、规则 id 是回头查库才用到的，
 * 列为「更多事实」，默认收起。错误码/错误信息也放在收起区：它们已经由顶部横幅预告过一次，
 * 这里只是为了让「复制本次尝试事实」拿到完整记录。
 *
 * 不再列「结果」：`SheetTitle` 里的结果 chip 就紧挨在上面，写两遍只是同义反复。
 */
export function factsOf(t: AppTranslator, locale: string, attempt: RequestLogEntryAttempt): FactItem[] {
  const errorCode = distinctAttemptErrorCode(attempt)
  const errorMessage = distinctAttemptErrorMessage(attempt)

  return [
    { label: t('requestLogs.contents.fact.provider'), value: attempt.providerName },
    { label: t('requestLogs.contents.fact.providerModel'), value: attempt.providerModelName },
    { label: t('requestLogs.contents.fact.upstreamProtocol'), value: attempt.upstreamProtocol ?? t('requestLogs.contents.fact.unrecognized') },
    { label: t('requestLogs.contents.fact.upstreamTransport'), value: formatTransport(t, attempt.upstreamTransport) },
    { label: t('requestLogs.contents.fact.ttft'), value: attempt.ttftMilliseconds === null ? t('requestLogs.contents.fact.noOutput') : `${attempt.ttftMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.duration'), value: `${attempt.durationMilliseconds} ms` },
    { label: t('requestLogs.contents.fact.retryable'), value: attempt.retryable ? t('common.state.yes') : t('common.state.no') },
    ...(errorCode ? [{ label: t('requestLogs.contents.fact.errorCode'), value: errorCode, advanced: true }] : []),
    ...(errorMessage ? [{ label: t('requestLogs.contents.fact.errorMessage'), value: errorMessage, advanced: true }] : []),
    { label: t('requestLogs.contents.fact.attemptIndex'), value: String(attempt.attemptIndex + 1), advanced: true },
    { label: t('requestLogs.contents.fact.attemptId'), value: attempt.id, advanced: true },
    { label: t('requestLogs.contents.fact.providerId'), value: attempt.providerId, advanced: true },
    { label: t('requestLogs.contents.fact.providerModelId'), value: attempt.providerModelId, advanced: true },
    { label: t('requestLogs.contents.fact.upstreamRequestId'), value: attempt.upstreamRequestId ?? t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.upstreamUrl'), value: attempt.url, advanced: true },
    { label: t('requestLogs.contents.fact.requestRewriteRules'), value: attempt.requestRewriteRuleIds.join(', ') || t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.responseRewriteRules'), value: attempt.responseRewriteRuleIds.join(', ') || t('common.state.none'), advanced: true },
    { label: t('requestLogs.contents.fact.createdTime'), value: formatCreatedTime(locale, attempt.createdTime), advanced: true },
  ]
}

/** 一个正文块：标题之外只有「有没有正文」，取值与展示都由组件决定。 */
export interface ContentStageSection {
  id: string
  label: string
  value: string | null
}

/**
 * 一个阶段的完整数据（不含任何展开态 / 搜索态）。
 *
 * 这些字段与渲染无关，`buildContentStages` 只负责把「库里那几列」翻成链路里的四个位置。
 */
export interface ContentStage {
  id: string
  title: string
  /** 已经本地化的协议名。 */
  protocol: string
  /** 该阶段的响应状态；`null` 表示该阶段没有可展示的状态（如尚未拿到正文）。 */
  statusLabel: string | null
  /**
   * 这条视角的正文记录没有采全（`captureStatus === 'partial'`）。
   *
   * 只给响应阶段置位：请求体在响应头到达之前就已经发完了，「半截」只可能出现在响应上。
   */
  partialCapture?: boolean
  sections: ContentStageSection[]
}

export interface ContentStageInput {
  /** 客户端视角正文。 */
  clientContent: RequestContent | null
  /** 选中尝试对应的上游视角正文。 */
  attemptContent: AttemptContent | null
  /** 本次尝试的客户端协议；未知时为 `null`。 */
  clientProtocol: string | null
  /** 本次尝试实际发往上游的协议。 */
  upstreamProtocol: string | null
  /** 客户端协议与上游协议不一致，即发生过协议转换。 */
  converted: boolean
  /**
   * 选中的这次尝试是否就是把响应写回客户端的那一次。
   *
   * 为假表示这次尝试被放弃了（`servesRequest: false`）：它一个字节都没有交给客户端，
   * 因此「返回客户端的响应」这个阶段根本不属于它。
   */
  servesClient: boolean
}

export function buildContentStages(t: AppTranslator, input: ContentStageInput): ContentStage[] {
  const { clientContent, attemptContent, clientProtocol, upstreamProtocol, converted, servesClient } = input
  const clientLabel = protocolLabel(t, clientProtocol)
  const upstreamLabel = protocolLabel(t, upstreamProtocol)
  const clientRequestTitle = t('requestLogs.contents.stage.clientRequest')
  const upstreamRequestTitle = t(converted ? 'requestLogs.contents.stage.upstreamRequestConverted' : 'requestLogs.contents.stage.upstreamRequest')
  const upstreamResponseTitle = t('requestLogs.contents.stage.upstreamResponse')
  const clientResponseTitle = t(converted ? 'requestLogs.contents.stage.clientResponseConverted' : 'requestLogs.contents.stage.clientResponse')
  // 本地失败时上游一个字节都没回。这条正文记的是本地观察到的失败原因，
  // 叫它「上游响应」会让人以为是上游回的内容。
  const upstreamResponseBodyIsLocalFailure = isLocalFailureBody(attemptContent?.responseBody ?? null)

  // 阶段的取值直接来自它所属的表：
  //   客户端原始请求 / 返回客户端的响应 -> request_contents（客户端视角）
  //   发送到供应商的请求 / 供应商响应   -> attempt_contents（上游视角）
  const stages: ContentStage[] = [
    {
      id: 'client-request',
      title: clientRequestTitle,
      protocol: clientLabel,
      statusLabel: null,
      sections: [
        { id: 'client-request.headers', label: t('requestLogs.contents.section.requestHeader', { protocol: clientLabel }), value: clientContent?.requestHeaders ?? null },
        { id: 'client-request.body', label: t('requestLogs.contents.section.requestBody', { protocol: clientLabel }), value: clientContent?.requestBody ?? null },
      ],
    },
    {
      id: 'upstream-request',
      title: upstreamRequestTitle,
      protocol: upstreamLabel,
      statusLabel: null,
      sections: [
        { id: 'upstream-request.headers', label: t('requestLogs.contents.section.requestHeader', { protocol: upstreamLabel }), value: attemptContent?.requestHeaders ?? null },
        { id: 'upstream-request.body', label: t('requestLogs.contents.section.requestBody', { protocol: upstreamLabel }), value: attemptContent?.requestBody ?? null },
      ],
    },
    {
      id: 'upstream-response',
      title: upstreamResponseTitle,
      protocol: upstreamLabel,
      statusLabel: attemptContent
        ? (attemptContent.responseStatus === null ? t('requestLogs.contents.status.upstreamNoResponse') : `HTTP ${attemptContent.responseStatus}`)
        : null,
      partialCapture: attemptContent?.captureStatus === 'partial',
      sections: [
        { id: 'upstream-response.headers', label: t('requestLogs.contents.section.responseHeader', { protocol: upstreamLabel }), value: attemptContent?.responseHeaders ?? null },
        {
          id: 'upstream-response.body',
          label: upstreamResponseBodyIsLocalFailure
            ? t('requestLogs.contents.section.localFailure')
            : t('requestLogs.contents.section.responseBody', { protocol: upstreamLabel }),
          value: attemptContent?.responseBody ?? null,
        },
      ],
    },
  ]

  // 「返回客户端的响应」是请求级事实，不属于每一次尝试：被放弃的尝试从来没有向客户端
  // 写出过一个字节（`attempt-conclusion.ts` 里 `servesRequest: false`）。
  // 无条件拼出这一阶段，等于把**最后一次尝试**的响应记在前面几次头上——既是错误的
  // 失败归因，也让搜索与复制混进不属于这次尝试的正文。
  if (servesClient) {
    stages.push({
      id: 'client-response',
      title: clientResponseTitle,
      protocol: clientLabel,
      statusLabel: clientContent
        ? (clientContent.responseStatus === null ? t('requestLogs.contents.status.noResponse') : `HTTP ${clientContent.responseStatus}`)
        : null,
      partialCapture: clientContent?.captureStatus === 'partial',
      sections: [
        { id: 'client-response.headers', label: t('requestLogs.contents.section.responseHeader', { protocol: clientLabel }), value: clientContent?.responseHeaders ?? null },
        { id: 'client-response.body', label: t('requestLogs.contents.section.responseBody', { protocol: clientLabel }), value: clientContent?.responseBody ?? null },
      ],
    })
  }

  return stages
}
