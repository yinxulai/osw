import { describe, expect, it } from 'vitest'
import { modelTestTaskKeyOf, parseModelTestTaskKey } from './diagnostics'

/**
 * 诊断任务去重键的**唯一实现**。
 *
 * 这里守两件事：
 *
 * 1. 键里必须带 `mode` / `rounds` / `inputLength`——少了它们，「同一目标换参数重测」会被
 *    服务端当成重复任务静默跳过，界面表现为「点了没反应」。
 * 2. 构造与解析必须是一对：服务端写键、界面读键共用这一份，任何一侧改格式都会在这里先红。
 */

const BASE = {
  modelId: 'pm_1',
  protocol: 'openai-completions' as const,
  mode: 'streaming' as const,
  rounds: 1,
  inputLength: 0,
}

describe('modelTestTaskKeyOf', () => {
  it('把测法参数写进键里；任何一项变了就是另一个任务', () => {
    const base = modelTestTaskKeyOf(BASE)
    expect(base).toBe('v1:pm_1:openai-completions:streaming:1:0')
    expect(modelTestTaskKeyOf({ ...BASE, protocol: 'anthropic-messages' })).not.toBe(base)
    expect(modelTestTaskKeyOf({ ...BASE, mode: 'speed' })).not.toBe(base)
    expect(modelTestTaskKeyOf({ ...BASE, rounds: 3 })).not.toBe(base)
    expect(modelTestTaskKeyOf({ ...BASE, inputLength: 200 })).not.toBe(base)
  })

  it('模型 id 里的分隔符被编码，不会把解析切错', () => {
    const key = modelTestTaskKeyOf({ ...BASE, modelId: 'vendor:model:beta' })
    expect(parseModelTestTaskKey(key)?.modelId).toBe('vendor:model:beta')
  })
})

describe('parseModelTestTaskKey', () => {
  it('与 modelTestTaskKeyOf 严格互逆', () => {
    expect(parseModelTestTaskKey(modelTestTaskKeyOf(BASE))).toEqual(BASE)
    const speed = { ...BASE, mode: 'speed' as const, rounds: 5, inputLength: 400 }
    expect(parseModelTestTaskKey(modelTestTaskKeyOf(speed))).toEqual(speed)
  })

  it('认不出来的键返回 null（旧格式、坏协议、非规范数字、多余段）', () => {
    expect(parseModelTestTaskKey('pm_1:openai-completions')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:not-a-protocol:streaming:1:0')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:openai-completions:not-a-mode:1:0')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:openai-completions:streaming:01:0')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:openai-completions:streaming:0:0')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:openai-completions:streaming:1:-1')).toBeNull()
    expect(parseModelTestTaskKey('v1:pm_1:openai-completions:streaming:1:0:extra')).toBeNull()
  })
})
