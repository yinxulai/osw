import { describe, expect, it } from 'vitest'
import { diffClientConfigContent, diffClientConfigLines } from './version-diff'

describe('diffClientConfigLines', () => {
  it('pairs up the one line whose value changed', () => {
    const current = ['{', '  "model": "gpt-4o",', '  "timeout": 30', '}'].join('\n')
    const version = ['{', '  "model": "claude-sonnet-4",', '  "timeout": 30', '}'].join('\n')

    expect(diffClientConfigLines(current, version)).toEqual([{ before: '"model": "gpt-4o"', after: '"model": "claude-sonnet-4"' }])
  })

  it('never counts structural lines, so a lone brace is not a change', () => {
    // 这正是版本列表从前那个「每一行都显示 `{`」的根源：两版之间变的只是括号。
    const current = ['{', '  "a": 1', '}'].join('\n')
    const version = ['{', '  "a": 1', '},'].join('\n')

    expect(diffClientConfigLines(current, version)).toEqual([])
  })

  it('does not treat a trailing comma as content', () => {
    const current = ['{', '  "a": 1', '}'].join('\n')
    const version = ['{', '  "a": 1,', '  "b": 2', '}'].join('\n')

    expect(diffClientConfigLines(current, version)).toEqual([{ before: null, after: '"b": 2' }])
  })

  it('reports lines that only one side has', () => {
    const current = ['{', '  "a": 1,', '  "b": 2', '}'].join('\n')
    const version = ['{', '  "a": 1', '}'].join('\n')

    expect(diffClientConfigLines(current, version)).toEqual([{ before: '"b": 2', after: null }])
  })

  it('stops at a handful of places instead of unrolling a rewritten file', () => {
    const lines = (offset: number) => Array.from({ length: 40 }, (_, index) => `  "key${index}": "value-${index + offset}",`).join('\n')

    expect(diffClientConfigLines(lines(0), lines(100))).toHaveLength(12)
  })

  it('answers an empty pair with no differences', () => {
    expect(diffClientConfigLines('', '')).toEqual([])
    expect(diffClientConfigLines('{\n}', '{\n}')).toEqual([])
  })
})

describe('diffClientConfigContent', () => {
  it('compares JSON by keys, so a single-line file still yields a readable answer', () => {
    // `JSON.stringify` 写出来的配置常常就是一整行；按行比会把整份文件当成同一根长字符串。
    const current = JSON.stringify({ env: { ANTHROPIC_MODEL: 'default', TZ: 'UTC' }, model: 'default' })
    const version = JSON.stringify({ env: { ANTHROPIC_MODEL: 'glm-4.6', TZ: 'UTC' }, model: 'default' })

    expect(diffClientConfigContent(current, version)).toEqual([
      { before: 'env.ANTHROPIC_MODEL: default', after: 'env.ANTHROPIC_MODEL: glm-4.6' },
    ])
  })

  it('reports a key that only the version has', () => {
    expect(diffClientConfigContent('{"a":1}', '{"a":1,"b":2}')).toEqual([{ before: null, after: 'b: 2' }])
  })

  it('treats a whole array as one value instead of unrolling its items', () => {
    expect(diffClientConfigContent('{"allow":["a"]}', '{"allow":["a","b"]}')).toEqual([
      { before: 'allow: ["a"]', after: 'allow: ["a","b"]' },
    ])
  })

  it('falls back to comparing lines when the content is not JSON', () => {
    const current = ['model = "gpt"', 'timeout = 30'].join('\n')
    const version = ['model = "claude"', 'timeout = 30'].join('\n')

    expect(diffClientConfigContent(current, version)).toEqual([{ before: 'model = "gpt"', after: 'model = "claude"' }])
  })

  it('reports a key that only the earlier content has', () => {
    // 退回这一版会把 `b` 加回文件里；只说「多了个 b」是没用的，得说清是回退会加上的。
    expect(diffClientConfigContent('{"a":1,"b":2}', '{"a":1}')).toEqual([{ before: 'b: 2', after: null }])
  })

  it('falls back to comparing lines for JSON that is not an object', () => {
    // 顶层是数组、数字、`null` 都不是「键值对」；摊不成键路径就退回按行比，
    // 不能因为 `JSON.parse` 没抛错就当它是一份能按键比对的配置。
    expect(diffClientConfigContent('[1,2]', '[1,3]')).toEqual([{ before: '[1,2]', after: '[1,3]' }])
    expect(diffClientConfigContent('42', '43')).toEqual([{ before: '42', after: '43' }])
    // 只有一边摊不成键路径时照样退回按行比：这时两版是两种写法（`null` 与一份对象），
    // 按键比会把它们当成「同一份配置的两种缩进」而什么也不报。
    expect(diffClientConfigContent('null', '{"a":1}')).toEqual([{ before: 'null', after: '{"a":1}' }])
  })

  it('counts a key that moved as no change at all', () => {
    // 按键比较的意义就在这里：重排、缩进、换行都不是「改动」。
    expect(diffClientConfigContent('{"a":1,"b":2}', '{ "b": 2, "a": 1 }')).toEqual([])
  })

  it('stops at a handful of keys instead of unrolling a rewritten file', () => {
    const build = (suffix: string) => JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, `${index}${suffix}`])))

    expect(diffClientConfigContent(build(''), build('-next'))).toHaveLength(12)
  })
})
