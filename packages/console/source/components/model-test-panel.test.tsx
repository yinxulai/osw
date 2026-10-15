// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import type { ModelTestResult } from '@/api/tools'
import { ModelTestPanel } from './model-test-panel'

/*
 * 渠道诊断面板的两条设计约束都在这儿守着。它们是「扫一眼就知道」的层次的问题，
 * 也正是最容易在后续改动里被推回去的部分：
 *
 * 1. **一格只放一个事实。** 结果表最后一格原本是「HTTP 404 ↓1234」：协议结论与产出量
 *    是两个量纲，挤在一格里读起来像一句话，横向比对时又只能整格从七零八落的宽度里找。
 *    现在状态列只说状态（HTTP 码退进 `title`），输出 Token 单列右对齐。
 * 2. **协议不进列，进色条。** 协议是贴在渠道 / 模型格左侧的那 2px 竖线上；协议名印在
 *    分段控件上，用正式写法（`OpenAI Completions`），不缩写成 `Completions`。独立一列
 *    要多付 62px 的固定宽度，而主体格右侧本来就空着一片。
 * 3. **协议只属于模型，不属于渠道。** 数据里协议长在模型端点上，一个模型可能三种协议
 *    都有，所以渠道这一层不能出现任何协议名——那要么是从下面几行求和出来的重复，
 *    要么在说一件数据里并不存在的事。
 *
 * 另外两条属于勾选区：分段必须是 `role="checkbox"`（行级半选靠它求和），
 * 计数必须带单位（裸 `2/3` 排在模型名右边会被读成「三个模型里选了两个」，可模型只有一行）。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))
vi.mock('@/api/tools', () => ({ modelTestApi: { run: vi.fn() } }))

const { modelTestApi } = await import('@/api/tools')

const zh = createAppTranslator('zh-CN')

const PROVIDER_NAME = '示例渠道'
/** 只开了 completions，但开了协议转换：三个协议都可测，其中两个是转出来的。 */
const CONVERTING_MODEL = 'gpt-4o'
/** 原生只支持 anthropic-messages：可测协议就一个。 */
const NATIVE_MODEL = 'claude-sonnet'

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_1',
    name: PROVIDER_NAME,
    enabled: true,
    description: '',
    apiKeyReference: 'key',
    timeoutMilliseconds: 30000,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
    ...overrides,
  } as Provider
}

function model(overrides: Partial<ProviderModelRoute> = {}): ProviderModelRoute {
  return {
    id: 'm1',
    providerId: 'prov_1',
    modelName: CONVERTING_MODEL,
    endpoints: [{
      protocol: 'openai-completions',
      endpointUrl: 'https://api.example.com/v1/chat/completions',
      customAuthHeader: null,
      protocolConversionEnabled: true,
    }],
    priority: 0,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
    ...overrides,
  } as ProviderModelRoute
}

const MODELS = [
  model(),
  model({
    id: 'm2',
    modelName: NATIVE_MODEL,
    endpoints: [{
      protocol: 'anthropic-messages',
      endpointUrl: 'https://api.example.com/v1/messages',
      customAuthHeader: null,
      protocolConversionEnabled: false,
    }],
  }),
]

function renderPanel() {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(
    <I18nProvider>
      <ModelTestPanel open models={MODELS} providers={[provider()]} onOpenChange={() => {}} />
    </I18nProvider>,
  )
}

/**
 * 勾上唯一的渠道：面板打开时默认谁都不选，先勾上才有模型行与待测计划行。
 */
function selectProvider() {
  fireEvent.click(screen.getByRole('checkbox', { name: PROVIDER_NAME }))
}

/**
 * 结果表里某个模型的**全部**行。
 *
 * 名字在页面上出现不止一次：左栏也印模型名，而一个模型可以按协议排出好几条任务。
 * 主体格是行里唯一带 `relative` 且含绝对定位色条的格子，用它把「结果表的行」筛出来；
 * 行本身是它的父节点。
 */
function tableRowsFor(modelName: string): HTMLElement[] {
  return screen.getAllByText(modelName)
    .map(node => node.closest('div.relative'))
    .filter((cell): cell is HTMLElement => Boolean(cell?.querySelector('span.absolute')))
    .map(cell => cell.parentElement as HTMLElement)
}

/** 分段控件的凹槽（`PROTOCOL_TRACK_CLASS`）。限定在它里面找，就不会捞到渠道与模型那两圈勾选框。 */
function protocolSegmentTrack(index = 0): HTMLElement {
  return document.querySelectorAll<HTMLElement>('div.inline-flex.items-stretch')[index]
}

function protocolSegments(index = 0): HTMLElement[] {
  return [...protocolSegmentTrack(index).querySelectorAll<HTMLElement>('button')]
}

/** 协议色条：主体格里那个绝对定位的 2px 竖线。 */
function gutters(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('span.absolute.w-0\\.5')]
}

/**
 * 让服务端按模型名回一份固定结论：转换模型失败（401，没有用量），原生模型成功。
 * `run` 是按任务调用的，用它请求的那组 `modelIds` 决定回哪一份。
 */
function stubRunResults() {
  vi.mocked(modelTestApi.run).mockImplementation(async (_protocol, _mode, filters) => {
    const modelId = filters?.modelIds?.[0] ?? 'm1'
    const native = modelId === 'm2'
    const result: ModelTestResult = {
      modelId,
      modelName: native ? NATIVE_MODEL : CONVERTING_MODEL,
      providerId: 'prov_1',
      providerName: PROVIDER_NAME,
      mode: 'connectivity',
      success: native,
      statusCode: native ? 200 : 401,
      durationMilliseconds: native ? 1500 : 300,
      ttftMilliseconds: native ? 120 : null,
      tokensPerSecond: native ? 3.25 : null,
      outputTokens: native ? 12345 : null,
      errorMessage: native ? undefined : 'invalid api key',
    }
    return { success: true, data: { results: [result] } }
  })
}

beforeEach(() => {
  vi.mocked(modelTestApi.run).mockReset()
})

function startTest() {
  fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.start') }))
}

describe('结果表的列划分', () => {
  it('表头六列，每列只写一个事实；协议不占列', async () => {
    renderPanel()
    selectProvider()

    const header = document.querySelector('[class*="tableHeaderClass"]') as HTMLElement
    // 表头是 `TableHeaderSurface`，它就是那一层带底色的横条。
    const headerSpan = header ?? document.querySelector('div.border-b.border-border\\/50') as HTMLElement
    const labels = [...headerSpan.querySelectorAll('span')].map(node => node.textContent)
    expect(labels).toEqual([
      zh('modelTest.table.target'),
      zh('modelTest.table.status'),
      zh('modelTest.table.ttft'),
      zh('modelTest.table.duration'),
      zh('modelTest.table.speed'),
      zh('modelTest.table.tokens'),
    ])
    // 从前那个装着「HTTP 码 + 输出 Token」的响应列没有了。
    expect(labels).not.toContain('协议')
    // 四个数字列右对齐，两个文字列左对齐：对齐方向本身就是「这一列拿来比大小」的信号。
    expect(headerSpan.querySelectorAll('span.text-right')).toHaveLength(4)
  })

  it('状态格只说状态，HTTP 码退进 title；输出 Token 在自己的列里，两者不再同格', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    // 三个协议各排一行，三行都失败，状态格都只说「失败」。
    await waitFor(() => { expect(screen.getAllByText(zh('modelTest.status.failed')).length).toBe(3) })

    for (const status of screen.getAllByText(zh('modelTest.status.failed'))) {
      expect(status.getAttribute('title')).toBe(`${zh('modelTest.status.failed')} · HTTP 401`)
    }

    // 失败那行没有用量：四个数字列全写 `—`，而不是把 401 塞进某一格里。
    const rows = tableRowsFor(CONVERTING_MODEL)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.textContent).not.toContain('HTTP')
      expect(row.textContent).not.toContain('401')
      expect([...row.querySelectorAll('div')].filter(node => node.textContent === '—').length).toBeGreaterThan(0)
    }
  })

  it('成功的行四个数字各就各位：TTFT / 耗时 / TPS / 输出 Token', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(screen.getByText(zh('modelTest.status.success'))).toBeTruthy() })

    const rows = tableRowsFor(NATIVE_MODEL)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.textContent).toContain('120ms')
    expect(row.textContent).toContain('1.5s')
    expect(row.textContent).toContain('3.3 t/s')
    // 进位只在一万以上：12345 折成 12.3k，而 9700 会原样写四位。
    expect(row.textContent).toContain('12.3k')
    // 成功那行也没有 HTTP 字样：状态码不该在任何一格里露出来。
    expect(row.textContent).not.toContain('HTTP')
  })
})

describe('协议色条', () => {
  it('转出来的协议换警告色，原生协议用中性色——一列一义，不抢状态列的颜色', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(gutters().length).toBe(4) })

    // 4 行：转换模型 3 个协议（completions 原生 + 2 个转换）、原生模型 1 个协议。
    expect(gutters().filter(node => node.className.includes('bg-warning'))).toHaveLength(2)
    expect(gutters().filter(node => node.className.includes('bg-primary/50'))).toHaveLength(2)
  })
})

describe('左侧勾选区', () => {
  it('协议分段是 role=checkbox，选中态落在 aria-checked 上（行级半选由它求和）', () => {
    renderPanel()
    selectProvider()

    const segments = protocolSegments(0)
    expect(segments).toHaveLength(3)
    // 全名上台面：缩写会引出第二个叫法（`Responses` vs `OpenAI Responses`），长为 4 行也认。
    expect(segments.map(node => node.textContent)).toEqual(['OpenAI Completions', 'Anthropic Messages', 'OpenAI Responses'])
    expect(segments.map(node => node.getAttribute('role'))).toEqual(['checkbox', 'checkbox', 'checkbox'])
    expect(segments.map(node => node.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
    // 满名不丢，进 title；转出来的那两个额外说明「是转的」。
    expect(segments[0].getAttribute('title')).toBe(PROTOCOL_DISPLAY_NAMES['openai-completions'])
    expect(segments[1].getAttribute('title')).toBe(zh('protocol.conversion.aria', { protocol: PROTOCOL_DISPLAY_NAMES['anthropic-messages'] }))

    fireEvent.click(segments[1])
    expect(protocolSegments(0)[1].getAttribute('aria-checked')).toBe('false')
    // 计数跟着分段走，不另外存一份。
    expect(screen.getByText('2/3 协议')).toBeTruthy()
  })

  it('计数带单位，不被读成「三个模型里选了两个」', () => {
    renderPanel()
    selectProvider()

    expect(screen.getByText('3/3 协议')).toBeTruthy()
    expect(screen.getByText('1/1 协议')).toBeTruthy()
    expect(screen.queryByText('3/3')).toBeNull()
  })

  it('展开渠道只多出模型行：不额外复述一遍协议，协议只在模型行里说', () => {
    renderPanel()
    expect(screen.queryAllByText(CONVERTING_MODEL)).toHaveLength(0)

    selectProvider()
    expect(screen.getAllByText(CONVERTING_MODEL).length).toBeGreaterThan(0)
    /*
     * 渠道这一层没有「协议」这个属性——协议长在模型端点上，一个模型可能三种都有。
     * 所以展开后如果多出一行渠道级协议，它要么是从下面几行求和出来的（重复），
     * 要么在说一件数据里并不存在的事（误导）。
     *
     * 协议名现在**正当地**出现在分段里，所以不能用「全文出现几次」来守这条：
     * 改成数**哪些容器**里出现。分段控件的那条槽（`div.inline-flex.items-stretch`）
     * 是唯一的合法容器，槽之外一个都不该有。
     */
    for (const name of Object.values(PROTOCOL_DISPLAY_NAMES)) {
      const nodes = screen.getAllByText(name)
      expect(nodes.length).toBeGreaterThan(0)
      const hosts = nodes.map(node => node.closest('div.inline-flex.items-stretch'))
      expect(hosts.filter(Boolean)).toHaveLength(hosts.length)
    }
  })
})
