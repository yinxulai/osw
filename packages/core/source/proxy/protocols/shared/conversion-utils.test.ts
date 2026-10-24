import { describe, expect, it } from 'vitest'
import { asArray, asBoolean, asNumber, asObject, asString, safeJsonParse, stringifyContent } from './conversion-utils'

/*
 * 协议转换器共用的 JSON 取值工具。
 *
 * 这些函数的全部意义在于**对畸形输入保持安静**：上游/客户端送来什么都可能，
 * 取值失败要返回 `undefined`/`null` 交给调用方决定降级，而不是抛错把一次转发打挂。
 */

describe('asObject', () => {
  it('非数组对象原样返回', () => {
    const value = { a: 1 }
    expect(asObject(value)).toBe(value)
  })

  it('数组返回 null（数组也是 object，必须单独挡住）', () => {
    expect(asObject([1, 2])).toBeNull()
    expect(asObject([])).toBeNull()
  })

  it('null 与各种标量返回 null', () => {
    for (const value of [null, undefined, 'text', 1, true, false] as unknown[]) {
      expect(asObject(value)).toBeNull()
    }
  })
})

describe('asArray', () => {
  it('数组原样返回（包括空数组：调用方靠它区分「是空数组」和「不是数组」都得到 []）', () => {
    const value = [1, 2]
    expect(asArray(value)).toBe(value)
    expect(asArray([])).toEqual([])
  })

  it('非数组返回空数组，不是 null', () => {
    for (const value of [null, undefined, { a: 1 }, 'text', 1, true] as unknown[]) {
      expect(asArray(value)).toEqual([])
    }
  })
})

describe('asString', () => {
  it('字符串原样返回', () => {
    expect(asString('hello')).toBe('hello')
  })

  it('空字符串也返回（实现与函数上方的注释不一致，这里按实现钉住）', () => {
    // 注释写的是「仅当值是非空字符串时返回它」，但实现只判 `typeof value === 'string'`。
    // 二者的差别在转换器里是可见的：拿 `''` 当「有内容」还是会回退到别的字段。
    // 这里断言的是**实际行为**；要改成注释语义就得先确认调用方是否依赖空串。
    expect(asString('')).toBe('')
  })

  it('非字符串返回 undefined', () => {
    for (const value of [null, undefined, 0, 1, true, {}, []] as unknown[]) {
      expect(asString(value)).toBeUndefined()
    }
  })
})

describe('asNumber', () => {
  it('有限数字原样返回，包含 0 与负数', () => {
    expect(asNumber(1.5)).toBe(1.5)
    expect(asNumber(0)).toBe(0)
    expect(asNumber(-3)).toBe(-3)
  })

  it('NaN 与 Infinity 返回 undefined（它们会一路污染算出来的指标）', () => {
    expect(asNumber(Number.NaN)).toBeUndefined()
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(asNumber(Number.NEGATIVE_INFINITY)).toBeUndefined()
  })

  it('数字字符串不算数字', () => {
    expect(asNumber('12')).toBeUndefined()
  })
})

describe('asBoolean', () => {
  it('布尔值原样返回', () => {
    expect(asBoolean(true)).toBe(true)
    expect(asBoolean(false)).toBe(false)
  })

  it('真假值不算布尔（0 / 1 / 空串都不行）', () => {
    for (const value of [0, 1, '', 'true', null, undefined] as unknown[]) {
      expect(asBoolean(value)).toBeUndefined()
    }
  })
})

describe('stringifyContent', () => {
  it('字符串原样返回', () => {
    expect(stringifyContent('plain text')).toBe('plain text')
  })

  it('数组里优先取 `text`，没有才取 `output`', () => {
    expect(stringifyContent([{ text: 'from text', output: 'from output' }])).toBe('from text')
    expect(stringifyContent([{ output: 'from output' }])).toBe('from output')
  })

  it('数组里的裸字符串保留，非文本对象被丢掉', () => {
    expect(stringifyContent(['first', { type: 'image' }, 'second'])).toBe('first\nsecond')
  })

  it('空片段被过滤，不会留下空行', () => {
    expect(stringifyContent([{ text: '' }, { text: 'kept' }, { other: 1 }])).toBe('kept')
  })

  it('多个片段用换行拼接', () => {
    expect(stringifyContent([{ text: 'a' }, { text: 'b' }])).toBe('a\nb')
  })

  it('空数组得到空串', () => {
    expect(stringifyContent([])).toBe('')
  })

  it('null 与 undefined 得到空串（不是 "null"）', () => {
    expect(stringifyContent(null)).toBe('')
    expect(stringifyContent(undefined)).toBe('')
  })

  it('其它情况回退到 JSON', () => {
    expect(stringifyContent({ a: 1 })).toBe('{"a":1}')
    expect(stringifyContent(42)).toBe('42')
  })
})

describe('safeJsonParse', () => {
  it('解析成功返回解析结果', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 })
    expect(safeJsonParse('[1,2]', [])).toEqual([1, 2])
  })

  it('undefined 直接返回回退值（不尝试解析）', () => {
    expect(safeJsonParse(undefined, { fallback: true })).toEqual({ fallback: true })
  })

  it('解析失败返回回退值，不抛错', () => {
    expect(safeJsonParse('{not json', 'fallback')).toBe('fallback')
  })

  it('解析出 null / undefined 时也回退（空值不该覆盖调用方的默认）', () => {
    expect(safeJsonParse('null', 'fallback')).toBe('fallback')
  })

  it('解析出 `0` / `false` / 空串这类假值时不回退（它们是合法结果）', () => {
    expect(safeJsonParse('0', 99)).toBe(0)
    expect(safeJsonParse('false', true)).toBe(false)
    expect(safeJsonParse('""', 'fallback')).toBe('')
  })
})
