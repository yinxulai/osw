// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContentSummary, RequestLogDetail, RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
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

// 代理地址只用来拼 cURL。给一个固定监听地址：没有它时整组导出按钮都是禁用的，
// 那样就测不到菜单里的三项了。
vi.mock('@/data/proxy', () => ({ useProxyStatus: () => ({ host: '0.0.0.0', port: 19300 }) }))

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

/** 客户端视角的报文摘要。正文不在这里（详情只带摘要），所以字段到 `requestHeaders` 为止。 */
function contentOf(overrides: Partial<RequestContentSummary> = {}): RequestContentSummary {
  return {
    id: 'content_1',
    requestId: 'req_1',
    captureStatus: 'captured',
    requestMethod: 'post',
    requestPath: '/v1/responses',
    requestHeaders: JSON.stringify({ 'content-type': 'application/json', host: 'example.com' }),
    responseStatus: 200,
    responseHeaders: null,
    createdTime: 1_720_000_000_000,
    updatedTime: 1_720_000_000_000,
    ...overrides,
  }
}

function detailOf(overrides: Partial<RequestLogDetail> = {}): RequestLogDetail {
  return {
    ...logOf(),
    contents: [contentOf()],
    attemptContents: [],
    requestRewriteRules: [],
    ...overrides,
  }
}

/** 行是 `<tr>`，必须待在真正的表体里渲染，否则 React 会抱怨 DOM 嵌套。 */
function renderRow(log: RequestLogEntry, detail: RequestLogDetail | null = null) {
  return render(
    <table>
      <tbody>
        <RequestLogDetailRow
          log={log}
          detail={detail}
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

/**
 * 「复制请求」现在是主按钮 + 下拉：主按钮直接复制 cURL，
 * 菜单里另给 fetch 与「下载完整请求体」。
 *
 * 这里只固定**菜单里有哪些项**，不测剪贴板/下载本身——`buildFetch`、`buildCurl`
 * 和下载纯函数各自有单测，重复断言只会让改文案时改两处。
 */
describe('RequestLogDetailRow export menu', () => {
  it('keeps the three export shapes in the dropdown, cURL marked as the default', async () => {
    renderRow(logOf(), detailOf())

    // Radix 的触发器在方向键上开菜单（jsdom 里比 pointerdown 稳）。
    fireEvent.keyDown(screen.getByRole('button', { name: 'More ways to export this request' }), { key: 'ArrowDown' })

    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(3))
    const [curl, fetch, download] = screen.getAllByRole('menuitem')

    expect(curl.textContent).toContain('Copy as cURL')
    // 主按钮做的是同一件事，菜单里要写明「默认」，否则会像两个不同入口。
    expect(curl.textContent).toContain('Default')
    expect(fetch.textContent).toContain('Copy as fetch')
    expect(download.textContent).toContain('Download request body (JSON)')
    expect(download.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('disables the whole control when the request has no captured content', () => {
    renderRow(logOf(), detailOf({ contents: [] }))

    // 没有报文时按钮照常占位（禁用 + 说明原因），头部不会随数据有无而跳动。
    const trigger = screen.getByRole('button', { name: 'More ways to export this request' })
    expect(trigger).toHaveProperty('disabled', true)
    expect(screen.getByText('Copy request')).toBeTruthy()
  })
})

/**
 * 头部那串编号要说的是「拿什么去问上游」。
 *
 * 本地 `req_` 只在本进程内存在，供应商的日志与控制台都不认它；真正能对上账的是上游
 * 自己发回来的那个标识。所以有一串展示一串，没有才回退本地 id——回退是为了保住
 * 「查看运行日志」的关联键，不是为了好看。
 */
describe('RequestLogDetailRow request identity', () => {
  it('shows the id the upstream assigned', () => {
    renderRow(logOf({ attempts: [attemptOf({ upstreamRequestId: 'chatcmpl-abc123' })] }))

    expect(screen.getByText('Upstream request ID')).toBeTruthy()
    expect(screen.getByText('chatcmpl-abc123')).toBeTruthy()
    // 标签换了来源，值也得跟着换：本地 id 不该同时出现在这一行。
    expect(screen.queryByText('req_1')).toBeNull()
    expect(screen.queryByText('Request ID')).toBeNull()
  })

  it('falls back to the local id when the upstream sent none', () => {
    renderRow(logOf())

    expect(screen.getByText('Request ID')).toBeTruthy()
    expect(screen.getByText('req_1')).toBeTruthy()
  })

  it('ignores the id of an abandoned attempt', () => {
    // 故障转移：第一家回了标识但没交付，第二家交付。要展示的是第二家的，
    // 拿第一家的去搜只会搜到那条已经放弃的上游请求。
    renderRow(logOf({
      attempts: [
        attemptOf({ id: 'att_1', attemptIndex: 0, status: 'failed', upstreamRequestId: 'chatcmpl-abandoned' }),
        attemptOf({ id: 'att_2', attemptIndex: 1, status: 'success', upstreamRequestId: 'chatcmpl-served' }),
      ],
    }))

    expect(screen.getByText('chatcmpl-served')).toBeTruthy()
    expect(screen.queryByText('chatcmpl-abandoned')).toBeNull()
  })
})
