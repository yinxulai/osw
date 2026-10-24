import { describe, expect, it } from 'vitest'
import type { ModelTestRoundResult, ModelTestTaskResult } from '@common/diagnostics'
import type { TestRow } from './tasks'
import {
  getResultRounds,
  getRoundSuccessRate,
  getTaskDurationLabel,
  getTaskSpeedLabel,
  getTaskStatusClassName,
  getTaskStatusTitle,
  getTaskTokenLabel,
  getTaskTtftLabel,
} from './results'

/**
 * 结果表的读法。这里每条断言都对应一个**口径**，而不是某个像素：
 * 没量到与测得零是两件事、速度只在拿得到分子分母时才有值、HTTP 码退进悬浮提示。
 * 这些以前藏在组件里，只有点开面板才看得见。
 *
 * 「这一批跑到哪了、有多少失败」这类**汇总**不在这里——它挨着任务的数据源
 *（`./tasks.test.ts`），因为状态归服务端队列所有。
 */

function result(overrides: Partial<ModelTestTaskResult> = {}): ModelTestTaskResult {
  return {
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: '示例渠道',
    protocol: 'openai-completions',
    mode: 'streaming',
    success: true,
    durationMilliseconds: 1250,
    ...overrides,
  }
}

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    id: 'm1:openai-completions',
    modelId: 'm1',
    modelName: 'gpt-4o',
    providerId: 'prov_1',
    providerName: '示例渠道',
    protocol: 'openai-completions',
    converted: false,
    status: 'queued',
    ...overrides,
  }
}

describe('getResultRounds — 逐轮记录的唯一来源', () => {
  it('服务端给了 rounds 就原样用', () => {
    const rounds: ModelTestRoundResult[] = [
      { round: 1, success: true, statusCode: 200, durationMilliseconds: 100, outputTokens: 5 },
      { round: 2, success: false, statusCode: 500, durationMilliseconds: 200, errorMessage: 'boom' },
    ]
    expect(getResultRounds(result({ rounds }))).toBe(rounds)
  })

  it('服务端没给 rounds 时是空表，不编一条「第 1 轮」出来', () => {
    // 空表读得出「没有明细」，编一轮读出来是「测过一次」——后者是假话。
    expect(getResultRounds(result())).toEqual([])
  })
})

describe('getRoundSuccessRate', () => {
  it('按整百分比四舍五入', () => {
    expect(getRoundSuccessRate([
      { round: 1, success: true, durationMilliseconds: 1 },
      { round: 2, success: true, durationMilliseconds: 1 },
      { round: 3, success: true, durationMilliseconds: 1 },
    ])).toBe(100)
    expect(getRoundSuccessRate([
      { round: 1, success: true, durationMilliseconds: 1 },
      { round: 2, success: false, durationMilliseconds: 1 },
      { round: 3, success: false, durationMilliseconds: 1 },
    ])).toBe(33)
  })

  it('一轮都没有时是 0，不是 NaN', () => {
    expect(getRoundSuccessRate([])).toBe(0)
  })
})

describe('每格的读数：没数据写 —，不补 0', () => {
  it('还没有 result 时四列全写 —', () => {
    const queued = row()
    expect(getTaskTokenLabel(queued)).toBe('—')
    expect(getTaskDurationLabel(queued)).toBe('—')
    expect(getTaskTtftLabel(queued)).toBe('—')
    expect(getTaskSpeedLabel(queued)).toBe('—')
  })

  it('输出 Token 用计数口径：万位以上才折成 k', () => {
    expect(getTaskTokenLabel(row({ result: result({ outputTokens: 9700 }) }))).toBe('9700')
    expect(getTaskTokenLabel(row({ result: result({ outputTokens: 12_340 }) }))).toBe('12.3k')
  })

  it('输出 Token 没上报时写 —，而不是 0', () => {
    expect(getTaskTokenLabel(row({ result: result({ outputTokens: null }) }))).toBe('—')
  })

  it('耗时按毫秒/秒读数', () => {
    expect(getTaskDurationLabel(row({ result: result({ durationMilliseconds: 1250 }) }))).toBe('1.3s')
  })

  it('首字耗时没量到（null）写 —', () => {
    expect(getTaskTtftLabel(row({ result: result({ ttftMilliseconds: null }) }))).toBe('—')
    expect(getTaskTtftLabel(row({ result: result({ ttftMilliseconds: 320 }) }))).toBe('320ms')
  })

  it('速度带单位；没有可比的分母时保持 —，不写成「— t/s」', () => {
    expect(getTaskSpeedLabel(row({ result: result({ tokensPerSecond: 42.4 }) }))).toBe('42 t/s')
    expect(getTaskSpeedLabel(row({ result: result({ tokensPerSecond: 8.25 }) }))).toBe('8.3 t/s')
    expect(getTaskSpeedLabel(row({ result: result({ tokensPerSecond: null }) }))).toBe('—')
  })
})

describe('getTaskStatusTitle — HTTP 码退进悬浮提示', () => {
  it('没有状态码时只给状态词', () => {
    expect(getTaskStatusTitle(row({ result: result() }), '成功')).toBe('成功')
    expect(getTaskStatusTitle(row(), '排队中')).toBe('排队中')
  })

  it('有状态码时补上 HTTP，401 与 429 才能一眼分开', () => {
    expect(getTaskStatusTitle(row({ result: result({ statusCode: 401 }) }), '失败')).toBe('失败 · HTTP 401')
  })
})

describe('getTaskStatusClassName', () => {
  it('五个状态各走一种语义色，排队退到最浅', () => {
    expect(getTaskStatusClassName('success')).toBe('text-text-success')
    expect(getTaskStatusClassName('failed')).toBe('text-text-destructive')
    expect(getTaskStatusClassName('running')).toBe('text-text-primary')
    expect(getTaskStatusClassName('cancelled')).toBe('text-text-tertiary')
    expect(getTaskStatusClassName('queued')).toBe('text-text-quaternary')
  })
})
