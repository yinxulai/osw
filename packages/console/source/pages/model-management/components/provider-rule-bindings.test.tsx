// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestRewriteRule } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ProviderRuleBindings } from './provider-rule-bindings'

/*
 * 供应商模型上的「请求重写」绑定区。
 *
 * 这块界面上有两件容易被忽略但代价不小的事：
 *
 *  1. **全局规则是只读的，而且必须露出来。** 它自动生效、不可编辑，但用户在这块地方
 *     排查「为什么请求体被改了」时，第一眼要能看到它。所以全局规则排在普通规则前面、
 *     只给一个「全局」徽标、既没有开关也没有删除按钮。
 *  2. **普通规则的两个开关是「与」的关系。** 绑定自己的启用状态与规则本体的启用状态
 *     同时为真才算生效（`binding.enabled && rule.enabled`）。只读一个开关会把
 *     「看着开着、其实不生效」画成正常的。
 *
 * 另外**每次改动都整段替换绑定列表**（`replaceRequestRewriteRules`）：顺序就是优先级，
 * 传出去的是数组下标，所以增删之后必须按界面上的顺序重新编号。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

const state = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
  list: vi.fn(),
  bindings: vi.fn(),
  replace: vi.fn(),
}))

/*
 * `useToast()` 的返回值引用必须恒定。
 *
 * 组件把它写进了 `useEffect` 的依赖数组（`[providerModelId, toast, t]`），而 effect 里
 * 会 `setState`。如果这里每次调用都新建一个对象，就会变成
 * 「跑 effect → setState → 重渲染 → toast 引用又变了 → 再跑 effect」的无限同步循环，
 * 整个用例不会失败、只会挂死（与 `ToastProvider` 把 value 提到模块作用域的原因相同）。
 */
vi.mock('@/components/ui/toast', () => {
  const noop = vi.fn()
  const value = { toast: noop, success: state.success, error: state.error, info: noop, warning: noop }
  return { useToast: () => value }
})

vi.mock('@/api/models', () => ({
  requestRewriteRuleApi: { list: () => state.list() },
  providerModelApi: {
    requestRewriteRules: (id: string) => state.bindings(id),
    replaceRequestRewriteRules: (id: string, bindings: unknown) => state.replace(id, bindings),
  },
}))

function rule(overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
  return {
    id: 'rule_1',
    name: 'Rule One',
    description: '描述一',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'user',
    match: {},
    actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: '1' }],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    providerModelId: 'pm_a',
    ruleId: 'rule_1',
    priority: 0,
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

interface RenderBindingsProps { providerModelId?: string }

function renderBindings(props: RenderBindingsProps = {}) {
  return render(
    <I18nProvider>
      <ProviderRuleBindings providerModelId={props.providerModelId ?? 'pm_a'} />
    </I18nProvider>,
  )
}

/** 「添加规则」按钮：加载中 / 加载失败 / 没有可添加项时都必须禁掉。 */
function addButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '添加规则' })
}

/** 行首的序号 chip——它就是这个绑定当前生效的优先级。 */
function indexOf(name: string): string {
  const grip = screen.getByLabelText(`调整 ${name} 顺序`)
  return (grip.parentElement as HTMLElement).querySelector('span')?.textContent ?? ''
}

beforeEach(() => {
  useLanguageStore.setState({ preference: 'zh-CN' })
  state.success.mockReset()
  state.error.mockReset()
  state.list.mockReset().mockResolvedValue({ success: true, data: [rule()] })
  state.bindings.mockReset().mockResolvedValue({ success: true, data: [] })
  state.replace.mockReset().mockResolvedValue({ success: true, data: [] })
})

describe('加载', () => {
  it('两个请求都在路上时不给点「添加规则」（不能对着还没读到的列表追加）', async () => {
    let resolveList: (value: unknown) => void = () => {}
    state.list.mockReturnValue(new Promise(resolve => { resolveList = resolve }))
    renderBindings()

    expect(addButton().disabled).toBe(true)

    await act(async () => { resolveList({ success: true, data: [rule()] }) })

    // 列表读到了，可添加项从 0 变成 1，按钮才解禁。
    await waitFor(() => expect(addButton().disabled).toBe(false))
  })

  it('两个请求都打到传进来的那个供应商模型上', async () => {
    renderBindings({ providerModelId: 'pm_z' })

    await waitFor(() => expect(state.bindings).toHaveBeenCalledWith('pm_z'))
  })
})

describe('全局规则', () => {
  it('全局规则排在普通规则前面，而且只给徽标——没有开关、没有删除按钮', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_normal', name: '普通规则' }), rule({ id: 'rule_global', name: '全局规则', scope: 'global' })],
    })
    renderBindings()

    await screen.findByText('全局规则')
    expect(indexOf('全局规则')).toBe('1')
    expect(screen.getByText('全局')).toBeTruthy()
    // 只读：既不能调顺序以外的状态，也不能移除。
    expect(screen.queryByLabelText('全局规则绑定状态')).toBeNull()
    // 文案来自 `models.rules.removeAria` = `'移除 {name}'`，名字前的空格是模板里的，别删。
    expect(screen.queryByLabelText('移除 全局规则')).toBeNull()
  })

  it('全局规则被停用时徽标上补一句「停用」（否则用户以为它正在改请求）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_global', name: '全局规则', scope: 'global', enabled: false })] })
    renderBindings()

    expect(await screen.findByText('全局 · 停用')).toBeTruthy()
  })

  it('计数把全局规则算进去（徽标写的是「含全局」）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_global', name: '全局规则', scope: 'global' }), rule({ id: 'rule_a', name: 'Alpha' })] })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a' })] })
    renderBindings()

    expect(await screen.findByText('2 条（含全局）')).toBeTruthy()
  })
})

describe('普通规则的展示', () => {
  it('按绑定的顺序列出，序号从 1 开始（序号就是优先级）', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_a', name: 'Alpha' }), rule({ id: 'rule_b', name: 'Beta' })],
    })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_b', priority: 0 }), binding({ ruleId: 'rule_a', priority: 1 })] })
    renderBindings()

    await screen.findByText('Beta')
    expect(indexOf('Beta')).toBe('1')
    expect(indexOf('Alpha')).toBe('2')
  })

  it('规则本体被停用时开关必须是关的——绑着也不生效', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha', enabled: false })] })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a', enabled: true })] })
    renderBindings()

    const toggle = await screen.findByRole('switch', { name: 'Alpha绑定状态' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('绑定自己被停用时开关也是关的', async () => {
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1', enabled: false })] })
    renderBindings()

    const toggle = await screen.findByRole('switch', { name: 'Rule One绑定状态' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('两边都为真时才画出「开」', async () => {
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1', enabled: true })] })
    renderBindings()

    const toggle = await screen.findByRole('switch', { name: 'Rule One绑定状态' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('绑定指向一条已经不存在的规则时跳过它，不画出空行', async () => {
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_gone' })] })
    renderBindings()

    expect(await screen.findByText('未添加普通规则')).toBeTruthy()
  })

  it('绑定指向一条已经变成全局的规则时也跳过（它由上面那排负责）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_1', scope: 'global' })] })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1' })] })
    renderBindings()

    // 出现的是全局徽标，不会再多出一条带开关的普通规则。
    await screen.findByText('全局')
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('阶段徽标按动作去重：请求/响应各只画一次', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({
        actions: [
          { type: 'header-set', stage: 'request', name: 'a', value: '1' },
          { type: 'header-remove', stage: 'request', name: 'c' },
          { type: 'header-set', stage: 'response', name: 'b', value: '2' },
        ],
      })],
    })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1' })] })
    renderBindings()

    await screen.findByText('Rule One')
    expect(screen.getAllByText('请求')).toHaveLength(1)
    expect(screen.getAllByText('响应')).toHaveLength(1)
  })
})

describe('添加规则', () => {
  it('一条规则都没有时按钮禁用', async () => {
    state.list.mockResolvedValue({ success: true, data: [] })
    renderBindings()

    await waitFor(() => expect(screen.getByText('未添加普通规则')).toBeTruthy())
    expect(addButton().disabled).toBe(true)
  })

  it('可添加的规则都已经绑完了时按钮也禁用', async () => {
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1' })] })
    renderBindings()

    await screen.findByRole('switch', { name: 'Rule One绑定状态' })
    expect(addButton().disabled).toBe(true)
  })

  it('已经绑定的规则不再出现在可添加列表里', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_1', name: 'Rule One' }), rule({ id: 'rule_2', name: 'Rule Two' })] })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_1' })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Rule Two')).toBeTruthy()
    expect(within(dialog).queryByText('Rule One')).toBeNull()
  })

  it('一条都没勾时「添加所选规则」不可点，勾上才解禁', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha' })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: '添加所选规则' })
    expect(within(dialog).getByText('已选择 0 条')).toBeTruthy()
    expect(confirm.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByText('已选择 1 条')).toBeTruthy()
    expect(confirm.disabled).toBe(false)
  })

  it('搜索同时匹配名称与描述，大小写和首尾空白都不影响', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_a', name: 'Alpha', description: 'about tokens' }), rule({ id: 'rule_b', name: 'Beta', description: 'other' })],
    })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索规则名称或描述'), { target: { value: '  TOKENS ' } })

    expect(within(dialog).getByText('Alpha')).toBeTruthy()
    expect(within(dialog).queryByText('Beta')).toBeNull()
  })

  it('搜不到时给一句「没有匹配的可添加规则」，不留空白', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha' })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索规则名称或描述'), { target: { value: 'zzz' } })

    expect(within(dialog).getByText('没有匹配的可添加规则')).toBeTruthy()
  })

  it('提交顺序按规则列表本身，不按勾选顺序；优先级按下标重排', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_a', name: 'Alpha' }), rule({ id: 'rule_b', name: 'Beta' })],
    })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    const checkboxes = within(dialog).getAllByRole('checkbox')
    // 倒着勾：Beta 先，Alpha 后。
    fireEvent.click(checkboxes[1])
    fireEvent.click(checkboxes[0])
    fireEvent.click(within(dialog).getByRole('button', { name: '添加所选规则' }))

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [
      { ruleId: 'rule_a', priority: 0, enabled: true },
      { ruleId: 'rule_b', priority: 1, enabled: true },
    ])
  })

  it('全局规则不会被写进绑定列表', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_global', name: 'Global Rule', scope: 'global' }), rule({ id: 'rule_a', name: 'Alpha' })],
    })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Global Rule')).toBeNull()

    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加所选规则' }))

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [{ ruleId: 'rule_a', priority: 0, enabled: true }])
  })

  it('确认添加后关框，并把勾选与搜索一起清干净', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha' })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索规则名称或描述'), { target: { value: 'alpha' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加所选规则' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(addButton())
    dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByPlaceholderText('搜索规则名称或描述') as HTMLInputElement).value).toBe('')
    expect(within(dialog).getByText('已选择 0 条')).toBeTruthy()
  })

  it('点「取消」只关框，勾选和搜索词留着（下次打开能接着挑）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha' }), rule({ id: 'rule_b', name: 'Beta' })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('button', { name: '添加规则' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索规则名称或描述'), { target: { value: 'alpha' } })
    fireEvent.click(within(dialog).getAllByRole('checkbox')[0])
    expect(within(dialog).getByText('已选择 1 条')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(addButton())
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('已选择 1 条')).toBeTruthy()
    expect((within(dialog).getByPlaceholderText('搜索规则名称或描述') as HTMLInputElement).value).toBe('alpha')
    expect(state.replace).not.toHaveBeenCalled()
  })
})

describe('改动既有绑定', () => {
  it('关掉其中一条时整段提交，其它行原样带着（顺序不变）', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_a', name: 'Alpha' }), rule({ id: 'rule_b', name: 'Beta' })],
    })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a', priority: 0 }), binding({ ruleId: 'rule_b', priority: 1 })] })
    renderBindings()

    fireEvent.click(await screen.findByRole('switch', { name: 'Alpha绑定状态' }))

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [
      { ruleId: 'rule_a', priority: 0, enabled: false },
      { ruleId: 'rule_b', priority: 1, enabled: true },
    ])
  })

  it('移除一条后剩下的重新编号，被移除的那条不再提交', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_a', name: 'Alpha' }), rule({ id: 'rule_b', name: 'Beta' })],
    })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a', priority: 0 }), binding({ ruleId: 'rule_b', priority: 1 })] })
    renderBindings()

    fireEvent.click(await screen.findByLabelText('移除 Alpha'))

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [{ ruleId: 'rule_b', priority: 0, enabled: true }])
    expect(indexOf('Beta')).toBe('1')
  })

  it('移除最后一条普通规则后回到空状态，全局规则不会被顺手删掉', async () => {
    state.list.mockResolvedValue({
      success: true,
      data: [rule({ id: 'rule_global', name: '全局规则', scope: 'global' }), rule({ id: 'rule_a', name: 'Alpha' })],
    })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a' })] })
    renderBindings()

    fireEvent.click(await screen.findByLabelText('移除 Alpha'))

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [])
    // 全局规则那一行还在，所以走的不是空状态分支。
    expect(screen.getByText('全局')).toBeTruthy()
    expect(screen.queryByText('未添加普通规则')).toBeNull()
  })

  it('规则本体停用的绑定被点开时，本地会暂时画成开（服务端只记住绑定开关，本体停用仍会盖住它）', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha', enabled: false })] })
    state.bindings.mockResolvedValue({ success: true, data: [binding({ ruleId: 'rule_a', enabled: false })] })
    renderBindings()

    const toggle = await screen.findByRole('switch', { name: 'Alpha绑定状态' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)

    await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1))
    expect(state.replace).toHaveBeenCalledWith('pm_a', [{ ruleId: 'rule_a', priority: 0, enabled: true }])
    // 提交的是绑定开关本身，界面照它画；下次重新加载时「与」上本体停用又会变回关。
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})

describe('空状态的说明', () => {
  it('有可添加的普通规则但一条都没绑时，说明现在只跑全局规则', async () => {
    state.list.mockResolvedValue({ success: true, data: [rule({ id: 'rule_a', name: 'Alpha' })] })
    renderBindings()

    await screen.findByText('未添加普通规则')
    expect(screen.getByText('当前模型会自动应用已启用的全局请求重写。')).toBeTruthy()
  })

  it('一条规则都没有（连全局都没有）时，指路「请求重写」页面', async () => {
    state.list.mockResolvedValue({ success: true, data: [] })
    renderBindings()

    await screen.findByText('未添加普通规则')
    expect(screen.getByText('请先在“请求重写”页面创建并保存普通规则。')).toBeTruthy()
  })

  it('加载失败时说明写的是「加载失败」，不是「还没创建」', async () => {
    state.list.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'rules offline' })
    renderBindings()

    await screen.findByText('未添加普通规则')
    expect(screen.getByText('规则加载失败，请稍后重试。')).toBeTruthy()
    expect(screen.queryByText('请先在“请求重写”页面创建并保存普通规则。')).toBeNull()
  })
})

describe('加载失败', () => {
  it('列表接口失败时报出原因并禁用添加按钮', async () => {
    state.list.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'rules offline' })
    renderBindings()

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('请求重写加载失败：rules offline'))
    expect(screen.getByText('规则加载失败，请稍后重试。')).toBeTruthy()
    expect(addButton().disabled).toBe(true)
  })

  it('只有绑定接口失败时报的是绑定的原因（两个请求都不能被吞）', async () => {
    state.bindings.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'bindings offline' })
    renderBindings()

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('请求重写加载失败：bindings offline'))
  })

  it('两个都失败时报列表那个（先看 list 的返回值）', async () => {
    state.list.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'rules offline' })
    state.bindings.mockResolvedValue({ success: false, errorCode: 'X', errorMessage: 'bindings offline' })
    renderBindings()

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('请求重写加载失败：rules offline'))
  })

  it('接口直接抛异常（不是 success:false）时照样报出来', async () => {
    state.list.mockRejectedValue(new Error('socket closed'))
    renderBindings()

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('请求重写加载失败：socket closed'))
  })

  it('抛出来的不是 Error 时用「未知错误」兜底，不弹空提示', async () => {
    state.list.mockRejectedValue('nope')
    renderBindings()

    await waitFor(() => expect(state.error).toHaveBeenCalledWith('请求重写加载失败：未知错误'))
  })
})
