import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelTestTaskItem, ModelTestTaskProgress } from '@common/diagnostics'
import { closeDatabases, initDatabases } from '../../../database'
import { MODEL_TEST_TASK_KIND, modelTestTaskKind } from './model-test'

/**
 * 渠道诊断这个 kind：**翻译层**。
 *
 * 请求体怎么拼、流怎么读、多轮怎么汇总、哪些目标可测，各自的断言在 `diagnostics/` 下；
 * 这里只守队列与业务之间的那层契约——载荷怎么解析、去重键是什么、以及对一个空目录
 * 说话时给的是「没有可测的目标」而不是一次假的失败。
 */

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-model-test-kind-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function item(overrides: Partial<ModelTestTaskItem> = {}): ModelTestTaskItem {
  return {
    modelId: 'pm_1',
    providerId: 'prov_1',
    protocol: 'openai-completions',
    mode: 'streaming',
    rounds: 1,
    inputLength: 0,
    ...overrides,
  }
}

describe('kind 注册信息', () => {
  it('kind 名是 model-test', () => {
    expect(modelTestTaskKind.kind).toBe(MODEL_TEST_TASK_KIND)
  })

  it('串行：诊断量的是延迟与首字，并发会污染读数', () => {
    expect(modelTestTaskKind.concurrency).toBe(1)
  })

  it('去重键是「模型 × 协议」，同一个目标不该同时在飞两份', () => {
    expect(modelTestTaskKind.keyOf(item())).toBe('pm_1:openai-completions')
    expect(modelTestTaskKind.keyOf(item({ protocol: 'anthropic-messages' }))).toBe('pm_1:anthropic-messages')
  })
})

describe('parse', () => {
  it('补齐默认值：不给模式就是流式，一轮、不补长度', () => {
    const parsed = modelTestTaskKind.parse({ modelId: 'pm_1', providerId: 'prov_1', protocol: 'openai-completions' })
    expect(parsed).toMatchObject({ mode: 'streaming', rounds: 1, inputLength: 0 })
  })

  it('畸形载荷一律抛（引擎会把它算成 skipped，而不是把一个半成品喂给 kind）', () => {
    expect(() => modelTestTaskKind.parse({ providerId: 'prov_1', protocol: 'openai-completions' })).toThrow()
    expect(() => modelTestTaskKind.parse({ modelId: 'pm_1', providerId: 'prov_1', protocol: 'nope' })).toThrow()
    expect(() => modelTestTaskKind.parse({ modelId: 'pm_1', providerId: 'prov_1', protocol: 'openai-completions', rounds: 0 })).toThrow()
  })
})

describe('run', () => {
  function context() {
    const progress: ModelTestTaskProgress[] = []
    return {
      progress,
      context: {
        taskId: 'task_1',
        signal: new AbortController().signal,
        report: (value: ModelTestTaskProgress) => progress.push(value),
      },
    }
  }

  it('目录里没有可测目标时直说，不假装打了一次上游', async () => {
    const { progress, context: runContext } = context()

    const result = await modelTestTaskKind.run(item(), runContext)

    expect(result).toMatchObject({
      modelId: 'pm_1',
      protocol: 'openai-completions',
      success: false,
      durationMilliseconds: 0,
    })
    expect(result.errorMessage).toContain('No testable target')
    // 一次上游请求都没有，也就没有一轮可汇报的进度。
    expect(progress).toEqual([])
  })

  it('结论带上协议：任意一个订阅者才知道这条结论测的是什么', async () => {
    const { context: runContext } = context()

    const result = await modelTestTaskKind.run(item({ protocol: 'anthropic-messages' }), runContext)

    expect(result.protocol).toBe('anthropic-messages')
  })
})
