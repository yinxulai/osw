// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveRequest, LiveRequestAttempt } from '@common/schemas'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { RequestExecutionRow } from './request-execution-row'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/features/settings/hooks', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <ToastProvider>{props.children}</ToastProvider>
    </I18nProvider>
  )
}

function attemptOf(overrides: Partial<LiveRequestAttempt> = {}): LiveRequestAttempt {
  return {
    index: 0,
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    endpointProtocol: 'openai-responses',
    url: 'https://example.com/v1/responses',
    state: 'streaming',
    httpStatus: 200,
    upstreamTransport: 'http-stream',
    requestBytes: 1_024,
    requestRewriteRuleNames: [],
    upstreamBytes: 4_096,
    downstreamBytes: 2_048,
    chunkCount: 3,
    chunkPreview: 'data: {"choices":[{"delta":{"content":"hi"}}]}',
    ttftMilliseconds: 120,
    inputTokens: 12,
    outputTokens: 42,
    errorCode: null,
    errorMessage: null,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  }
}

function liveRequestOf(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_live',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1_000,
    updatedAt: 1_100,
    endedAt: null,
    candidates: [
      { providerId: 'prov_1', providerName: 'Provider One', providerModelId: 'model_1', providerModelName: 'model-one' },
    ],
    attempts: [attemptOf()],
    events: [
      { at: 1_000, offsetMilliseconds: 0, kind: 'route.resolved', level: 'info', detail: { candidates: 1 } },
      { at: 1_020, offsetMilliseconds: 20, kind: 'attempt.start', level: 'info', detail: { index: 0, providerModelName: 'model-one' } },
      { at: 1_120, offsetMilliseconds: 120, kind: 'upstream.head', level: 'success', detail: { attempt: 1, httpStatus: 200 } },
    ],
    ...overrides,
  }
}

interface RenderRowOptions {
  expanded?: boolean
  toggleExpand?: (id: string) => void
}

/** 行是 `<tr>`，必须待在真正的表体里渲染，否则 React 会抱怨 DOM 嵌套。 */
function renderRow(live: LiveRequest, options: RenderRowOptions = {}) {
  render(
    <table>
      <tbody>
        <RequestExecutionRow
          live={live}
          expanded={options.expanded ?? false}
          modelName="Default model"
          toggleExpand={options.toggleExpand ?? (() => {})}
        />
      </tbody>
    </table>,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'en' })
})

/**
 * 进行中的请求在列表里占一行。折叠时它要和已结束的行长得一样（同一套列、同一套单位），
 * 展开时才换成「现在到哪一步了」的直播面板——**一句现在时加一条时间轴**，
 * 而不是把已结束详情那张静态指标表套进来。这里验的就是这两件事。
 */
describe('RequestExecutionRow', () => {
  it('reports the phase and the live figures in the folded row', () => {
    renderRow(liveRequestOf())

    expect(screen.getByText('Delivering')).toBeTruthy()
    // 落点这一格与已结束的行逐字对齐：只写「最终落在谁身上」。
    expect(screen.getByText('Provider One/model-one')).toBeTruthy()
    expect(screen.getByText('OpenAI Responses')).toBeTruthy()
    expect(screen.getByText('Streaming')).toBeTruthy()
    // Token 与首字是台账里此刻的值；缓存那一列进行中必然空缺，留 `—` 而不是挤掉整列。
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('120ms')).toBeTruthy()
    expect(screen.queryByText('MISS')).toBeNull()
    // 折叠态不额外塞「方法 路径」这种只属于展开区的细节。
    expect(screen.queryByText('POST /v1/responses')).toBeNull()
  })

  it('expands the row when it is clicked', () => {
    const toggleExpand = vi.fn()
    renderRow(liveRequestOf(), { toggleExpand })

    fireEvent.click(screen.getByText('Delivering'))

    expect(toggleExpand).toHaveBeenCalledWith('req_live')
  })

  it('states what is happening now and how long it has been happening', () => {
    renderRow(liveRequestOf(), { expanded: true })

    // 第一句是现在时，不是「详情」这种名词；而且说的是「上游在吐，我边收边转」。
    expect(screen.getByText('Upstream is emitting; relaying as it arrives')).toBeTruthy()
    // 头部那一行事实对与历史详情同源：标签 + 值，不是一块自带底色的摘要卡。
    expect(screen.getByText('Logical model')).toBeTruthy()
    expect(screen.getByText('Default model')).toBeTruthy()
    expect(screen.getByText('Channel model')).toBeTruthy()
    // 落点和折叠行那一格说的是同一件事（两处都在，所以按多命中取）。
    expect(screen.getAllByText('Provider One/model-one').length).toBeGreaterThan(1)
    // 只留两个此刻值得盯的数字，而不是一排八个指标格。
    expect(screen.getByText('Elapsed')).toBeTruthy()
    // 速度指标直接叫 TPS，不意译成 "Output speed"。
    expect(screen.getByText('TPS')).toBeTruthy()
  })

  it('tells the story of the request on a timeline', () => {
    renderRow(liveRequestOf(), { expanded: true })

    expect(screen.getByText('Timeline')).toBeTruthy()
    // 起点是合成出来的「收到请求」：台账的 begin 不产生事件，但故事得有个头。
    expect(screen.getByText('Received POST /v1/responses')).toBeTruthy()
    expect(screen.getByText('Route chosen')).toBeTruthy()
    // 候选链按优先级排，所以「试到第二家」在出事之前就已经写在轴上了。
    expect(screen.getByText('1 candidates · model-one')).toBeTruthy()
    expect(screen.getByText('Sent to model-one · attempt 1')).toBeTruthy()
    expect(screen.getByText('model-one responded 200')).toBeTruthy()
    // 偏移量比绝对时间有用：两次事件之间隔了多久才是这条线上的刻度。
    expect(screen.getByText('+20ms')).toBeTruthy()
    expect(screen.getByText('+120ms')).toBeTruthy()
  })

  it('shows what has arrived so far on the live tail', () => {
    renderRow(liveRequestOf(), { expanded: true })

    // 「此刻」那个节点报的是累计收到的字节——这个数没有对应事件，只能画出来。
    expect(screen.getByText('Received 2.0 KB')).toBeTruthy()
    expect(screen.getByText('42 tokens')).toBeTruthy()
    // 字节数只说了量，说不出收的是什么；上游每块开头的原文照抄在这里。
    expect(screen.getByText('data: {"choices":[{"delta":{"content":"hi"}}]}')).toBeTruthy()
  })

  it('keeps the preview row even before the upstream has sent anything', () => {
    renderRow(liveRequestOf({ attempts: [attemptOf({ chunkPreview: null, state: 'connecting' })] }), { expanded: true })

    expect(screen.getByText('Received 2.0 KB')).toBeTruthy()
    // 一块都还没来时不留原文（那是上一块的事），但这一行**照旧占着**：
    // 行高若随数据有无出现与消失，尾巴节点就会跳一行，看起来像面板在抖。
    expect(screen.queryByText(/^data:/)).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('names every rewrite rule that touched the request, not just how many', () => {
    renderRow(liveRequestOf({
      attempts: [attemptOf({ requestRewriteRuleNames: ['Remove Date Suffix', 'Set Temperature'] })],
      events: [
        { at: 1_000, offsetMilliseconds: 0, kind: 'request.prepared', level: 'info', detail: { attempt: 1, appliedRules: 2, protocolConverted: false } },
      ],
    }), { expanded: true })

    // 命中多条时要点名：只说「命中 2 条」回答不了「是哪两个修改器动过我的请求」，
    // 而那正好是看到「请求被改过」之后的下一个问题。
    expect(screen.getByText('Rules applied: Remove Date Suffix, Set Temperature')).toBeTruthy()
  })

  it('falls back to the rule count when the ledger carries no names', () => {
    renderRow(liveRequestOf({
      events: [
        { at: 1_000, offsetMilliseconds: 0, kind: 'request.prepared', level: 'info', detail: { attempt: 1, appliedRules: 1 } },
      ],
    }), { expanded: true })

    // 名字还没带上来的快照：少几个字，但「改过」这件事照说。
    expect(screen.getByText('1 rewrite rules applied')).toBeTruthy()
  })

  it('keeps only the newest chunk, because older ones have already been read', () => {
    // 尾巴只展示「此刻收的是什么」：历史分块属于事件流，不属于这一行。
    const tail = liveRequestOf({ attempts: [attemptOf({ chunkPreview: 'chunk-59', chunkCount: 60 })] })
    renderRow(tail, { expanded: true })

    expect(screen.getByText('chunk-59')).toBeTruthy()
  })

  it('tells retries apart from waiting on a single upstream', () => {
    // 等响应头与等首字节看起来都是「在等」，但对用户的意义不同，所以阶段名必须分开。
    renderRow(liveRequestOf({
      phase: 'awaiting-first-byte',
      attempts: [attemptOf({ state: 'awaiting-upstream', httpStatus: 200 })],
    }), { expanded: true })

    expect(screen.getByText('First byte')).toBeTruthy()
    expect(screen.getByText('Upstream answered, waiting for the first byte')).toBeTruthy()
  })

  it('does not invent a routing decision before one exists', () => {
    renderRow(liveRequestOf({
      phase: 'routing',
      logicalModelId: null,
      candidates: [],
      attempts: [],
      events: [],
    }), { expanded: true })

    // 折叠行的徽标说「路由中」，标题行说的是同一件事的现在时（按路由顺序挑上游）。
    expect(screen.getByText('Routing')).toBeTruthy()
    expect(screen.getByText('Picking an upstream in route order')).toBeTruthy()
    // 逻辑模型还没定下来时，头部那一格写的是占位词而不是空白。
    expect(screen.getByText('Unresolved')).toBeTruthy()
    // 没有事件时时间轴只剩起点——不是一块空白，也不是一句「暂无数据」。
    expect(screen.getByText('Received POST /v1/responses')).toBeTruthy()
    // 首字还没来时占位符照旧，连 `title` 都写着在等什么。
    expect(screen.getByTitle('Awaiting first byte')).toBeTruthy()
  })

  it('stops the clock once the ledger settles the request', () => {
    const settled = liveRequestOf({
      status: 'success',
      phase: 'settled',
      endedAt: 3_000,
      attempts: [attemptOf({ state: 'success', endedAt: 3_000 })],
    })
    renderRow(settled, { expanded: true })

    // 已用时读的是台账冻结下来的 `endedAt`，不再走本地秒表。
    expect(screen.getAllByText('2.0s').length).toBeGreaterThan(0)
    // 落定之后标题行报的是结局，阶段徽标报的是「已结束」。
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getByText('Settled')).toBeTruthy()
  })
})
