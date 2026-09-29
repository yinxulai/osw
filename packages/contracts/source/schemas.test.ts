import { describe, expect, it } from 'vitest'
import { LogicalModelIdSchema } from './schemas'

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
