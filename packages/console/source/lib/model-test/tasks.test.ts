import { describe, expect, it } from 'vitest'
import type { ModelTestTaskItem, ModelTestTaskKey, ModelTestTaskProgress, ModelTestTaskResult } from '@common/diagnostics'
import { modelTestTaskKeyOf } from '@common/diagnostics'
import type { Protocol, Provider, ProviderModelRoute } from '@common/schemas'
import type { TaskRecord } from '@common/tasks'
import {
  MODEL_TEST_TASK_KIND,
  buildPlannedRows,
  deriveRowStatus,
  getCurrentRoundLabel,
  getVisibleTestRows,
  mergeTestRows,
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

/** 默认那套测法参数（流式、一轮、不补长度）下的去重键；要换参数就传 `overrides`。 */
function keyOf(modelId: string, protocol: Protocol, overrides: Partial<ModelTestTaskKey> = {}): string {
  return modelTestTaskKeyOf({ modelId, protocol, mode: 'streaming', rounds: 1, inputLength: 0, ...overrides })
}

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
    key: keyOf('m1', 'openai-completions'),
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

describe('键 —— 契约层唯一给出，界面只负责读', () => {
  it('键里带着测法参数，所以「换了参数重测」不会被误认成同一行', () => {
    expect(keyOf('m1', 'anthropic-messages')).toBe('v1:m1:anthropic-messages:streaming:1:0')
    expect(keyOf('m1', 'anthropic-messages', { mode: 'speed' })).not.toBe(keyOf('m1', 'anthropic-messages'))
    expect(keyOf('m1', 'anthropic-messages', { rounds: 3 })).not.toBe(keyOf('m1', 'anthropic-messages'))
  })
})

describe('toTestRow', () => {
  it('别的 kind 的任务一概不认（同一条流上可能跑着别的业务）', () => {
    expect(toTestRow(task({ kind: 'export' }), MODELS, PROVIDERS)).toBeNull()
  })

  it('排队中的任务没有 progress，名字从本地目录取', () => {
    const row = toTestRow(task(), MODELS, PROVIDERS)!
    expect(row).toMatchObject({
      id: keyOf('m1', 'openai-completions'),
      modelId: 'm1',
      modelName: 'gpt-4o',
      providerName: '示例渠道',
      protocol: 'openai-completions',
      converted: false,
      status: 'queued',
    })
    expect(row.result).toBeUndefined()
  })

  it('键认不出来（旧版本 / 别的业务写的）时这一行不进表，而不是编一个空协议', () => {
    expect(toTestRow(task({ key: 'm1:openai-completions' }), MODELS, PROVIDERS)).toBeNull()
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
    const row = toTestRow(task({ key: keyOf('gone', 'openai-responses') }), MODELS, PROVIDERS)!
    expect(row.modelId).toBe('gone')
    expect(row.protocol).toBe('openai-responses')
    expect(row.providerId).toBe('')
  })
})

/*
 * 上游失败**不是**队列的失败。
 *
 * `runModelTestTask` 在 401 / 超时 / 没有可测目标时**正常 resolve** 一条 `success: false`
 * 的结论（口径在 `summarizeRounds`；服务端那一半的断言见
 * `packages/core/source/management/tasks/kinds/model-test.test.ts` 的「目录里没有可测目标时
 * 直说」——它断言的正是「不抛错、resolve 一条 success: false」）。于是队列记录上写的是
 * `success`，而这次诊断其实挂了。
 *
 * 这一组守的就是这条缝：**生命周期状态不能直接当业务结论用**。漏掉这层映射时，上游 401 在
 * 面板上是绿色的「成功」——错误框不出现（错误原文在 `result` 里）、进度条不变红、失败角标
 * 不出现、「只看失败」永久置灰、「重测失败项」成为死代码、`successCount` 说谎。
 */
describe('上游失败 —— 记录是 success，结论是 success: false', () => {
  /** 服务端真的会产出的那条记录：`status` 是队列的，`result` 是诊断的。 */
  const upstreamFailure: TaskRecord = task({
    id: 'task_401',
    key: keyOf('m1', 'openai-completions'),
    status: 'success',
    finishedAt: 2,
    result: result({
      success: false,
      statusCode: 401,
      errorMessage: 'invalid api key',
      rounds: [{ round: 1, success: false, statusCode: 401, durationMilliseconds: 300, errorMessage: 'invalid api key' }],
    }),
  })

  it('这一行翻出来是 failed，不是 success', () => {
    expect(toTestRow(upstreamFailure, MODELS, PROVIDERS)!.status).toBe('failed')
  })

  it('结论说通过时照旧是 success：映射只把「结论否掉」的方向翻过来', () => {
    expect(toTestRow(task({ status: 'success', result: result() }), MODELS, PROVIDERS)!.status).toBe('success')
  })

  it('取消是独立结局、排队与进行中还没有结论：它们都不被这条映射碰', () => {
    expect(deriveRowStatus('cancelled', result({ success: false }))).toBe('cancelled')
    expect(deriveRowStatus('running', result({ success: false }))).toBe('running')
    expect(deriveRowStatus('queued', undefined)).toBe('queued')
    expect(deriveRowStatus('failed', undefined)).toBe('failed')
  })

  it('错误原文取结论里的那一句（记录上根本没有 errorMessage）', () => {
    expect(upstreamFailure.errorMessage).toBeUndefined()
    expect(toTestRow(upstreamFailure, MODELS, PROVIDERS)!.errorMessage).toBe('invalid api key')
  })

  it('结论没有原文时回退到记录上的 errorMessage（那是「运行时真的抛了」）', () => {
    const row = toTestRow(task({ status: 'failed', errorMessage: 'provider exploded' }), MODELS, PROVIDERS)!
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toBe('provider exploded')
  })

  it('端到端：这样一条记录流进表里，是一个失败、零个成功', () => {
    const rows = mergeTestRows(buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {}), [upstreamFailure], MODELS, PROVIDERS)

    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(summarizeTestRows(rows)).toMatchObject({
      successCount: 0,
      failureCount: 1,
      cancelledCount: 0,
      completedCount: 1,
      progress: 100,
    })
    // 这两条是「面板上看得出来」的全部凭据：失败数非零，「只看失败」才真的生效。
    expect(getVisibleTestRows(rows, true)).toMatchObject({ failedOnlyActive: true })
    expect(getVisibleTestRows(rows, true).rows.map(row => row.id)).toEqual([upstreamFailure.key])
  })
})

describe('buildPlannedRows — 这一批要跑哪些「模型 × 协议」', () => {
  it('id 是契约层的去重键（含测法参数），重测才能命中同一行', () => {
    const rows = buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {})
    expect(rows.map(row => row.id)).toEqual([keyOf('m1', 'openai-completions')])
    expect(rows[0]).toMatchObject({
      modelId: 'm1',
      modelName: 'gpt-4o',
      providerId: 'prov_1',
      providerName: '示例渠道',
      status: 'queued',
      converted: false,
    })
  })

  it('参数跟着这一批走：换了轮次骨架就是另一组键', () => {
    const rows = buildPlannedRows(MODELS, PROVIDERS, new Set(['prov_1']), {}, { mode: 'streaming', rounds: 3, inputLength: 0 })
    expect(rows.map(row => row.id)).toEqual([keyOf('m1', 'openai-completions', { rounds: 3 })])
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
    { id: keyOf('m1', 'openai-completions'), modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '示例渠道', protocol: 'openai-completions', converted: false, status: 'queued' },
    { id: keyOf('m1', 'anthropic-messages'), modelId: 'm1', modelName: 'gpt-4o', providerId: 'prov_1', providerName: '示例渠道', protocol: 'anthropic-messages', converted: false, status: 'queued' },
  ]

  it('同 key 的任务覆盖骨架那一行，状态从服务端来', () => {
    const rows = mergeTestRows(plan, [task({ status: 'success', result: result() })], MODELS, PROVIDERS)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: keyOf('m1', 'openai-completions'), status: 'success' })
    expect(rows[1].status).toBe('queued')
  })

  it('服务端有、计划里没有的任务追加在后面', () => {
    // 一条真实的失败：队列记录是 `success`（kind 正常返回），结论才是 `success: false`。
    const rows = mergeTestRows(plan, [task({
      key: keyOf('m9', 'openai-responses'),
      status: 'success',
      result: result({ modelId: 'm9', protocol: 'openai-responses', success: false, errorMessage: 'no upstream url' }),
    })], MODELS, PROVIDERS)
    expect(rows.map(row => row.id)).toEqual([
      keyOf('m1', 'openai-completions'),
      keyOf('m1', 'anthropic-messages'),
      keyOf('m9', 'openai-responses'),
    ])
  })

  it('别的 kind 的任务不进这张表', () => {
    const rows = mergeTestRows(plan, [task({ kind: 'export', key: keyOf('m9', 'openai-responses') })], MODELS, PROVIDERS)
    expect(rows.map(row => row.id)).toEqual([keyOf('m1', 'openai-completions'), keyOf('m1', 'anthropic-messages')])
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
