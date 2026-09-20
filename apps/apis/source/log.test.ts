import { describe, expect, it, vi } from 'vitest'
import { logOutcome, oneLine } from './log'

describe('日志字段', () => {
  it('控制字符压成一个空格：日志按行读，一行是一条', () => {
    // 压成空格而不是删掉：删掉会把两段本不相连的文本粘成一个看起来正常的词。
    expect(oneLine('a\nb')).toBe('a b')
    expect(oneLine('a\r\n\r\nb')).toBe('a b')
    expect(oneLine('a\u0000\u001fb')).toBe('a b')
  })

  it('首尾去白', () => {
    expect(oneLine('  /v1/track  ')).toBe('/v1/track')
  })

  it('超长截断，并留下一个看得见的记号', () => {
    // 长度由请求方决定，不截断就是一个不用鉴权就能把日志撑大的口子。
    const truncated = oneLine('x'.repeat(500))

    expect(truncated).toBe(`${'x'.repeat(120)}…`)
  })

  it('没超长就原样返回', () => {
    expect(oneLine('A-EU-0000000000')).toBe('A-EU-0000000000')
  })
})

describe('日志行', () => {
  /** 两条出口都接：4xx 走 `warn`、5xx 走 `error`。 */
  function capture(): { lines: { level: string; line: string }[]; restore: () => void } {
    const lines: { level: string; line: string }[] = []
    const collect =
      (level: string) =>
      (...args: unknown[]): number =>
        lines.push({ level, line: args.map(arg => String(arg)).join(' ') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(collect('warn'))
    const error = vi.spyOn(console, 'error').mockImplementation(collect('error'))
    return {
      lines,
      restore: () => {
        warn.mockRestore()
        error.mockRestore()
      },
    }
  }

  it('位置固定：前缀、状态码、错误码一定在，且一定排在最前', () => {
    const logs = capture()
    try {
      logOutcome(400, 'invalid_json', { bytes: 12 })

      expect(logs.lines[0].line).toBe('[apis] status=400 error=invalid_json bytes=12')
    } finally {
      logs.restore()
    }
  })

  it('4xx 用 warn、5xx 用 error：混成一级就得靠人读一遍才知道有没有真出事', () => {
    const logs = capture()
    try {
      logOutcome(413, 'payload_too_large')
      logOutcome(500, 'not_configured')

      expect(logs.lines.map(entry => entry.level)).toEqual(['warn', 'error'])
    } finally {
      logs.restore()
    }
  })

  it('值为 null 的补充项整项不输出——比打出 detail=null 更接近「它没说话」', () => {
    const logs = capture()
    try {
      logOutcome(502, 'upstream_rejected', { sink: 'aptabase', detail: null })

      expect(logs.lines[0].line).toBe('[apis] status=502 error=upstream_rejected sink=aptabase')
    } finally {
      logs.restore()
    }
  })

  it('字符串值先过 oneLine，数字值原样过去', () => {
    const logs = capture()
    try {
      logOutcome(413, 'payload_too_large', { path: '/a\nb', bytes: 66560 })

      expect(logs.lines[0].line).toBe('[apis] status=413 error=payload_too_large path=/a b bytes=66560')
    } finally {
      logs.restore()
    }
  })
})
