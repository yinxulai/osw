// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RequestLogDetailRow } from './request-log-detail-row'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

// 头部那枚「查看运行日志」是路由链接；这里的断言与跳转无关，给一个透传的替代品。
// 其余导出必须照原样留着：`I18nProvider` 会经 `@/routing/url-overrides` 读 history。
interface LinkStubProps { children: ReactNode }

vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  Link: (props: LinkStubProps) => <a>{props.children}</a>,
}))

// 代理地址只用来拼 cURL；拿不到就是空，测试不覆盖那条路径。
vi.mock('@/data/proxy', () => ({ useProxyStatus: () => null }))

// 正文面板自己持有查询（正文是库里最大的列，点开才取），整块默认关着。
vi.mock('../queries', () => ({
  useRequestLogBodiesQuery: () => ({ data: null, isPending: false, error: null, refetch: vi.fn() }),
  fetchRequestLogBodies: vi.fn(),
}))

interface WrapperProps { children: ReactNode }

// `CopyRequestButton` 会经 `useQueryClient` 取缓存句柄来复用取回的正文，
// 所以哪怕这里不发起任何请求，也得有一个 QueryClient 在树上。
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Wrapper(props: WrapperProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>{props.children}</TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
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
    ttftMilliseconds: 120,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 1_000,
    createdTime: 1_720_000_000_000,
    ...overrides,
  }
}

function logOf(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'req_1',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    status: 'success',
    totalDurationMilliseconds: 1_200,
    totalTokens: 712,
    inputTokens: 700,
    reasoningTokens: null,
    outputTokens: 42,
    cachedInputTokens: 400,
    cacheCreationInputTokens: 0,
    rawUsage: { input_tokens: 700, output_tokens: 42 },
    ttftMilliseconds: 120,
    // 保持足够新，好让「查看运行日志」照常出现（那条链接只在留存窗口内给）。
    createdTime: Date.now(),
    attempts: [attemptOf()],
    ...overrides,
  }
}

/** 行是 `<tr>`，必须待在真正的表体里渲染，否则 React 会抱怨 DOM 嵌套。 */
function renderRow(log: RequestLogEntry) {
  return render(
    <table>
      <tbody>
        <RequestLogDetailRow
          log={log}
          detail={null}
          modelName="Default model"
          modelDeleted={false}
          detailLoading={false}
          detailError={null}
        />
      </tbody>
    </table>,
    { wrapper: Wrapper },
  )
}

/** 指标格上那圈框是这排读数的唯一身份，别的地方也有同名文案（例如尝试行里的 TTFT）。 */
function metricLabelsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-slot="metric-card"]')]
    .map(card => card.firstElementChild?.textContent ?? '')
}

/**
 * 取某一格显示的数值。
 *
 * 用位置而不是全局搜文案：同一个数字在尝试行、原始 Usage 里也会出现，
 * 全局搜到两处时 `getByText` 会直接报错，而那个错看不出「哪一格算错了」。
 */
function metricValueOf(container: HTMLElement, index: number): string {
  const cards = [...container.querySelectorAll('[data-slot="metric-card"]')]
  return cards[index]?.lastElementChild?.textContent ?? ''
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'en' })
})

/**
 * 详情上方那排指标格只回答一个问题：**这次请求跑得怎么样**。
 *
 * 四枚是读出来的数（总耗时、首字延迟、速度、缓存命中率），两枚只能算出来（重试耗时、
 * 首字占比）——它们回答的问题任何单个原始数字都答不了，而用量报文里也没有对应字段。
 *
 * Token 的各路明细（总量、输入、输出、思考、缓存读取、缓存写入）不在这排格子里重复一遍——
 * 它们在右栏的「原始 Usage」里逐项列着，而且是上游原样报回来的数字。
 * 这里同时固定两件事：留下的是哪六格，以及去掉的那几格真的没回来。
 */
describe('RequestLogDetailRow metric grid', () => {
  it('keeps exactly the six readings that describe how the request performed', () => {
    const { container } = renderRow(logOf())

    expect(metricLabelsOf(container)).toEqual([
      'Total duration',
      'Retry time',
      'TTFT',
      'TTFT share',
      'TPS',
      'Cache hit rate',
    ])
  })

  it('leaves the token breakdown to the raw usage block', () => {
    renderRow(logOf())

    // 这几格曾经也在上面抄过一遍；它们属于「原始 Usage」，不属于这排读数。
    for (const removed of ['Total tokens', 'Input tokens', 'Output tokens', 'Reasoning tokens', 'Cache read', 'Cache write']) {
      expect(screen.queryByText(removed)).toBeNull()
    }
    // 原始 Usage 那块照旧在，数字没丢，只是不再有第二份。
    expect(screen.getByText('Raw usage')).toBeTruthy()
  })

  it('reads the hit rate off the tokens the upstream reported', () => {
    renderRow(logOf())

    // 400 / 700；小数位只有一处定义（`@/lib/format-percent`）。
    expect(screen.getByText('57.1%')).toBeTruthy()
    // 速度按整段尝试耗时算：42 Token ÷ 1s。单位与列表行、统计分析同源。
    expect(screen.getByText('42 t/s')).toBeTruthy()
  })

  it('splits the total duration into first-token wait and delivery', () => {
    // 1200ms 里 120ms 在等第一个字：那不是慢在传，是慢在开始。
    const { container } = renderRow(logOf())

    expect(metricValueOf(container, 3)).toBe('10.0%')
  })

  it('counts only the abandoned attempts as retry time', () => {
    const { container } = renderRow(logOf({
      attempts: [
        attemptOf({ id: 'att_1', attemptIndex: 0, status: 'failed', durationMilliseconds: 600 }),
        attemptOf({ id: 'att_2', attemptIndex: 1, status: 'success', durationMilliseconds: 1_000 }),
      ],
    }))

    // 被放弃的那条 600ms 是重试付出的代价；服务请求那条的 1000ms 不是「重试」。
    // 只看第二格：尝试行里也有这个 600ms，那是它自己的耗时，不是汇总值。
    const cards = [...container.querySelectorAll('[data-slot="metric-card"]')]
    expect(cards[1].lastElementChild?.textContent).toBe('600ms')
  })

  it('shows zero retry time when the first attempt delivered', () => {
    const { container } = renderRow(logOf())

    // 零不是「没测到」：走通了、一次没重试，是真实的测得零。
    const cards = [...container.querySelectorAll('[data-slot="metric-card"]')]
    expect(cards[1].lastElementChild?.textContent).toBe('0ms')
  })

  it('writes a dash instead of a zero hit rate when the upstream never reported it', () => {
    const { container } = renderRow(logOf({ cachedInputTokens: null, inputTokens: null }))

    // 「上游没报缓存字段」与「这次一次都没命中」是两件事，不能都写成 0.0%。
    expect(screen.queryByText('0.0%')).toBeNull()
    const cards = [...container.querySelectorAll('[data-slot="metric-card"]')]
    expect(cards).toHaveLength(6)
    expect(cards[5].lastElementChild?.textContent).toBe('—')
  })

  it('reports a genuine zero hit rate as zero', () => {
    const { container } = renderRow(logOf({ cachedInputTokens: 0 }))

    // 输入为正而缓存读取为零，那是真实的「测得 0」。
    expect(metricValueOf(container, 5)).toBe('0.0%')
  })

  it('writes a dash for the first-token share when there is no first token', () => {
    const { container } = renderRow(logOf({ ttftMilliseconds: null }))

    const cards = [...container.querySelectorAll('[data-slot="metric-card"]')]
    expect(cards[3].lastElementChild?.textContent).toBe('—')
  })
})
