import { describe, expect, it } from 'vitest'
import { LogicalModelIdSchema, REWRITE_SCRIPT_CODE_LIMIT, REWRITE_SCRIPT_TIMEOUT_DEFAULT, REWRITE_SCRIPT_TIMEOUT_LIMIT, RequestRewriteRuleActionSchema } from './schemas'

/**
 * 逻辑模型 id 的取值边界。
 *
 * 落点只认 id，所以「客户端请求里的模型名」必须能直接写成这个 id —— 这组用例守的就是
 * 那件事：真实模型名（带版本号、带大小写）都得是可以当 id 的，而标点仍要留在
 * 可枚举的安全子集里（id 会进日志、快照与筛选条件）。
 */
describe('LogicalModelIdSchema', () => {
  it.each([
    'default',
    'production',
    'deepseek-v4.1-flash',
    'claude-sonnet-4.5',
    'GPT-4o',
    'Qwen3-Max',
    'o3-mini',
    'gpt_4.1_turbo',
    '4o',
  ])('接受真实模型名形态：%s', id => {
    expect(LogicalModelIdSchema.safeParse(id).success).toBe(true)
  })

  it.each([
    ['带空格', 'deepseek v4'],
    ['带斜杠', 'vendor/model'],
    ['带冒号', 'llama3.2:latest'],
    ['以点开头', '.hidden'],
    ['以下划线开头', '_internal'],
    ['以连字符开头', '-leading'],
    ['空字符串', ''],
    ['超过 64 个字符', 'a'.repeat(65)],
  ])('拒绝 %s', (_label, id) => {
    expect(LogicalModelIdSchema.safeParse(id).success).toBe(false)
  })

  it('恰好 64 个字符仍然合法', () => {
    expect(LogicalModelIdSchema.safeParse('a'.repeat(64)).success).toBe(true)
  })
})

/**
 * 脚本动作的取值边界。
 *
 * 这些常量是「本地工具不设资源攻击假设」的对外承诺，前端编辑器也直接引用它们做提示，
 * 所以边界值本身要钉死：代码长度上限、超时默认值与上限。
 */
describe('RequestRewriteRuleActionSchema - script action', () => {
  it('不写超时时采用默认值', () => {
    const result = RequestRewriteRuleActionSchema.parse({ type: 'script', code: 'return undefined' })
    expect(result).toEqual({ type: 'script', stage: 'request', code: 'return undefined', timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_DEFAULT })
  })

  it('接受自定义超时', () => {
    const result = RequestRewriteRuleActionSchema.safeParse({ type: 'script', code: 'return undefined', timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_LIMIT })
    expect(result.success).toBe(true)
  })

  it('保留 stage', () => {
    const result = RequestRewriteRuleActionSchema.safeParse({ type: 'script', stage: 'response', code: 'return undefined' })
    expect(result.success && result.data.stage).toBe('response')
  })

  it.each([
    ['空代码', { type: 'script', code: '' }],
    ['超长代码', { type: 'script', code: 'a'.repeat(REWRITE_SCRIPT_CODE_LIMIT + 1) }],
    ['超时为零', { type: 'script', code: 'return undefined', timeoutMilliseconds: 0 }],
    ['超时超上限', { type: 'script', code: 'return undefined', timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_LIMIT + 1 }],
    ['超时非整数', { type: 'script', code: 'return undefined', timeoutMilliseconds: 1.5 }],
  ])('拒绝 %s', (_label, action) => {
    expect(RequestRewriteRuleActionSchema.safeParse(action).success).toBe(false)
  })

  it('恰好达到代码长度上限仍然合法', () => {
    expect(RequestRewriteRuleActionSchema.safeParse({ type: 'script', code: 'a'.repeat(REWRITE_SCRIPT_CODE_LIMIT) }).success).toBe(true)
  })
})
