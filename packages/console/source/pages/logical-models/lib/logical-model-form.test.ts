import { describe, expect, it } from 'vitest'
import {
  buildCreateLogicalModelInput,
  buildUpdateLogicalModelInput,
  validateLogicalModelId,
} from './logical-model-form'

/*
 * 逻辑模型表单的领域规则。
 *
 * 这些函数没有 React，所以可以直接钉住它们的判断：模型名是**唯一**能从请求那一侧
 * 指到逻辑模型的入口，写错就等于这个模型不存在——校验和拼装都不能靠界面的自觉。
 */

describe('validateLogicalModelId', () => {
  it('合法的模型名没有意见', () => {
    expect(validateLogicalModelId('deepseek-v4.1-flash')).toBeNull()
    expect(validateLogicalModelId('GPT-4o')).toBeNull()
    expect(validateLogicalModelId('a'.repeat(64))).toBeNull()
  })

  it('空串和纯空白都是「没填」，不是「填错了」', () => {
    expect(validateLogicalModelId('')).toBe('required')
    expect(validateLogicalModelId('   ')).toBe('required')
    expect(validateLogicalModelId('\t\n')).toBe('required')
  })

  it('去空白之后按同一个规则判断', () => {
    expect(validateLogicalModelId('  gpt-4o  ')).toBeNull()
    expect(validateLogicalModelId('  vendor/model  ')).toBe('invalid')
  })

  it.each([
    ['带空格', 'deepseek v4'],
    ['带斜杠', 'vendor/model'],
    ['带冒号', 'llama3.2:latest'],
    ['以点开头', '.hidden'],
    ['以连字符开头', '-leading'],
    ['超过 64 个字符', 'a'.repeat(65)],
  ])('拒绝 %s', (_label, modelId) => {
    expect(validateLogicalModelId(modelId)).toBe('invalid')
  })

  it('内建模型跳过校验：它的名字是兜底匹配的依据，不允许改，填错了也没有意义', () => {
    expect(validateLogicalModelId('', { builtIn: true })).toBeNull()
    expect(validateLogicalModelId('vendor/model', { builtIn: true })).toBeNull()
  })
})

describe('buildCreateLogicalModelInput', () => {
  it('模型名与说明都去空白', () => {
    expect(buildCreateLogicalModelInput({ modelId: '  gpt-4o ', description: ' 主模型 ' })).toEqual({
      modelId: 'gpt-4o',
      description: '主模型',
    })
  })

  it('说明允许为空，且空说明就是空串而不是缺字段', () => {
    expect(buildCreateLogicalModelInput({ modelId: 'gpt-4o', description: '   ' })).toEqual({
      modelId: 'gpt-4o',
      description: '',
    })
  })

  it('只返回这两个字段，不会把界面上的其他状态一起发出去', () => {
    expect(Object.keys(buildCreateLogicalModelInput({ modelId: 'm', description: 'd' }))).toEqual(['modelId', 'description'])
  })
})

describe('buildUpdateLogicalModelInput', () => {
  it('普通模型带上模型名，改名与改说明在同一次请求里', () => {
    expect(buildUpdateLogicalModelInput({ modelId: ' new-name ', description: ' 说明 ' })).toEqual({
      modelId: 'new-name',
      description: '说明',
    })
  })

  it('内建模型不带模型名：多发一个同名字段会被当成一次重命名', () => {
    const input = buildUpdateLogicalModelInput({ modelId: 'ignored', description: '说明' }, { builtIn: true })
    expect(input).toEqual({ description: '说明' })
    expect('modelId' in input).toBe(false)
  })

  it('内建模型也仍然会去说明的空白', () => {
    expect(buildUpdateLogicalModelInput({ modelId: 'x', description: '  改说明  ' }, { builtIn: true })).toEqual({
      description: '改说明',
    })
  })
})
