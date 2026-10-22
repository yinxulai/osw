import { describe, expect, it } from 'vitest'
import type { ModelTestTaskItem, ModelTestTaskProgress, ModelTestTaskResult } from '@common/diagnostics'
import type { Provider, ProviderModelRoute } from '@common/schemas'
import type { TaskRecord } from '@common/tasks'
import {
  MODEL_TEST_TASK_KIND,
  buildPlannedRows,
  getCurrentRoundLabel,
  getVisibleTestRows,
  mergeTestRows,
  modelTestKeyOf,
  summarizeTestRows,
  toModelTestItems,
  toTestRow,
  type TestRow,
} from './tasks'

/**
 * 服务端任务 → 面板表格行。
 *
 * 这一层的全部职责是**对号入座**：队列不认识「模型」「协议」，面板要一张按「模型 × 协议」
 * 排开的表，接点就是 `keyOf` 的同一口径。所以这里的断言几乎都在问同一件事：
 * 一条任务回来之后，它还认不认得自己是哪一行。
 */

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_1',
    name: '示例渠道',
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

type ModelOverrides = Partial<ProviderModelRoute> & { id: string }

function model(overrides: ModelOverrides): ProviderModelRoute {
  return {
    providerId: 'prov_1',
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
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    kind: MODEL_TEST_TASK_KIND,
    key: modelTestKeyOf('m1', 'openai-completions'),
    status: 'queued',
    enqueuedAt: 1,
    ...overrides,
  }
}

function result(overrides: Partial<ModelTestTaskResult> = {}): ModelTestTaskResult {
  return {
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: '示例渠道',
    protocol: 'openai-completions',
    mode: 'streaming',
    success: true,
    durationMilliseconds: 1200,
    ...overrides,
  }
}

function progress(overrides: Partial<ModelTestTaskProgress> = {}): ModelTestTaskProgress {
  return {
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: '示例渠道',
    protocol: 'openai-completions',
    mode: 'streaming',
    round: 1,
    totalRounds: 3,
    result: null,
    ...overrides,
  }
}

const MODELS = [
  model({ id: 'm1', modelName: 'gpt-4o' }),
  model({ id: 'm2', providerId: 'prov_2', modelName: 'orphan' }),
]
const PROVIDERS = [provider()]

describe('modelTestKeyOf — 与服务端 keyOf 同一口径', () => {
  it('是「模型 id:协议」，去重与对号入座都靠它', () => {
    expect(modelTestKeyOf('m1', 'anthropic-messages')).toBe('m1:anthropic-messages')
  })
})

describe('toTestRow', () => {
  it('别的 kind 的任务一概不认（同一条流上可能跑着别的业务）', () => {
    expect(toTestRow(task({ kind: 'export' }), MODELS, PROVIDERS)).toBeNull()
  })

  it('排队中的任务没有 progress，名字从本地目录取', () => {
    const row = toTestRow(task(), MODELS, PROVIDERS)!
    expect(row).toMatchObject({
      id: 'm1:openai-completions',
      modelId: 'm1',
      modelName: 'gpt-4o',
      providerName: '示例渠道',
      protocol: 'openai-completions',
      converted: false,
      status: 'queued',
    })
    expect(row.result).toBeUndefined()
  })

  it('有 progress 时用服务端给的名字（目录可能刚被改过）', () => {
    const row = toTestRow(task({ status: 'running', progress: progress({ modelName: '已改名' }) }), MODELS, PROVIDERS)!
    expect(row.modelName).toBe('已改名')
  })

  it('progress 形状不对时不硬塞进表格（另一头可能刚升级）', () => {
    const row = toTestRow(task({ status: 'running', progress: { round: 1 } }), MODELS, PROVIDERS)!
    expect(row.progress).toBeUndefined()
    expect(row.modelName).toBe('gpt-4o')
  })

  it('结论带上协议：一个订阅者才知道这条结论测的是什么', () => {
    const row = toTestRow(task({ status: 'success', result: result() }), MODELS, PROVIDERS)!
    expect(row.result?.protocol).toBe('openai-completions')
    expect(row.status).toBe('success')
  })

  it('模型已从目录里消失也能读出这一行（任务是真的，藏起来只会无法解释）', () => {
    const row = toTestRow(task({ key: modelTestKeyOf('gone', 'openai-responses') }), MODELS, PROVIDERS)!
    expect(row.modelId).toBe('gone')
    expect(row.protocol).toBe('openai-responses')
    expect(row.providerId).toBe('')
  })
})

describe('buildPlannedRows — 这一批要跑哪些「模型 × 协议」', () => {
  it('id 稳定成「模型 id:协议」，重测才能命中同一行', () => {
    const rows = buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})
    expect(rows.map(row => row.id)).toEqual(['m1:openai-completions'])
    expect(rows[0]).toMatchObject({
      modelId: 'm1',
      modelName: 'gpt-4o',
      providerId: 'prov_1',
      providerName: '示例渠道',
      status: 'queued',
      converted: false,
    })
  })

  it('供应商没找到（数据不同步）时这一行不出现，而不是编一个空名字', () => {
    expect(buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_2']), {})).toEqual([])
  })

  it('显式清空的模型一行都不排；没存过选择时按默认全测', () => {
    expect(buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), { m1: new Set() })).toEqual([])
    expect(buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})).toHaveLength(1)
  })

  it('转换出来的协议带上 converted 标记', () => {
    const converting = model({
      id: 'm3',
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://api.example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    })
    const rows = buildPlannedRows([converting], PROVIDERS, new Set(['prov_1']), { m3: new Set(['anthropic-messages']) })
    expect(rows).toEqual([expect.objectContaining({ protocol: 'anthropic-messages', converted: true })])
  })
})

describe('mergeTestRows — 计划是骨架，服务端是事实', () => {
  const plan: TestRow[] = [
    { id: 'm1:openai-completions', modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '示例渠道', protocol: 'openai-completions', converted: false, status: 'queued' },
    { id: 'm1:anthropic-messages', modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '示例渠道', protocol: 'anthropic-messages', converted: false, status: 'queued' },
  ]

  it('同 key 的任务覆盖骨架那一行，状态从服务端来', () => {
    const rows = mergeTestRows(plan, [task({ status: 'success', result: result() })], MODELS, PROVIDERS)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'm1:openai-completions', status: 'success' })
    expect(rows[1].status).toBe('queued')
  })

  it('服务端有、计划里没有的任务追加在后面', () => {
    const rows = mergeTestRows(plan, [task({ key: modelTestKeyOf('m9', 'openai-responses'), status: 'failed' })], MODELS, PROVIDERS)
    expect(rows.map(row => row.id)).toEqual([
      'm1:openai-completions',
      'm1:anthropic-messages',
      'm9:openai-responses',
    ])
  })

  it('别的 kind 的任务不进这张表', () => {
    const rows = mergeTestRows(plan, [task({ kind: 'export', key: modelTestKeyOf('m9', 'openai-responses') })], MODELS, PROVIDERS)
    expect(rows.map(row => row.id)).toEqual(['m1:openai-completions', 'm1:anthropic-messages'])
  })
})

describe('toModelTestItems — 开跑那一刻的快照', () => {
  const rows = buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})

  it('一行一个目标：队列负责排队，不把多个目标塞进一个载荷', () => {
    const items = toModelTestItems(rows, { mode: 'speed', rounds: 3, prompt: '数到一百', inputLength: 200 })
    expect(items).toEqual<ModelTestTaskItem[]>([{
      modelId: 'm1',
      providerId: 'prov_1',
      protocol: 'openai-completions',
      mode: 'speed',
      rounds: 3,
      prompt: '数到一百',
      inputLength: 200,
    }])
  })

  it('空提示词不发：让服务端按模式取默认，两边口径一致', () => {
    const items = toModelTestItems(rows, { mode: 'streaming', rounds: 1, prompt: '   ', inputLength: 0 })
    expect(items[0].prompt).toBeUndefined()
  })
})

describe('summarizeTestRows — 一行一个计数，全部从同一份行列表推导', () => {
  it('排队与进行中不算已完成，百分比按全部行算', () => {
    const rows: TestRow[] = [
      { ...buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})[0], id: 'a', status: 'success' },
      { ...buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})[0], id: 'b', status: 'failed' },
      { ...buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})[0], id: 'c', status: 'cancelled' },
      { ...buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})[0], id: 'd', status: 'running' },
    ]
    expect(summarizeTestRows(rows)).toEqual({
      successCount: 1,
      failureCount: 1,
      cancelledCount: 1,
      runningCount: 1,
      completedCount: 3,
      progress: 75,
    })
  })

  it('没有行时进度是 0，不是 NaN', () => {
    expect(summarizeTestRows([]).progress).toBe(0)
  })
})

describe('getVisibleTestRows — 筛选是否生效是推导出来的', () => {
  function row(id: string, status: TestRow['status']): TestRow {
    return {
      id,
      modelId: 'm1',
      modelName: 'gpt-4o',
      providerId: 'prov_1',
      providerName: '示例渠道',
      protocol: 'openai-completions',
      converted: false,
      status,
    }
  }

  it('只看失败时只留失败行，分母仍是全部行（不跟随筛选）', () => {
    const visible = getVisibleTestRows([row('a', 'success'), row('b', 'failed'), row('c', 'failed'), row('d', 'queued')], true)
    expect(visible.rows.map(item => item.id)).toEqual(['b', 'c'])
    expect(visible.total).toBe(4)
    expect(visible.failedOnlyActive).toBe(true)
  })

  it('失败数归零后筛选自动失效，不留一张空白表', () => {
    const visible = getVisibleTestRows([row('a', 'success'), row('b', 'queued')], true)
    expect(visible.failedOnlyActive).toBe(false)
    expect(visible.rows).toHaveLength(2)
  })
})

describe('getCurrentRoundLabel — 角标上那行「第 N/M 轮」', () => {
  it('取在跑的行里最大的那一格，并发之后也不会回退', () => {
    const rows: TestRow[] = [
      { id: 'a', modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '', protocol: 'openai-completions', converted: false, status: 'running', progress: progress({ round: 1, totalRounds: 3 }) },
      { id: 'b', modelId: 'm2', modelName: 'gpt-4o-mini', providerId: 'prov_1', providerName: '', protocol: 'openai-completions', converted: false, status: 'running', progress: progress({ round: 2, totalRounds: 3 }) },
    ]
    expect(getCurrentRoundLabel(rows)).toEqual({ round: 2, totalRounds: 3 })
  })

  it('没有行在跑时返回 null——那时该说的是「已完成多少」，不是「第 0 轮」', () => {
    const rows: TestRow[] = [
      { id: 'a', modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '', protocol: 'openai-completions', converted: false, status: 'queued' },
    ]
    expect(getCurrentRoundLabel(rows)).toBeNull()
  })
})
