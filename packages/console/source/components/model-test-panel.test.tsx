// @vitest-environment jsdom

import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { DEFAULT_TEST_CONFIG, useModelTestConfigStore } from '@/store/model-test-config'
import type { ModelTestResult } from '@/api/tools'
import { ModelTestPanel } from './model-test-panel'

/*
 * 渠道诊断面板的两条设计约束都在这儿守着。它们是「扫一眼就知道」的层次的问题，
 * 也正是最容易在后续改动里被推回去的部分：
 *
 * 1. **一格只放一个事实。** 结果表最后一格原本是「HTTP 404 ↓1234」：协议结论与产出量
 *    是两个量纲，挤在一格里读起来像一句话，横向比对时又只能整格从七零八落的宽度里找。
 *    现在状态列只说状态（HTTP 码退进 `title`），输出 Token 单列右对齐。
 * 2. **协议单独成列。** 一行就是一个「模型 × 协议」，扫结果时最常问的就是「哪个协议挂了」，
 *    所以协议进自己的列，色条退场（色条只能表达「是转出来的」，说不出「测的是哪个协议」）。
 * 3. **每行能展开。** 展开后给出逐轮结果、成功率与错误原文；收起时不渲染明细。
 * 4. **协议只属于模型，不属于渠道。** 数据里协议长在模型端点上，一个模型可能三种协议
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

function panelNode(open: boolean) {
  return (
    <I18nProvider>
      <ModelTestPanel open={open} models={MODELS} providers={[provider()]} onOpenChange={() => {}} />
    </I18nProvider>
  )
}

function renderPanel() {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(panelNode(true))
}

/**
 * 套一层 StrictMode 渲染。
 *
 * 真实应用就是套着的（`shell/providers.tsx` 里 `mountShell`），而 StrictMode 会把
 * 每个 effect 「挂载 → 清理 → 再挂载」跑一遍。普通 `render()` 跳过了这一步，
 * 于是「清理做了什么」这类缺陷在测试里完全看不见——这正是一整类
 * 「点开始诊断毫无反应」的缺陷能长期藏在绿灯后面的原因。
 */
function renderPanelStrict() {
  useLanguageStore.setState({ preference: 'zh-CN' })
  return render(<StrictMode>{panelNode(true)}</StrictMode>)
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
 * 结果行是整行可点的那枚 `role="button"`（展开明细用），用它把行筛出来。
 */
function tableRowsFor(modelName: string): HTMLElement[] {
  return screen.getAllByText(modelName)
    .map(node => node.closest('[role="button"][aria-expanded]'))
    .filter((row): row is HTMLElement => Boolean(row))
}

/** 分段控件的凹槽（`PROTOCOL_TRACK_CLASS`）。限定在它里面找，就不会捞到渠道与模型那两圈勾选框。 */
function protocolSegmentTrack(index = 0): HTMLElement {
  return document.querySelectorAll<HTMLElement>('div.inline-flex.items-stretch')[index]
}

function protocolSegments(index = 0): HTMLElement[] {
  return [...protocolSegmentTrack(index).querySelectorAll<HTMLElement>('button')]
}

/** 结果行最左侧那枚展开箭头（`aria-expanded` 挂在行上）。 */
function expandToggles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')]
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
      mode: 'streaming',
      success: native,
      statusCode: native ? 200 : 401,
      durationMilliseconds: native ? 1500 : 300,
      ttftMilliseconds: native ? 120 : null,
      tokensPerSecond: native ? 3.25 : null,
      outputTokens: native ? 12345 : null,
      // 命中率要能看到「真的算了」：1000 输入里 640 是缓存读回来的，就是 64.0%。
      inputTokens: native ? 1000 : null,
      cachedInputTokens: native ? 640 : null,
      errorMessage: native ? undefined : 'invalid api key',
    }
    return { success: true, data: { results: [result] } }
  })
}

beforeEach(() => {
  vi.mocked(modelTestApi.run).mockReset()
  /*
   * 测试参数记在本机，而 store 是模块级的：不清就会把上一条用例调的轮次带到下一条里，
   * 断言看起来「明明没点过却是 3 轮」。localStorage 一并清掉，免得存档跨用例复活。
   */
  window.localStorage.clear()
  useModelTestConfigStore.setState({ config: DEFAULT_TEST_CONFIG })
})

function startTest() {
  fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.start') }))
}

/*
 * 「点开始诊断毫无反应」这道防线。
 *
 * 真实应用把整棵树套在 `React.StrictMode` 里，StrictMode 会把每个 effect
 * 「挂载 → 清理 → 再挂载」跑一遍。清理里只要做了不可逆的事，组件就在挂载那一刻
 * 把自己弄残了，而界面上**什么都不会变**：按钮没变灰、没有报错、也没有请求——
 * 用户唯一能观察到的就是「点了没反应」。
 *
 * 这一组用例的全部价值在于**用 StrictMode 渲染**。普通 `render()` 里这些断言
 * 一样绿，而应用是坏的。
 */
describe('StrictMode 下点「开始诊断」', () => {
  it('按钮可用，并且真的把请求发出去', async () => {
    stubRunResults()
    renderPanelStrict()
    selectProvider()

    // 先确认门是开的：`disabled` 的按钮点了本来就不会有反应，那是另一个缺陷。
    const start = screen.getByRole('button', { name: zh('modelTest.action.start') })
    expect(start.getAttribute('disabled')).toBeNull()

    fireEvent.click(start)
    await waitFor(() => { expect(modelTestApi.run).toHaveBeenCalled() })
  })

  it('各模型默认全选可测协议：清理重跑不能把它们清空', () => {
    renderPanelStrict()
    selectProvider()

    /*
     * 曾经的事故：校正 effect 给每个模型 materialize 一个空集，而待测计划的默认值是
     * 「没存过就全部可测协议」——空集不是「没存过」，它绕过了那个默认值。
     * StrictMode 让这个 effect 立刻跑第二遍，面板一打开待测计划就归零。
     *
     * 勾上渠道后仍然要有计划：一个模型（三个可测协议）+ 一个模型（一个可测协议）。
     */
    expect(screen.getByRole('button', { name: zh('modelTest.action.start') }).getAttribute('disabled')).toBeNull()
  })
})

describe('结果表的列划分', () => {
  it('表头七列，每列只写一个事实；协议单独成列', async () => {
    renderPanel()
    selectProvider()

    const header = document.querySelector('[class*="tableHeaderClass"]') as HTMLElement
    // 表头是 `TableHeaderSurface`，它就是那一层带底色的横条。
    const headerSpan = header ?? document.querySelector('div.border-b.border-border\\/50') as HTMLElement
    const labels = [...headerSpan.querySelectorAll('span')].map(node => node.textContent)
    // 第一格空着：下面是每行的展开箭头，那一列不需要列名。
    expect(labels).toEqual([
      '',
      zh('modelTest.table.target'),
      zh('modelTest.table.protocol'),
      zh('modelTest.table.status'),
      zh('modelTest.table.ttft'),
      zh('modelTest.table.duration'),
      zh('modelTest.table.speed'),
      zh('modelTest.table.tokens'),
    ])
    // 四个数字列右对齐，其余文字列左对齐：对齐方向本身就是「这一列拿来比大小」的信号。
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

describe('协议列', () => {
  it('每行印出自己测的协议；转出来的协议带警告色标记', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(expandToggles()).toHaveLength(4) })

    // 4 行：转换模型 3 个协议（completions 原生 + 2 个转换）、原生模型 1 个协议。
    const rows = expandToggles()
    /*
     * 协议名在结果行里出现：扫结果时最常问的就是「哪个协议挂了」。
     * 一格里只说一个协议，所以逐行数「这一行命中了几个协议名」必须正好是 1——
     * 用「全文某协议名出现几次」来数会串台：anthropic-messages 两个模型都在测。
     */
    const names = Object.values(PROTOCOL_DISPLAY_NAMES)
    for (const row of rows) {
      expect(names.filter(name => row.textContent?.includes(name))).toHaveLength(1)
    }
    expect(rows.filter(row => row.textContent?.includes(PROTOCOL_DISPLAY_NAMES['openai-completions']))).toHaveLength(1)
    expect(rows.filter(row => row.textContent?.includes(PROTOCOL_DISPLAY_NAMES['openai-responses']))).toHaveLength(1)
    // 转出来的协议走 warning 色（与左栏分段控件同一套语义），直连的不上色。
    // 4 行里只有「原始协议」那两行是直连：转换模型 × completions、原生模型 × anthropic-messages。
    expect(rows.filter(row => row.querySelector('span.text-text-warning'))).toHaveLength(2)
  })
})

describe('展开逐轮明细', () => {
  it('收起时不渲染明细，点开才出现指标块与逐轮行', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(expandToggles()).toHaveLength(4) })
    expect(screen.queryByText(zh('modelTest.detail.successRate'))).toBeNull()

    const failedRow = expandToggles().find(row => row.textContent?.includes(CONVERTING_MODEL))!
    expect(failedRow.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(failedRow)

    await waitFor(() => { expect(screen.getAllByText(zh('modelTest.detail.successRate')).length).toBe(1) })
    expect(expandToggles().find(row => row.textContent?.includes(CONVERTING_MODEL))!.getAttribute('aria-expanded')).toBe('true')
    // 单轮失败：0/1 轮成功，错误原文也在明细里。
    // 断言限定在这一行里：同一个模型排了三条任务，三条的失败原文都一样。
    const detail = within(failedRow).getByText(zh('modelTest.detail.successRate')).closest('div.col-span-full') as HTMLElement
    expect(within(detail).getByText('0/1 · 0%')).toBeTruthy()
    expect(within(detail).getByText('invalid api key')).toBeTruthy()

    // 再点一次收起，明细从 DOM 里消失。
    fireEvent.click(expandToggles().find(row => row.textContent?.includes(CONVERTING_MODEL))!)
    await waitFor(() => { expect(screen.queryByText(zh('modelTest.detail.successRate'))).toBeNull() })
  })

  it('汇总是一排指标块：成功率、首字、TPS、缓存命中率各占一格', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(expandToggles()).toHaveLength(4) })
    const nativeRow = expandToggles().find(row => row.textContent?.includes(NATIVE_MODEL))!
    fireEvent.click(nativeRow)

    await waitFor(() => { expect(within(nativeRow).getByText('1/1 · 100%')).toBeTruthy() })

    /*
     * 只在指标格里找：同一个词（TTFT / TPS / 输出 Token）在下面的逐轮表头里也有一份，
     * 在整行范围里断言会撞上「找到多个元素」。指标格是这一段唯一该被守的东西。
     */
    const cards = [...nativeRow.querySelectorAll<HTMLElement>('[data-slot="metric-card"]')]
    const labels = cards.map(card => card.firstElementChild?.textContent)
    // 四格：耗时在上面的结果行里已有一格，Token 用量逐轮列在下面，不在这里重复。
    expect(labels).toEqual([
      zh('modelTest.detail.successRate'),
      zh('modelTest.detail.ttft'),
      zh('modelTest.detail.tps'),
      zh('modelTest.detail.cacheHitRate'),
    ])
    // `t/s` 是数值的一部分，不是另一列标签。
    expect(cards[2].lastElementChild?.textContent).toBe('3.3 t/s')
    // 命中率是 640 ÷ 1000，与请求详情同一个 `formatPercent` 口径（一位小数）。
    expect(cards[3].lastElementChild?.textContent).toBe('64.0%')

    // 逐轮表在下，两种读数不互相替代。
    expect(within(nativeRow).getByText(zh('modelTest.detail.round', { round: 1 }))).toBeTruthy()
  })

  it('服务端给了逐轮记录就逐轮列出来，成功率按轮次算（见下方）', async () => {
    vi.mocked(modelTestApi.run).mockImplementation(async () => ({
      success: true,
      data: {
        results: [{
          modelId: 'm1',
          modelName: CONVERTING_MODEL,
          providerId: 'prov_1',
          providerName: PROVIDER_NAME,
          mode: 'streaming',
          // 两轮里挂了一轮：总账算失败，这正是「多轮才能看出稳定性」的用处。
          success: false,
          statusCode: 429,
          durationMilliseconds: 800,
          errorMessage: 'rate limited',
          rounds: [
            { round: 1, success: true, statusCode: 200, durationMilliseconds: 600, outputTokens: 12 },
            { round: 2, success: false, statusCode: 429, durationMilliseconds: 1000, errorMessage: 'rate limited' },
          ],
        }],
      },
    }))
    renderPanel()
    selectProvider()
    startTest()

    await waitFor(() => { expect(expandToggles().length).toBeGreaterThan(0) })
    const row = expandToggles()[0]
    fireEvent.click(row)

    await waitFor(() => { expect(within(row).getByText('1/2 · 50%')).toBeTruthy() })
    expect(within(row).getByText(zh('modelTest.detail.round', { round: 1 }))).toBeTruthy()
    expect(within(row).getByText(zh('modelTest.detail.round', { round: 2 }))).toBeTruthy()
    expect(within(row).getByText('rate limited')).toBeTruthy()
  })

  it('第一轮回来的那一刻：正在跑的行报「第 N/M 轮」，并带上该轮的读数', async () => {
    /*
     * issue #119 的界面侧验收：慢上游下，第一轮一完成就该在界面上看得见——而不是一整行
     * 干等。这里让服务端挂住不回，然后手动推一帧进度，断言的就是那个中间状态。
     */
    const held: ((value: unknown) => void)[] = []
    vi.mocked(modelTestApi.run).mockImplementation((_protocol, _mode, filters, _options, handlers) => {
      const modelId = filters?.modelIds?.[0] ?? 'm1'
      handlers?.onProgress?.({
        protocolVersion: 1,
        type: 'progress',
        modelId,
        providerId: 'prov_1',
        round: 1,
        totalRounds: 2,
        result: {
          modelId,
          modelName: CONVERTING_MODEL,
          providerId: 'prov_1',
          providerName: PROVIDER_NAME,
          mode: 'streaming',
          success: true,
          statusCode: 200,
          durationMilliseconds: 1500,
          outputTokens: 12345,
          rounds: [{ round: 1, success: true, statusCode: 200, durationMilliseconds: 1500, outputTokens: 12345 }],
        },
      })
      return new Promise<never>(resolve => { held.push(resolve as (value: unknown) => void) })
    })
    // 轮次填 2：M 不是界面自己数出来的，它来自服务端那一帧。
    useModelTestConfigStore.setState({ config: { ...DEFAULT_TEST_CONFIG, rounds: 2 } })
    renderPanel()
    selectProvider()
    startTest()

    const runningLabel = zh('modelTest.status.runningRound', { round: 1, total: 2 })
    await waitFor(() => { expect(screen.getAllByText(runningLabel).length).toBeGreaterThan(0) })
    // 读数同时到位：耗时那一格已经是这次尝试的耗时，而不是 `—`。
    expect(screen.getAllByText('1.5s').length).toBeGreaterThan(0)

    // 收尾：让挂住的请求回来，不留下永不落定的 Promise。
    for (const resolve of held) resolve({ success: true, data: { results: [] } })
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
     * 协议名现在**正当地**出现在两处：左栏分段、以及右侧结果行的协议列。
     * 所以这条约束只看左栏（结果行是另一回事），并在左栏里只认分段控件那条槽
     * （`div.inline-flex.items-stretch`）——槽之外一个都不该有。
     */
    const aside = document.querySelector('aside') as HTMLElement
    for (const name of Object.values(PROTOCOL_DISPLAY_NAMES)) {
      const nodes = within(aside).getAllByText(name)
      expect(nodes.length).toBeGreaterThan(0)
      const hosts = nodes.map(node => node.closest('div.inline-flex.items-stretch'))
      expect(hosts.filter(Boolean)).toHaveLength(hosts.length)
    }
  })
})

describe('测试配置页', () => {
  it('设置按钮在开始按钮左边，点开后换到配置页而不是再叠一层弹窗', () => {
    renderPanel()
    selectProvider()

    const settings = screen.getByRole('button', { name: zh('modelTest.action.settings') })
    const start = screen.getByRole('button', { name: zh('modelTest.action.start') })
    // 同一个动作区里，设置在开始之前（DOM 顺序即视觉顺序）。
    expect(settings.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(settings)
    expect(screen.getByText(zh('modelTest.config.concurrency'))).toBeTruthy()
    expect(screen.getByText(zh('modelTest.config.rounds'))).toBeTruthy()
    expect(screen.getByText(zh('modelTest.config.inputLength'))).toBeTruthy()
    expect(screen.getByText(zh('modelTest.config.prompt'))).toBeTruthy()
    // 结果表与开始按钮都不在了——是换页，不是叠层。
    expect(screen.queryByRole('button', { name: zh('modelTest.action.start') })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.back') }))
    expect(screen.getByRole('button', { name: zh('modelTest.action.start') })).toBeTruthy()
  })

  it('轮次与并发随请求一起发出去，提示词留空就不发', async () => {
    stubRunResults()
    renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    // 「测试轮次」那一条的 + 按钮：点两下从 1 变成 3。
    const roundsRow = screen.getByText(zh('modelTest.config.rounds')).closest('div.flex') as HTMLElement
    const plus = [...roundsRow.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '+')!
    fireEvent.click(plus)
    fireEvent.click(plus)

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.back') }))
    startTest()

    await waitFor(() => { expect(modelTestApi.run).toHaveBeenCalled() })
    const options = vi.mocked(modelTestApi.run).mock.calls[0][3]
    expect(options).toMatchObject({ rounds: 3, inputLength: 0 })
    // 空提示词不发：让服务端按模式取默认，两边口径一致。
    expect(options?.prompt).toBeUndefined()
  })

  /** 「测试轮次」那一条里的 + 按钮。 */
  function roundsPlus(): HTMLElement {
    const row = screen.getByText(zh('modelTest.config.rounds')).closest('div.flex') as HTMLElement
    return [...row.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '+')!
  }

  it('关掉面板再打开，上一回填的轮次还在（记在本机）', () => {
    const { rerender } = renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    fireEvent.click(roundsPlus())
    fireEvent.click(roundsPlus())
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(3)

    // 关掉再打开：参数不在这里复位，因为它是「这台机器上习惯怎么测」，不是这一次的值。
    rerender(panelNode(false))
    rerender(panelNode(true))

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(3)
  })

  it('「恢复默认」是用户主动按的：重置之后重开仍是默认值', () => {
    renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    fireEvent.click(roundsPlus())
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.reset') }))
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(1)
    expect(useModelTestConfigStore.getState().config).toEqual(DEFAULT_TEST_CONFIG)
  })
})
