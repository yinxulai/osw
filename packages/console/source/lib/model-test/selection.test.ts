import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import {
  buildSelectionView,
  clearAllTasks,
  getProtocolSegmentClassName,
  getProtocolSegmentLabel,
  getTestableProtocols,
  isEveryTaskSelected,
  pruneModelProtocolSelection,
  pruneProviderSelection,
  selectEveryTask,
  supportsConvertedProtocol,
  toggleModelSelection,
  toggleProtocolSelection,
  toggleProviderSelection,
  type ModelProtocolSelection,
} from './selection'

/**
 * 选择模型的约定都在这里。它们原先散在 `model-test-panel.tsx` 里，只能靠点开面板验证；
 * 提到纯函数之后，每条口径一次断言就说清——尤其是「第一次点击不能把没显示的默认值
 * 一起取消」那种只有手点才会发现的偏差。
 */

const zh = createAppTranslator('zh-CN')

function provider(id: string, name = id): Provider {
  return {
    id,
    name,
    enabled: true,
    description: '',
    apiKeyReference: 'key',
    timeoutMilliseconds: 30000,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  } as Provider
}

type ModelOverrides = Partial<ProviderModelRoute> & { id: string }

function model(overrides: ModelOverrides): ProviderModelRoute {
  return {
    providerId: overrides.providerId ?? 'prov_1',
    modelName: overrides.id,
    endpoints: [{
      protocol: 'openai-completions',
      endpointUrl: 'https://api.example.com/v1/chat/completions',
      customAuthHeader: null,
      protocolConversionEnabled: false,
    }],
    priority: 0,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
    ...overrides,
  } as ProviderModelRoute
}

describe('getTestableProtocols — 可测协议是「原生 + 能转过去的」', () => {
  it('没开转换时只有端点自己那个协议', () => {
    expect(getTestableProtocols(model({ id: 'm1' }))).toEqual(['openai-completions'])
  })

  it('开了转换就把能转到的协议并进来', () => {
    const converting = model({
      id: 'm2',
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://api.example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    })
    expect(getTestableProtocols(converting)).toEqual(['openai-completions', 'anthropic-messages', 'openai-responses'])
  })

  it('两个端点给出同一个协议时只算一次', () => {
    const duplicated = model({
      id: 'm3',
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'a', customAuthHeader: null, protocolConversionEnabled: false },
        { protocol: 'openai-completions', endpointUrl: 'b', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    })
    expect(getTestableProtocols(duplicated)).toEqual(['openai-completions'])
  })
})

describe('supportsConvertedProtocol — 只有「模型自己没有、但能转过去」才算转换', () => {
  const converting = model({
    id: 'm',
    endpoints: [{
      protocol: 'openai-completions',
      endpointUrl: 'https://api.example.com/v1/chat/completions',
      customAuthHeader: null,
      protocolConversionEnabled: true,
    }],
  })

  it('原生协议不是转换', () => {
    expect(supportsConvertedProtocol(converting, 'openai-completions')).toBe(false)
  })

  it('端点能转过去的协议是转换', () => {
    expect(supportsConvertedProtocol(converting, 'anthropic-messages')).toBe(true)
  })

  it('转换开关关掉之后，转不过去的协议既不可测也不算转换', () => {
    const native = model({ id: 'n' })
    expect(supportsConvertedProtocol(native, 'anthropic-messages')).toBe(false)
    expect(getTestableProtocols(native)).not.toContain('anthropic-messages')
  })
})

describe('buildSelectionView — 左栏的视图模型', () => {
  const providers = [provider('prov_1', '示例渠道'), provider('prov_2', '备用渠道')]
  const models = [
    model({ id: 'm1', providerId: 'prov_1', modelName: 'gpt-4o' }),
    model({
      id: 'm2',
      providerId: 'prov_2',
      modelName: 'claude-sonnet',
      endpoints: [{
        protocol: 'anthropic-messages',
        endpointUrl: 'https://api.example.com/v1/messages',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    }),
  ]

  function view(overrides: Partial<Parameters<typeof buildSelectionView>[0]> = {}) {
    return buildSelectionView({
      providers,
      models,
      providerIds: new Set<string>(),
      modelProtocols: {},
      query: '',
      t: zh,
      ...overrides,
    })
  }

  it('按渠道分组，没有模型的渠道整组不渲染', () => {
    const groups = view({ providers: [provider('prov_1', '示例渠道'), provider('prov_3', '空渠道')] })
    expect(groups.map(group => group.provider.id)).toEqual(['prov_1'])
    expect(groups[0].models.map(item => item.model.id)).toEqual(['m1'])
  })

  it('没显式选过时，行上显示的是默认（全部可测协议）而不是空', () => {
    const [group] = view({ providers: [providers[1]] })
    const [item] = group.models
    expect(item.selectedCount).toBe(2)
    // 行级勾选也是「满选」，只是供应商还没勾，整组没显示出来——两处同源。
    expect(item.selected).toBe(true)
    expect(item.indeterminate).toBe(false)
    expect(item.protocols.every(option => option.selected)).toBe(true)
  })

  it('行级三态由协议求和得来：全选、半选、全不选', () => {
    const protocolSelection: ModelProtocolSelection = { m2: new Set(['anthropic-messages']) }
    const half = view({ providers: [providers[1]], modelProtocols: protocolSelection })[0].models[0]
    expect(half).toMatchObject({ selectedCount: 1, selected: false, indeterminate: true })

    const none = view({ providers: [providers[1]], modelProtocols: { m2: new Set() } })[0].models[0]
    expect(none).toMatchObject({ selectedCount: 0, selected: false, indeterminate: false })

    const all = view({ providers: [providers[1]], modelProtocols: { m2: new Set(getTestableProtocols(models[1])) } })[0].models[0]
    expect(all).toMatchObject({ selectedCount: 2, selected: true, indeterminate: false })
  })

  it('搜索词同时匹配渠道名与模型名，前后空格大小写都归一', () => {
    expect(view({ query: '  示例  ' }).map(group => group.provider.id)).toEqual(['prov_1'])
    expect(view({ query: 'CLAUDE' }).map(group => group.provider.id)).toEqual(['prov_2'])
    expect(view({ query: '没有这个' })).toEqual([])
  })

  it('转换出来的协议在标题里说出来，原生协议只印正式名', () => {
    const [item] = view({ providers: [providers[1]] })[0].models
    const converted = item.protocols.find(option => option.protocol === 'openai-completions')!
    const native = item.protocols.find(option => option.protocol === 'anthropic-messages')!
    expect(converted.converted).toBe(true)
    expect(converted.title).toBe('OpenAI Completions（经协议转换支持）')
    expect(native.converted).toBe(false)
    expect(native.title).toBe('Anthropic Messages')
  })

  it('渠道的 selectedCount 数的是「至少勾了一个协议的模型数」', () => {
    const [group] = view({
      providers: [provider('prov_1', '示例渠道')],
      models: [model({ id: 'a', providerId: 'prov_1' }), model({ id: 'b', providerId: 'prov_1' })],
      modelProtocols: { a: new Set(['openai-completions']), b: new Set() },
    })
    expect(group.models).toHaveLength(2)
    expect(group.selectedCount).toBe(1)
  })
})

describe('getProtocolSegmentClassName / getProtocolSegmentLabel', () => {
  it('三态各自一个长相，转换态不依赖选中与否', () => {
    expect(getProtocolSegmentClassName({ converted: false, selected: true })).toBe('bg-card text-text-primary')
    expect(getProtocolSegmentClassName({ converted: false, selected: false })).toContain('hover:bg-state-base-hover')
    expect(getProtocolSegmentClassName({ converted: true, selected: true })).toBe('bg-warning/15 text-text-warning')
    expect(getProtocolSegmentClassName({ converted: true, selected: false })).toBe('text-text-warning hover:bg-warning/10')
  })

  it('转换态的无障碍名要说明「会被改写」，原生态只给正式名', () => {
    expect(getProtocolSegmentLabel({ converted: false, protocol: 'openai-responses', t: zh })).toBe('OpenAI Responses')
    expect(getProtocolSegmentLabel({ converted: true, protocol: 'openai-responses', t: zh }))
      .toBe('OpenAI Responses（经协议转换支持）')
  })
})

describe('勾选态的三个动作', () => {
  const models = [
    model({ id: 'm1' }),
    model({
      id: 'm2',
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://api.example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    }),
  ]

  it('没存过选择时，第一次点击从「行上显示的默认」出发，只摘掉点的那个', () => {
    const next = toggleProtocolSelection(models, {}, 'm2', 'anthropic-messages')
    expect([...next.m2].sort()).toEqual(['openai-completions', 'openai-responses'])
  })

  it('再点同一格会加回来', () => {
    const once = toggleProtocolSelection(models, {}, 'm1', 'openai-completions')
    expect([...once.m1]).toEqual([])
    const twice = toggleProtocolSelection(models, once, 'm1', 'openai-completions')
    expect([...twice.m1]).toEqual(['openai-completions'])
  })

  it('整行开关：满选清空，半选补满', () => {
    const partial = toggleModelSelection(models, { m2: new Set(['openai-completions']) }, 'm2')
    expect([...partial.m2].sort()).toEqual(['anthropic-messages', 'openai-completions', 'openai-responses'])

    const cleared = toggleModelSelection(models, {}, 'm1')
    expect([...cleared.m1]).toEqual([])
  })

  it('整行开关遇到不存在的模型时原样返回同一个引用', () => {
    const current: ModelProtocolSelection = { m1: new Set(['openai-completions']) }
    expect(toggleModelSelection(models, current, 'missing')).toBe(current)
  })

  it('供应商勾选是简单的开关', () => {
    expect([...toggleProviderSelection(new Set(['a']), 'b')].sort()).toEqual(['a', 'b'])
    expect([...toggleProviderSelection(new Set(['a', 'b']), 'b')]).toEqual(['a'])
  })
})

describe('全选 / 清空 / 是否全选', () => {
  const providers = [provider('prov_1'), provider('prov_2')]
  const models = [model({ id: 'm1', providerId: 'prov_1' }), model({ id: 'm2', providerId: 'prov_2' })]

  it('全选勾上所有供应商与每个模型的全部可测协议', () => {
    const selection = selectEveryTask(models, providers)
    expect([...selection.providerIds].sort()).toEqual(['prov_1', 'prov_2'])
    expect([...selection.modelProtocols.m1]).toEqual(['openai-completions'])
    expect(isEveryTaskSelected(models, selection.providerIds, selection.modelProtocols)).toBe(true)
  })

  it('清空要给每个模型写一个空集：删键等于回到「默认全选」', () => {
    const selection = clearAllTasks(models)
    expect(selection.providerIds.size).toBe(0)
    expect(selection.modelProtocols.m1.size).toBe(0)
    expect(isEveryTaskSelected(models, selection.providerIds, selection.modelProtocols)).toBe(false)
  })

  it('供应商没勾时不算全选，哪怕协议都勾着', () => {
    const protocols = selectEveryTask(models, providers).modelProtocols
    expect(isEveryTaskSelected(models, new Set(), protocols)).toBe(false)
  })

  it('没有模型时不算全选', () => {
    expect(isEveryTaskSelected([], new Set(), {})).toBe(false)
  })
})

describe('prune* — 集合变了之后收敛选择，没变就不换引用', () => {
  const converting = model({
    id: 'm1',
    endpoints: [{
      protocol: 'openai-completions',
      endpointUrl: 'https://api.example.com/v1/chat/completions',
      customAuthHeader: null,
      protocolConversionEnabled: true,
    }],
  })

  it('转换开关关掉后，转出来的协议被摘掉', () => {
    const current: ModelProtocolSelection = { m1: new Set(['openai-completions', 'anthropic-messages']) }
    const next = pruneModelProtocolSelection([model({ id: 'm1' })], current)
    expect([...next.m1]).toEqual(['openai-completions'])
  })

  it('什么都没变时返回同一个引用（否则 effect 会自己转起来）', () => {
    const current: ModelProtocolSelection = { m1: new Set(['openai-completions']) }
    expect(pruneModelProtocolSelection([converting, model({ id: 'm2' })], { ...current, m2: new Set() }))
      .toEqual({ m1: new Set(['openai-completions']), m2: new Set() })
    const stable: ModelProtocolSelection = { m1: new Set(['openai-completions']) }
    expect(pruneModelProtocolSelection([model({ id: 'm1' })], stable)).toBe(stable)
  })

  it('还没被选过的模型不落空集条目（否则会顶掉「默认全选」）', () => {
    const current: ModelProtocolSelection = {}
    // 老写法会给 m1 存一个空集，而待测计划的默认值是「没存过就全部可测协议」——空集顶掉默认值，
    // 待测计划归零，「开始诊断」永久变灰。StrictMode 下 effect 立刻重跑，面板一打开就中招。
    expect(pruneModelProtocolSelection([model({ id: 'm1' })], current)).toBe(current)
  })

  it('已经下架的模型整条丢掉', () => {
    const current: ModelProtocolSelection = { gone: new Set(), m1: new Set() }
    expect(Object.keys(pruneModelProtocolSelection([model({ id: 'm1' })], current))).toEqual(['m1'])
  })

  it('供应商收敛：删掉不存在的，没变化时保持引用', () => {
    const stable = new Set(['prov_1'])
    expect(pruneProviderSelection([provider('prov_1')], stable)).toBe(stable)
    expect([...pruneProviderSelection([provider('prov_2')], stable)]).toEqual([])
  })
})
