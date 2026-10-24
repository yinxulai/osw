import { describe, expect, it } from 'vitest'
import { resolveLogScope } from './log-scope'

describe('resolveLogScope', () => {
  it('按行首方括号前缀把日志归到对应模块', () => {
    expect(resolveLogScope('[proxy] attempt prepared')).toBe('proxy')
    expect(resolveLogScope('[proxy-lifecycle] listening')).toBe('proxy')
    expect(resolveLogScope('[management] request begin')).toBe('management')
    expect(resolveLogScope('[management-lifecycle] stop requested')).toBe('management')
    expect(resolveLogScope('[runtime] start requested')).toBe('runtime')
    expect(resolveLogScope('[service-host] service process exited')).toBe('runtime')
    expect(resolveLogScope('[database] open started')).toBe('database')
    expect(resolveLogScope('[store] settings change listener error')).toBe('database')
    expect(resolveLogScope('[tray] initialization started')).toBe('desktop')
    expect(resolveLogScope('[updater] check started')).toBe('desktop')
    expect(resolveLogScope('[cli] ...')).toBe('desktop')
  })

  // 精确匹配而不是前缀匹配：`proxy` 与 `proxy-lifecycle` 必须各归各的，长前缀不能被短前缀吞掉。
  it('长前缀不会被短前缀吞掉', () => {
    expect(resolveLogScope('[proxy-lifecycle] restart requested')).toBe('proxy')
    expect(resolveLogScope('[management-lifecycle] closing')).toBe('management')
  })

  // 只认行首：正文里出现的方括号是数据，不是模块。
  it('忽略正文里出现的方括号', () => {
    expect(resolveLogScope('value=[1,2] entered')).toBe('other')
    expect(resolveLogScope('some [proxy] mention in the middle')).toBe('other')
  })

  it('没有前缀或未登记的前缀一律归 other', () => {
    expect(resolveLogScope('plain message')).toBe('other')
    expect(resolveLogScope('[unknown-module] whatever')).toBe('other')
  })

  it('前缀两侧的空白会被裁掉再匹配', () => {
    expect(resolveLogScope('[ proxy ] spaced')).toBe('proxy')
  })
})
