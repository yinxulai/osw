// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RequestContentsSheet } from './request-contents-sheet'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/features/settings/hooks', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>{props.children}</TooltipProvider>
      </ToastProvider>
    </I18nProvider>
  )
}

function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: 12,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 100,
    createdTime: 0,
    ...overrides,
  }
}

function clientContentOf(overrides: Partial<RequestContent> = {}): RequestContent {
  return {
    id: 'content_1',
    requestId: 'req_1',
    captureStatus: 'captured',
    requestMethod: 'POST',
    requestPath: '/v1/responses',
    requestHeaders: '{}',
    requestBody: '{"model":"default"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: 'data: {"type":"response.output_text.delta","delta":"ok"}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function attemptContentOf(overrides: Partial<AttemptContent> = {}): AttemptContent {
  return {
    id: 'attempt_content_1',
    attemptId: 'att_1',
    captureStatus: 'captured',
    requestHeaders: '{}',
    requestBody: '{"model":"upstream"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: 'data: {"type":"response.output_text.delta","delta":"ok"}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

interface RenderInput {
  /** 客户端视角正文；每个请求只有一行。 */
  client?: Partial<RequestContent>
  /** 单次尝试场景的简写；多尝试场景用 `attempts` + `attemptContents`。 */
  attempt?: Partial<RequestLogEntryAttempt>
  upstream?: Partial<AttemptContent>
  attempts?: Partial<RequestLogEntryAttempt>[]
  attemptContents?: Partial<AttemptContent>[]
  /** 选中哪次尝试；默认是第一次。 */
  selectedAttemptId?: string | null
  /** 哪次尝试把响应写回了客户端；默认最后一次（`servingAttemptOf` 就是最后一条）。 */
  servingAttemptId?: string | null
  /** 正文被保留策略清理：连正文行本身都不存在。 */
  pruned?: boolean
  /** 正文还在取：摘要已经到了，正文没到。 */
  bodiesLoading?: boolean
}

/**
 * 摘要就是同一行去掉正文两列——接口上就是这么定义的，这里照此构造，
 * 免得两边各写一份字段清单后悄悄漂移。
 */
function summaryOf<T extends { requestBody: string | null; responseBody: string | null }>(content: T): Omit<T, 'requestBody' | 'responseBody'> {
  const summary: Record<string, unknown> = { ...content }
  delete summary.requestBody
  delete summary.responseBody
  return summary as Omit<T, 'requestBody' | 'responseBody'>
}

function renderSheet(input: RenderInput = {}) {
  const client = clientContentOf(input.client)
  const attempts = (input.attempts ?? [input.attempt]).map(attempt => attemptOf(attempt))
  const attemptContents = (input.attemptContents ?? [input.upstream]).map(content => attemptContentOf(content))
  const selectedAttemptId = input.selectedAttemptId === undefined ? attempts[0]?.id ?? null : input.selectedAttemptId
  const servingAttemptId = input.servingAttemptId === undefined ? attempts[attempts.length - 1]?.id ?? null : input.servingAttemptId
  return render(
    <RequestContentsSheet
      contents={input.pruned ? [] : [summaryOf(client)]}
      attemptContents={input.pruned ? [] : attemptContents.map(summaryOf)}
      bodies={input.bodiesLoading || input.pruned ? null : { contents: [client], attemptContents }}
      bodiesLoading={input.bodiesLoading ?? false}
      bodiesError={null}
      attempts={attempts}
      requestRewriteRules={[]}
      clientProtocol="openai-responses"
      loading={false}
      error={null}
      selectedAttemptId={selectedAttemptId}
      servingAttemptId={servingAttemptId}
      onClose={() => {}}
    />,
    { wrapper: Wrapper },
  )
}

describe('deferred bodies', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('keeps the panel in its loading state until the bodies arrive, instead of drawing an empty one', () => {
    renderSheet({ bodiesLoading: true })

    expect(screen.getByText('Loading contents')).toBeTruthy()
    expect(screen.queryByText('No bodies to show: this request was pruned by the retention policy, or bodies were never captured. Attempts, usage and metrics are kept.')).toBeNull()
  })

  it('draws every stage once the bodies arrive', () => {
    renderSheet()

    expect(screen.queryByText('Loading contents')).toBeNull()
    expect(screen.getByText('Original client request')).toBeTruthy()
    expect(screen.getByText('Request sent to the real channel')).toBeTruthy()
  })
})

describe('capture status hint', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('says nothing when the whole body was captured', () => {
    renderSheet()

    expect(screen.queryByText('Partial capture')).toBeNull()
  })

  it('marks a client body that was only partially captured, on the client response stage', () => {
    renderSheet({ client: { captureStatus: 'partial' } })

    const chip = screen.getByText('Partial capture')
    expect(chip.closest('section')?.textContent).toContain('Response returned to the client')
  })

  it('marks an upstream body that was only partially captured, on the upstream response stage', () => {
    renderSheet({ upstream: { captureStatus: 'partial' } })

    const chip = screen.getByText('Partial capture')
    expect(chip.closest('section')?.textContent).toContain('Response from the real channel')
  })
})

/**
 * 客户端跳在整条请求上只有一条出口，而且只属于服务该请求的那次尝试。
 *
 * 给被放弃的尝试补一条它从未产生的下游腿，等于把最后一次尝试的响应记在前面几次头上。
 */
describe('client response attribution', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  const servedBody = 'data: {"type":"response.output_text.delta","delta":"from-serving-attempt"}'

  function failoverInput(selectedAttemptId: string): RenderInput {
    return {
      client: { responseBody: servedBody },
      attempts: [
        { id: 'att_failed', attemptIndex: 0, status: 'failed', httpStatus: 400 },
        { id: 'att_serving', attemptIndex: 1, status: 'success', httpStatus: 200 },
      ],
      attemptContents: [
        { id: 'attempt_content_failed', attemptId: 'att_failed', responseStatus: 400, responseBody: '{"error":"bad request"}' },
        { id: 'attempt_content_serving', attemptId: 'att_serving', responseStatus: 200, responseBody: servedBody },
      ],
      selectedAttemptId,
      servingAttemptId: 'att_serving',
    }
  }

  it('does not give an abandoned attempt a client response it never produced', () => {
    renderSheet(failoverInput('att_failed'))

    expect(screen.queryByText('Response returned to the client')).toBeNull()
    // 隐藏不等于没发生：界面要说清这次尝试没回给客户端，
    // 免得「少了第四个阶段」被读成正文丢了。
    expect(screen.getByText(/never returned anything to the client/)).toBeTruthy()
    // 上游视角的两个阶段不受影响：被放弃的尝试照样发过请求、也收到过响应。
    expect(screen.getByText('Request sent to the real channel')).toBeTruthy()
    expect(screen.getByText('Response from the real channel')).toBeTruthy()
  })

  it('keeps the client response stage on the attempt that actually served the request', () => {
    renderSheet(failoverInput('att_serving'))

    expect(screen.getByText('Response returned to the client')).toBeTruthy()
    expect(screen.queryByText(/never returned anything to the client/)).toBeNull()
  })

  it('keeps the request-level client body out of the abandoned attempt', () => {
    renderSheet(failoverInput('att_failed'))

    // 搜索与复制扫的是界面上真正画出来的文本，隐藏阶段也就同时移出了检索范围。
    expect(screen.queryByText(/from-serving-attempt/)).toBeNull()
  })

  it('attributes the synthesized client error of an all-failed request to the last attempt', () => {
    const allFailed: RenderInput = {
      client: { responseStatus: 502, responseBody: '{"success":false,"errorCode":"ALL_PROVIDERS_FAILED"}' },
      attempts: [
        { id: 'att_first', attemptIndex: 0, status: 'failed', httpStatus: 503 },
        { id: 'att_last', attemptIndex: 1, status: 'failed', httpStatus: 503 },
      ],
      attemptContents: [
        { id: 'attempt_content_first', attemptId: 'att_first', responseStatus: 503, responseBody: 'provider unavailable' },
        { id: 'attempt_content_last', attemptId: 'att_last', responseStatus: 503, responseBody: 'provider unavailable' },
      ],
      servingAttemptId: 'att_last',
    }

    const { unmount } = renderSheet({ ...allFailed, selectedAttemptId: 'att_first' })
    expect(screen.queryByText('Response returned to the client')).toBeNull()
    unmount()

    // 客户端确实收到了响应（代理合成的 502），而它归最后一次尝试：
    // 面板沿用「交付尝试就是最后一条」这个定义，不另开一个请求级展示位置。
    renderSheet({ ...allFailed, selectedAttemptId: 'att_last' })
    expect(screen.getByText('Response returned to the client')).toBeTruthy()
    expect(screen.getByText('HTTP 502')).toBeTruthy()
  })

  it('does not confuse pruned bodies with an attempt that never delivered', () => {
    renderSheet({ pruned: true })

    expect(screen.getByText(/No bodies to show/)).toBeTruthy()
    // 交付尝试只是「正文被清理了」，不能说成「它没回给客户端」。
    expect(screen.queryByText(/never returned anything to the client/)).toBeNull()
  })
})
