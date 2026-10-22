// @vitest-environment jsdom

import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelTestTaskProgress, ModelTestTaskResult } from '@common/diagnostics'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import type { TaskRecord } from '@common/tasks'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { createAppTranslator } from '@common/i18n/catalogs'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { useAppUiStore } from '@/store/app-ui-store'
import { DEFAULT_TEST_CONFIG, useModelTestConfigStore } from '@/store/model-test-config'
import { MODEL_TEST_TASK_KIND } from '@/lib/model-test/tasks'
import { ModelTestPanel } from './model-test-panel'

/*
 * 诊断面板现在是**外壳级的非模态浮窗**，队列在服务端跑。这里守着四组约束：
 *
 * 1. **一格只放一个事实。** 状态列只说状态（HTTP 码退进 `title`），输出 Token 单列右对齐；
 *    协议单独成列——扫结果时最常问的就是「哪个协议挂了」。
 * 2. **每行能展开。** 展开后给出逐轮结果、成功率与错误原文；收起时不渲染明细。
 * 3. **非模态、可最小化。** 没有遮罩；最小化成角标时报「第几轮 / 已完成多少 / 挂了几个」。
 *    最小化 ≠ 关闭：关闭会先确认，确认后取消这一批。
 * 4. **面板卸载不中断在跑的任务。** 队列在服务端，界面卸载只是不看了——这是把队列从
 *    客户端搬走要换来的东西，也是「边看日志边等结果」的前提。
 *
 * 勾选区那两条也在这里：分段必须是 `role="checkbox"`（行级半选靠它求和），计数必须带单位。
 */

const harness = vi.hoisted(() => ({
  tasks: [] as TaskRecord[],
  enqueue: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/data/tasks', () => ({
  useTasks: () => ({ tasks: harness.tasks, enqueue: harness.enqueue, cancel: harness.cancel, clear: harness.clear }),
}))

const zh = createAppTranslator('zh-CN')

const PROVIDER_NAME = '示例渠道'
/** 只开了 completions，但开了协议转换：三个协议都可测，其中两个是转出来的。 */
const CONVERTING_MODEL = 'gpt-4o'
/** 原生只支持 anthropic-messages：可测协议就一个。 */
const NATIVE_MODEL = 'gpt-4o-mini'

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

vi.mock('@/data/provider-models', () => ({ useProviderModels: () => MODELS }))
vi.mock('@/data/providers', () => ({ useProviders: () => [provider()] }))
vi.mock('@/data/settings', () => ({ useSettings: () => null }))

/* ------------------------------------------------------------------ */
/* 服务端队列的替身                                                     */
/* ------------------------------------------------------------------ */

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    kind: MODEL_TEST_TASK_KIND,
    key: 'm1:openai-completions',
    status: 'queued',
    enqueuedAt: 1,
    ...overrides,
  }
}

function progress(overrides: Partial<ModelTestTaskProgress> = {}): ModelTestTaskProgress {
  return {
    modelId: 'm1',
    modelName: CONVERTING_MODEL,
    providerId: 'prov_1',
    providerName: PROVIDER_NAME,
    protocol: 'openai-completions',
    mode: 'streaming',
    round: 1,
    totalRounds: 3,
    result: null,
    ...overrides,
  }
}

function failedResult(overrides: Partial<ModelTestTaskResult> = {}): ModelTestTaskResult {
  return {
    modelId: 'm1',
    modelName: CONVERTING_MODEL,
    providerId: 'prov_1',
    providerName: PROVIDER_NAME,
    protocol: 'openai-completions',
    mode: 'streaming',
    success: false,
    statusCode: 401,
    durationMilliseconds: 300,
    errorMessage: 'invalid api key',
    rounds: [{ round: 1, success: false, statusCode: 401, durationMilliseconds: 300, errorMessage: 'invalid api key' }],
    ...overrides,
  }
}

function successResult(overrides: Partial<ModelTestTaskResult> = {}): ModelTestTaskResult {
  return {
    modelId: 'm2',
    modelName: NATIVE_MODEL,
    providerId: 'prov_1',
    providerName: PROVIDER_NAME,
    protocol: 'anthropic-messages',
    mode: 'streaming',
    success: true,
    statusCode: 200,
    durationMilliseconds: 1500,
    ttftMilliseconds: 120,
    tokensPerSecond: 3.25,
    outputTokens: 12345,
    // 命中率要能看到「真的算了」：1000 输入里 640 是缓存读回来的，就是 64.0%。
    inputTokens: 1000,
    cachedInputTokens: 640,
    rounds: [{ round: 1, success: true, statusCode: 200, durationMilliseconds: 1500, ttftMilliseconds: 120, tokensPerSecond: 3.25, outputTokens: 12345 }],
    ...overrides,
  }
}

/** 一批典型的台账：一个协议失败、一个协议在跑第二轮、原生模型成功，剩下一个还排着。 */
function mixedLedger(): TaskRecord[] {
  return [
    task({ id: 'task_failed', key: 'm1:anthropic-messages', status: 'failed', errorMessage: 'invalid api key', result: failedResult({ protocol: 'anthropic-messages' }) }),
    task({ id: 'task_running', key: 'm1:openai-completions', status: 'running', progress: progress({ round: 2, totalRounds: 3 }) }),
    task({ id: 'task_ok', key: 'm2:anthropic-messages', status: 'success', result: successResult() }),
    task({ id: 'task_queued', key: 'm1:openai-responses' }),
  ]
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function panelNode() {
  return (
    <I18nProvider>
      <ConfirmProvider>
        <ModelTestPanel />
      </ConfirmProvider>
    </I18nProvider>
  )
}

function renderPanel(tasks: TaskRecord[] = []) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  harness.tasks = tasks
  useAppUiStore.setState({ testPanelOpen: true, testPanelMinimized: false })
  return render(panelNode())
}

function renderPanelStrict(tasks: TaskRecord[] = []) {
  useLanguageStore.setState({ preference: 'zh-CN' })
  harness.tasks = tasks
  useAppUiStore.setState({ testPanelOpen: true, testPanelMinimized: false })
  return render(<StrictMode>{panelNode()}</StrictMode>)
}

/** 勾上唯一的渠道：面板打开时默认谁都不选，先勾上才有模型行与待测计划行。 */
function selectProvider() {
  fireEvent.click(screen.getByRole('checkbox', { name: PROVIDER_NAME }))
}

/** 结果行（整行可点，`aria-expanded` 挂在行上）。 */
function expandToggles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')]
}

function rowFor(text: string): HTMLElement {
  return expandToggles().find(row => row.textContent?.includes(text))!
}

/** 分段控件的凹槽（`PROTOCOL_TRACK_CLASS`）。限定在它里面找，就不会捞到渠道与模型那两圈勾选框。 */
function protocolSegments(index = 0): HTMLElement[] {
  const track = document.querySelectorAll<HTMLElement>('div.inline-flex.items-stretch')[index]
  return [...track.querySelectorAll<HTMLElement>('button')]
}

function startTest() {
  fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.start') }))
}

beforeEach(() => {
  harness.tasks = []
  harness.enqueue.mockReset().mockResolvedValue({ accepted: 1, skipped: 0 })
  harness.cancel.mockReset().mockResolvedValue(1)
  harness.clear.mockReset().mockResolvedValue(0)
  /*
   * 测试参数记在本机，而 store 是模块级的：不清就会把上一条用例调的轮次带到下一条里，
   * 断言看起来「明明没点过却是 3 轮」。localStorage 一并清掉，免得存档跨用例复活。
   */
  window.localStorage.clear()
  useModelTestConfigStore.setState({ config: DEFAULT_TEST_CONFIG })
  useAppUiStore.setState({ testPanelOpen: false, testPanelMinimized: false })
})

/* ------------------------------------------------------------------ */

describe('外壳级浮窗', () => {
  it('没有遮罩：面板只是浮在页面上，页面照旧可交互、可滚动', () => {
    const { container } = renderPanel()

    // Radix 的 DialogOverlay 是 `fixed inset-0 … backdrop-blur-xs`，它会压暗整页并吃掉点击。
    expect(container.querySelector('[data-radix-dialog-overlay], .backdrop-blur-xs')).toBeNull()
    // 浮窗本体是 `fixed` + 右下角。
    const floating = container.firstElementChild as HTMLElement
    expect(floating.className).toContain('fixed')
    expect(floating.className).toContain('bottom-4')
  })

  it('没打开时什么都不渲染（它挂在 App 上，不该在每一页留一个空壳）', () => {
    useAppUiStore.setState({ testPanelOpen: false, testPanelMinimized: false })
    const { container } = render(panelNode())

    expect(container.firstElementChild).toBeNull()
  })

  it('StrictMode 下点开始也能把整批任务发出去（清理不能把自己弄残）', async () => {
    renderPanelStrict()
    selectProvider()

    const start = screen.getByRole('button', { name: zh('modelTest.action.start') })
    expect(start.getAttribute('disabled')).toBeNull()
    fireEvent.click(start)

    await waitFor(() => { expect(harness.enqueue).toHaveBeenCalled() })
  })
})

describe('面板卸载不中断在跑的任务', () => {
  it('卸载时不发任何取消命令——队列在服务端，界面卸载只是不看了', () => {
    const { unmount } = renderPanel([task({ id: 'task_running', status: 'running', progress: progress({ round: 1, totalRounds: 3 }) })])
    selectProvider()

    unmount()

    // 导航到请求日志页 = 这个组件卸载。若这里出现一次 cancel，就等于「切页就掐掉计费中的请求」。
    expect(harness.cancel).not.toHaveBeenCalled()
    expect(harness.clear).not.toHaveBeenCalled()
  })

  it('重新挂载后还是同一条在跑的任务（状态不在组件里）', () => {
    const ledger = [task({ id: 'task_running', status: 'running', progress: progress({ round: 2, totalRounds: 3 }) })]
    const first = renderPanel(ledger)
    first.unmount()

    renderPanel(ledger)
    selectProvider()

    expect(screen.getByText(zh('modelTest.status.running'))).toBeTruthy()
    expect(rowFor(CONVERTING_MODEL)).toBeTruthy()
  })
})

describe('结果表的列划分', () => {
  it('表头八格，每列只写一个事实；协议单独成列', () => {
    renderPanel(mixedLedger())
    selectProvider()

    const header = document.querySelector<HTMLElement>('div.bg-inset.text-left')!
    const labels = [...header.querySelectorAll('span')].map(node => node.textContent)
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
    expect(header.querySelectorAll('span.text-right')).toHaveLength(4)
  })

  it('状态格只说状态，HTTP 码退进 title；输出 Token 在自己的列里', () => {
    renderPanel(mixedLedger())
    selectProvider()

    const failed = rowFor(CONVERTING_MODEL)
    const status = within(failed).getByTitle(`${zh('modelTest.status.failed')} · HTTP 401`)
    expect(status.textContent).toBe(zh('modelTest.status.failed'))
    // 状态码不该在任何一格里露出来。
    expect(failed.textContent).not.toContain('HTTP')
    expect(failed.textContent).not.toContain('401')
  })

  it('成功的行四个数字各就各位：TTFT / 耗时 / TPS / 输出 Token', () => {
    renderPanel(mixedLedger())
    selectProvider()

    const row = rowFor(NATIVE_MODEL)
    expect(row.textContent).toContain('120ms')
    expect(row.textContent).toContain('1.5s')
    expect(row.textContent).toContain('3.3 t/s')
    // 进位只在一万以上：12345 折成 12.3k，而 9700 会原样写四位。
    expect(row.textContent).toContain('12.3k')
    expect(row.textContent).not.toContain('HTTP')
  })

  it('排队中的行只有骨架：状态是「等待」，四列全写 —', () => {
    renderPanel([task({ id: 'task_queued', key: 'm1:openai-responses' })])
    selectProvider()

    const row = rowFor(CONVERTING_MODEL)
    expect(within(row).getByText(zh('modelTest.status.queued'))).toBeTruthy()
    expect([...row.querySelectorAll('div')].filter(node => node.textContent === '—')).toHaveLength(4)
  })
})

describe('协议列', () => {
  it('每行印出自己测的协议；转出来的协议带警告色标记', () => {
    renderPanel(mixedLedger())
    selectProvider()

    // 4 行：转换模型 3 个协议（completions 原生 + 2 个转换）、原生模型 1 个协议。
    const rows = expandToggles()
    const names = Object.values(PROTOCOL_DISPLAY_NAMES)
    for (const row of rows) {
      expect(names.filter(name => row.textContent?.includes(name))).toHaveLength(1)
    }
    // 转出来的协议走 warning 色，直连的不上色：4 行里只有 2 行是直连。
    expect(rows.filter(row => row.querySelector('span.text-text-warning'))).toHaveLength(2)
  })
})

describe('展开逐轮明细', () => {
  it('收起时不渲染明细，点开才出现指标块与逐轮行', () => {
    renderPanel(mixedLedger())
    selectProvider()

    expect(screen.queryByText(zh('modelTest.detail.successRate'))).toBeNull()

    const failedRow = rowFor(CONVERTING_MODEL)
    expect(failedRow.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(failedRow)
    expect(failedRow.getAttribute('aria-expanded')).toBe('true')

    // 单轮失败：0/1 轮成功，错误原文也在明细里。
    expect(within(failedRow).getByText('0/1 · 0%')).toBeTruthy()
    expect(within(failedRow).getByText('invalid api key')).toBeTruthy()

    fireEvent.click(rowFor(CONVERTING_MODEL))
    expect(screen.queryByText(zh('modelTest.detail.successRate'))).toBeNull()
  })

  it('汇总是一排指标块：成功率、首字、TPS、缓存命中率各占一格', () => {
    renderPanel(mixedLedger())
    selectProvider()

    const nativeRow = rowFor(NATIVE_MODEL)
    fireEvent.click(nativeRow)

    expect(within(nativeRow).getByText('1/1 · 100%')).toBeTruthy()
    const cards = [...nativeRow.querySelectorAll<HTMLElement>('[data-slot="metric-card"]')]
    expect(cards.map(card => card.firstElementChild?.textContent)).toEqual([
      zh('modelTest.detail.successRate'),
      zh('modelTest.detail.ttft'),
      zh('modelTest.detail.tps'),
      zh('modelTest.detail.cacheHitRate'),
    ])
    expect(cards[2].lastElementChild?.textContent).toBe('3.3 t/s')
    // 命中率是 640 ÷ 1000，与请求详情同一个 `formatPercent` 口径（一位小数）。
    expect(cards[3].lastElementChild?.textContent).toBe('64.0%')
    expect(within(nativeRow).getByText(zh('modelTest.detail.round', { round: 1 }))).toBeTruthy()
  })

  it('多轮时逐轮列出来，成功率按轮次算（总账失败、其中一轮通过）', () => {
    renderPanel([task({
      id: 'task_rounds',
      key: 'm1:openai-completions',
      status: 'failed',
      errorMessage: 'rate limited',
      result: failedResult({
        success: false,
        statusCode: 429,
        errorMessage: 'rate limited',
        rounds: [
          { round: 1, success: true, statusCode: 200, durationMilliseconds: 600, outputTokens: 12 },
          { round: 2, success: false, statusCode: 429, durationMilliseconds: 1000, errorMessage: 'rate limited' },
        ],
      }),
    })])
    selectProvider()

    const row = rowFor(CONVERTING_MODEL)
    fireEvent.click(row)

    expect(within(row).getByText('1/2 · 50%')).toBeTruthy()
    expect(within(row).getByText(zh('modelTest.detail.round', { round: 1 }))).toBeTruthy()
    expect(within(row).getByText(zh('modelTest.detail.round', { round: 2 }))).toBeTruthy()
    expect(within(row).getByText('rate limited')).toBeTruthy()
  })
})

describe('左侧勾选区', () => {
  it('协议分段是 role=checkbox，选中态落在 aria-checked 上（行级半选由它求和）', () => {
    renderPanel()
    selectProvider()

    const segments = protocolSegments()
    expect(segments).toHaveLength(3)
    // 全名上台面：缩写会引出第二个叫法。
    // 名字取契约里的那一份，不在测试里抄字符串：协议名是全系统唯一的写法，抄一份就会漂。
    expect(segments.map(node => node.textContent)).toEqual([
      PROTOCOL_DISPLAY_NAMES['openai-completions'],
      PROTOCOL_DISPLAY_NAMES['anthropic-messages'],
      PROTOCOL_DISPLAY_NAMES['openai-responses'],
    ])
    expect(segments.map(node => node.getAttribute('role'))).toEqual(['checkbox', 'checkbox', 'checkbox'])
    expect(segments.map(node => node.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
    // 满名不丢，进 title；转出来的那两个额外说明「是转的」。
    expect(segments[1].getAttribute('title')).toBe(zh('protocol.conversion.aria', { protocol: PROTOCOL_DISPLAY_NAMES['anthropic-messages'] }))

    fireEvent.click(segments[1])
    expect(protocolSegments()[1].getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('2/3 协议')).toBeTruthy()
  })

  it('计数带单位，不被读成「三个模型里选了两个」', () => {
    renderPanel()
    selectProvider()

    expect(screen.getByText('3/3 协议')).toBeTruthy()
    expect(screen.getByText('1/1 协议')).toBeTruthy()
    expect(screen.queryByText('3/3')).toBeNull()
  })
})

describe('开始诊断：把整批行交给服务端队列', () => {
  it('一行一个载荷，参数是开跑那一刻的快照', async () => {
    renderPanel()
    selectProvider()

    startTest()

    await waitFor(() => { expect(harness.enqueue).toHaveBeenCalled() })
    const [kind, items] = harness.enqueue.mock.calls[0]
    expect(kind).toBe(MODEL_TEST_TASK_KIND)
    // 4 行：转换模型 3 个协议 + 原生模型 1 个协议。
    expect(items).toHaveLength(4)
    expect(items[0]).toEqual({
      modelId: 'm1',
      providerId: 'prov_1',
      protocol: 'openai-completions',
      mode: 'streaming',
      rounds: 1,
      inputLength: 0,
    })
    // 空提示词不发：让服务端按模式取默认，两边口径一致。
    expect(items[0].prompt).toBeUndefined()
  })

  it('配置页改的轮次随这一批走，并发不在界面里', async () => {
    renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    const roundsRow = screen.getByText(zh('modelTest.config.rounds')).closest('div.flex') as HTMLElement
    const plus = [...roundsRow.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '+')!
    fireEvent.click(plus)
    fireEvent.click(plus)

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.back') }))
    startTest()

    await waitFor(() => { expect(harness.enqueue).toHaveBeenCalled() })
    expect(harness.enqueue.mock.calls[0][1][0]).toMatchObject({ rounds: 3, inputLength: 0 })
  })

  it('在跑时「开始」换成「停止」：停止按 kind 取消，不逐条点', () => {
    renderPanel([task({ id: 'task_running', status: 'running', progress: progress() })])
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.stop') }))

    expect(harness.cancel).toHaveBeenCalledWith({ kind: MODEL_TEST_TASK_KIND })
  })
})

describe('测试配置页', () => {
  it('设置按钮在开始按钮左边，点开后换到配置页而不是再叠一层浮窗', () => {
    renderPanel()
    selectProvider()

    const settings = screen.getByRole('button', { name: zh('modelTest.action.settings') })
    const start = screen.getByRole('button', { name: zh('modelTest.action.start') })
    expect(settings.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(settings)
    expect(screen.getByText(zh('modelTest.config.rounds'))).toBeTruthy()
    expect(screen.getByText(zh('modelTest.config.inputLength'))).toBeTruthy()
    expect(screen.getByText(zh('modelTest.config.prompt'))).toBeTruthy()
    // 结果表与开始按钮都不在了——是换页，不是叠层。
    expect(screen.queryByRole('button', { name: zh('modelTest.action.start') })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.back') }))
    expect(screen.getByRole('button', { name: zh('modelTest.action.start') })).toBeTruthy()
  })

  it('「恢复默认」是用户主动按的：重置之后值是默认的', () => {
    renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.settings') }))
    const row = screen.getByText(zh('modelTest.config.rounds')).closest('div.flex') as HTMLElement
    const plus = [...row.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '+')!
    fireEvent.click(plus)
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.config.reset') }))
    expect(Number((screen.getByLabelText(zh('modelTest.config.rounds')) as HTMLInputElement).value)).toBe(1)
    expect(useModelTestConfigStore.getState().config).toEqual(DEFAULT_TEST_CONFIG)
  })
})

describe('最小化成角标', () => {
  /** 面板已经打开、任务在跑时缩小；角标就是「你在干别的事时唯一会看的一行」。 */
  function minimize(tasks: TaskRecord[]) {
    renderPanel(tasks)
    selectProvider()
    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.minimize') }))
  }

  it('跑的时候能收起来，不取消任何任务', () => {
    minimize([task({ id: 'task_running', status: 'running', progress: progress({ round: 2, totalRounds: 3 }) })])

    expect(harness.cancel).not.toHaveBeenCalled()
    // 主体收起了，角标在。
    expect(screen.queryByRole('button', { name: zh('modelTest.action.start') })).toBeNull()
    expect(screen.getByRole('button', { name: zh('modelTest.action.expand') })).toBeTruthy()
  })

  it('角标报「第 N/M 轮」与「已完成/总数」', () => {
    minimize(mixedLedger())

    expect(screen.getByText(zh('modelTest.badge.round', { round: 2, total: 3 }))).toBeTruthy()
    // 4 行里已有结局的 2 行（一失败一成功），在跑的一行与在排的一行都不算完成。
    expect(screen.getByText(zh('modelTest.badge.completed', { completed: 2, total: 4 }))).toBeTruthy()
  })

  it('失败数必须主动说出来：边看日志时你只想知道挂了几个', () => {
    minimize(mixedLedger())

    expect(screen.getByText(zh('modelTest.badge.failed', { count: 1 }))).toBeTruthy()
  })

  it('没有行在跑时角标说「全部结束」，不说「第 0 轮」', () => {
    minimize([task({ id: 'task_ok', key: 'm2:anthropic-messages', status: 'success', result: successResult() })])

    expect(screen.queryByText(zh('modelTest.badge.round', { round: 0, total: 0 }))).toBeNull()
    // 计划里还有 4 个目标（勾上渠道后默认全选），已经结束的是 1 个。
    expect(screen.getByText(zh('modelTest.badge.summary', { total: 4, failed: 0 }))).toBeTruthy()
  })

  it('一键展开：回到浮窗，任务还在跑', () => {
    minimize([task({ id: 'task_running', status: 'running', progress: progress() })])

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.expand') }))

    expect(useAppUiStore.getState().testPanelMinimized).toBe(false)
    // 浮窗本体回来了：最小化按钮在，且那条在跑的任务还在表里。
    expect(screen.getByRole('button', { name: zh('modelTest.action.minimize') })).toBeTruthy()
    expect(screen.getByText(zh('modelTest.status.running'))).toBeTruthy()
    expect(harness.cancel).not.toHaveBeenCalled()
  })

  it('角标上的停止按钮只取消，不展开', () => {
    minimize([task({ id: 'task_running', status: 'running', progress: progress() })])

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.stop') }))

    expect(harness.cancel).toHaveBeenCalledWith({ kind: MODEL_TEST_TASK_KIND })
    expect(useAppUiStore.getState().testPanelMinimized).toBe(true)
  })
})

describe('关闭 = 收摊', () => {
  it('没在跑时直接关，不问也不取消', () => {
    renderPanel()
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.close') }))

    expect(useAppUiStore.getState().testPanelOpen).toBe(false)
    expect(harness.cancel).not.toHaveBeenCalled()
  })

  it('跑着要关先确认：确认后取消这一批', async () => {
    renderPanel([task({ id: 'task_running', status: 'running', progress: progress() })])
    selectProvider()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.action.close') }))
    // 确认框出现之前什么都没发生。
    expect(harness.cancel).not.toHaveBeenCalled()
    expect(screen.getByText(zh('modelTest.confirm.close.title'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh('modelTest.confirm.close.confirm') }))

    await waitFor(() => { expect(harness.cancel).toHaveBeenCalledWith({ kind: MODEL_TEST_TASK_KIND }) })
    await waitFor(() => { expect(useAppUiStore.getState().testPanelOpen).toBe(false) })
  })
})
