import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendProviderModelBindings,
  buildProviderModelCandidates,
  filterCandidates,
  groupCandidatesByProvider,
  loadProviderModelCandidates,
  type ProviderModelCandidate,
} from './provider-model-candidates'

/*
 * 「往逻辑模型里加供应商模型」的领域规则。
 *
 * 排除规则错一条，用户就会得到一条指向空配置的绑定，或者一条永远打不开的绑定。
 * 这里没有 React，所以这些规则可以逐条钉住。
 */

vi.mock('@/api/providers', () => ({ providerApi: { list: vi.fn() } }))
vi.mock('@/api/models', () => ({
  providerModelApi: { list: vi.fn() },
  schedulingPolicyApi: { list: vi.fn(), update: vi.fn() },
}))

const { providerApi } = await import('@/api/providers')
const { providerModelApi, schedulingPolicyApi } = await import('@/api/models')

const listProviders = vi.mocked(providerApi.list)
const listModels = vi.mocked(providerModelApi.list)
const listPolicies = vi.mocked(schedulingPolicyApi.list)
const updatePolicy = vi.mocked(schedulingPolicyApi.update)

beforeEach(() => {
  vi.clearAllMocks()
})

type ModelRow = { id: string; providerId: string; modelName: string; enabled: boolean; deletedTime: number | null }

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    id: 'pm_1',
    providerId: 'prov_1',
    modelName: 'gpt-4o',
    enabled: true,
    deletedTime: null,
    ...overrides,
  }
}

describe('buildProviderModelCandidates', () => {
  const providers = [{ id: 'prov_1', name: '渠道一' }, { id: 'prov_2', name: '渠道二' }]

  it('把供应商名补上去，供应商模型 id 与模型名都保留原样', () => {
    expect(buildProviderModelCandidates({
      providers,
      models: [model({ id: 'pm_a', providerId: 'prov_2', modelName: 'claude-sonnet-4.5' })],
      boundProviderModelIds: [],
    })).toEqual([{ id: 'pm_a', providerId: 'prov_2', providerName: '渠道二', modelName: 'claude-sonnet-4.5' }])
  })

  it('软删除的不要：列表里已经不存在，加进来只会是一条指向空配置的绑定', () => {
    expect(buildProviderModelCandidates({
      providers,
      models: [model({ id: 'pm_gone', deletedTime: 1_700_000_000_000 })],
      boundProviderModelIds: [],
    })).toEqual([])
  })

  it('全局停用的不要：加了也只能是一条关着的绑定，服务端会拒绝为它打开', () => {
    expect(buildProviderModelCandidates({
      providers,
      models: [model({ id: 'pm_off', enabled: false })],
      boundProviderModelIds: [],
    })).toEqual([])
  })

  it('已经绑过的不算候选，那是现状', () => {
    expect(buildProviderModelCandidates({
      providers,
      models: [model({ id: 'pm_bound' }), model({ id: 'pm_free' })],
      boundProviderModelIds: ['pm_bound'],
    }).map(candidate => candidate.id)).toEqual(['pm_free'])
  })

  it('三条排除规则叠加时不会漏掉本来该出现的候选', () => {
    const candidates = buildProviderModelCandidates({
      providers,
      models: [
        model({ id: 'pm_bound' }),
        model({ id: 'pm_deleted', deletedTime: 1 }),
        model({ id: 'pm_disabled', enabled: false }),
        model({ id: 'pm_ok' }),
      ],
      boundProviderModelIds: ['pm_bound'],
    })
    expect(candidates.map(candidate => candidate.id)).toEqual(['pm_ok'])
  })

  it('供应商查不到名字时退回用 id，比留空更容易定位是哪条数据出了问题', () => {
    expect(buildProviderModelCandidates({
      providers: [],
      models: [model({ id: 'pm_a', providerId: 'prov_missing' })],
      boundProviderModelIds: [],
    })[0].providerName).toBe('prov_missing')
  })

  it('保持服务端返回的顺序，不在这里排序', () => {
    const candidates = buildProviderModelCandidates({
      providers,
      models: [model({ id: 'pm_c' }), model({ id: 'pm_a' }), model({ id: 'pm_b' })],
      boundProviderModelIds: [],
    })
    expect(candidates.map(candidate => candidate.id)).toEqual(['pm_c', 'pm_a', 'pm_b'])
  })
})

describe('groupCandidatesByProvider', () => {
  function candidate(providerName: string, id: string): ProviderModelCandidate {
    return { id, providerId: `prov_${providerName}`, providerName, modelName: id }
  }

  it('按供应商分组，组与组内都保持原有顺序', () => {
    const groups = groupCandidatesByProvider([
      candidate('渠道一', 'a'),
      candidate('渠道二', 'b'),
      candidate('渠道一', 'c'),
    ])
    expect(groups).toEqual([
      ['渠道一', [candidate('渠道一', 'a'), candidate('渠道一', 'c')]],
      ['渠道二', [candidate('渠道二', 'b')]],
    ])
  })

  it('空候选就是空分组，不造一个空组出来', () => {
    expect(groupCandidatesByProvider([])).toEqual([])
  })

  it('同名供应商合成一组', () => {
    const groups = groupCandidatesByProvider([candidate('渠道一', 'a'), candidate('渠道一', 'b')])
    expect(groups).toHaveLength(1)
    expect(groups[0][1]).toHaveLength(2)
  })
})

describe('filterCandidates', () => {
  const groups = groupCandidatesByProvider([
    { id: 'pm_a', providerId: 'prov_1', providerName: '渠道一', modelName: 'gpt-4o' },
    { id: 'pm_b', providerId: 'prov_2', providerName: '渠道二', modelName: 'claude-sonnet-4.5' },
  ])

  it('空关键词原样返回，且是副本（调用方可以放心 sort）', () => {
    const result = filterCandidates(groups, '   ')
    expect(result).toEqual(groups)
    expect(result).not.toBe(groups)
  })

  it('按模型名匹配，忽略大小写', () => {
    const result = filterCandidates(groups, 'GPT')
    expect(result).toHaveLength(1)
    expect(result[0][1].map(item => item.id)).toEqual(['pm_a'])
  })

  it('按供应商名匹配', () => {
    expect(filterCandidates(groups, '渠道二')[0][1].map(item => item.id)).toEqual(['pm_b'])
  })

  it('按 id 匹配：可以直接搜 pm_ 前缀', () => {
    expect(filterCandidates(groups, 'pm_b')[0][1].map(item => item.id)).toEqual(['pm_b'])
  })

  it('没命中时把空分组整条扔掉，不留一个只有标题的空组', () => {
    expect(filterCandidates(groups, '不存在的模型')).toEqual([])
  })

  it('一个分组里只有部分命中时，组还在、只留命中的行', () => {
    const mixed = groupCandidatesByProvider([
      { id: 'pm_a', providerId: 'prov_1', providerName: '渠道一', modelName: 'gpt-4o' },
      { id: 'pm_c', providerId: 'prov_1', providerName: '渠道一', modelName: 'qwen-max' },
    ])
    const result = filterCandidates(mixed, 'qwen')
    expect(result).toHaveLength(1)
    expect(result[0][1].map(item => item.id)).toEqual(['pm_c'])
  })
})

describe('loadProviderModelCandidates', () => {
  it('三个请求一起发，绑定过的由调度策略算出', async () => {
    listProviders.mockResolvedValue({ success: true, data: [{ id: 'prov_1', name: '渠道一' }] } as never)
    listModels.mockResolvedValue({
      success: true,
      data: [model({ id: 'pm_bound' }), model({ id: 'pm_free' })],
    } as never)
    listPolicies.mockResolvedValue({ success: true, data: [{ providerModelId: 'pm_bound' }] } as never)

    const candidates = await loadProviderModelCandidates('lm_1')

    expect(candidates.map(candidate => candidate.id)).toEqual(['pm_free'])
    expect(listPolicies).toHaveBeenCalledWith('lm_1')
  })

  it('三个请求必须一起成功：少了供应商拼不出名字，少了绑定算不出候选', async () => {
    listProviders.mockResolvedValue({ success: true, data: [] } as never)
    listModels.mockResolvedValue({ success: false, errorCode: 'internal', errorMessage: 'boom' } as never)
    listPolicies.mockResolvedValue({ success: true, data: [] } as never)

    // 半个候选集比一次明确的失败更危险，所以这里必须抛。
    await expect(loadProviderModelCandidates('lm_1')).rejects.toThrow()
  })
})

describe('appendProviderModelBindings', () => {
  it('优先级从现有条数之后开始，追加在末尾不会挤掉已有绑定', async () => {
    updatePolicy.mockResolvedValue({ success: true, data: {} } as never)

    await appendProviderModelBindings('lm_1', ['pm_a', 'pm_b'], 3)

    expect(updatePolicy.mock.calls.map(call => call[0])).toEqual([
      { logicalModelId: 'lm_1', providerModelId: 'pm_a', priority: 4, enabled: true },
      { logicalModelId: 'lm_1', providerModelId: 'pm_b', priority: 5, enabled: true },
    ])
  })

  it('现有 0 条时第一条就是优先级 1', async () => {
    updatePolicy.mockResolvedValue({ success: true, data: {} } as never)

    await appendProviderModelBindings('lm_1', ['pm_a'], 0)

    expect(updatePolicy.mock.calls[0][0].priority).toBe(1)
  })

  it('一个都没选时不发请求', async () => {
    await appendProviderModelBindings('lm_1', [], 2)

    expect(updatePolicy).not.toHaveBeenCalled()
  })

  it('新加的绑定默认打开——用户刚选中的东西不该是关着的', async () => {
    updatePolicy.mockResolvedValue({ success: true, data: {} } as never)

    await appendProviderModelBindings('lm_1', ['pm_a'], 1)

    expect(updatePolicy.mock.calls[0][0].enabled).toBe(true)
  })

  it('有一条失败就整体抛出，不吞掉半个结果', async () => {
    updatePolicy
      .mockResolvedValueOnce({ success: true, data: {} } as never)
      .mockResolvedValueOnce({ success: false, errorCode: 'conflict', errorMessage: 'dup' } as never)

    await expect(appendProviderModelBindings('lm_1', ['pm_a', 'pm_b'], 0)).rejects.toThrow()
  })
})
