import { describe, expect, it } from 'vitest'
import { describeError } from './errors'

// 终端里第一眼要看到的是「哪儿失败了」，不是栈。所有命令共用这一份描述，
// 所以「非 Error 的抛出物」也必须变成一句能读的话，而不是 `[object Object]`。

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('port 9300 is already in use'))).toBe('port 9300 is already in use')
  })

  it('keeps only the message, never the stack', () => {
    const error = new Error('boom')
    error.stack = 'Error: boom\n    at somewhere (file.ts:1:1)'

    const described = describeError(error)
    expect(described).toBe('boom')
    expect(described).not.toContain('at somewhere')
  })

  it('describes a thrown string as itself', () => {
    expect(describeError('just a string')).toBe('just a string')
  })

  it('describes a thrown non-Error object without crashing', () => {
    // 抛出物不是 Error 时也要能读：`String({})` 至少给出 `[object Object]`，
    // 而读 `.message` 会得到 `undefined`，那句输出比空行更难查。
    expect(describeError({ code: 'EADDRINUSE' })).toBe('[object Object]')
    expect(describeError(undefined)).toBe('undefined')
    expect(describeError(null)).toBe('null')
  })
})
