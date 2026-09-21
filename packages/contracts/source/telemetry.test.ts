import { describe, expect, it } from 'vitest'
import {
  TELEMETRY_ENVELOPE_FIELDS,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_EVENT_PREDICATES,
  TelemetryEventSchema,
} from './telemetry'

/**
 * 事件名与属性名的**命名规则**写在 `telemetry.ts` 的注释里（「命名规则」那一段），
 * 这里是把那几条规则变成可执行的形式。
 *
 * 为什么值得为此写一个测试：名字一旦发出去就改不了了（契约只增不删），而「同一种句式」
 * 这种要求靠人盯是盯不住的——添加第五条事件的人不会去读前四条长什么样。规则写成测试之后，
 * 违反它的写法在提 PR 的那一刻就红了，而不是在分析侧拼不出报表的时候才发现。
 *
 * 这里断言的全是**形状**，不涉及任何一条事件说了什么。事件该不该存在、属性该不该有，
 * 是 `docs/product/telemetry.md` §2 那份问题清单的事，机器判不了。
 */

/** 小写下划线：以字母开头，段与段之间一个下划线，没有连续下划线、没有尾下划线。 */
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

/** 信封字段是例外，它们由我们自己的代码填，用 camelCase 的 TypeScript 标识符（见命名规则第 5 条）。 */
const ENVELOPE_FIELDS = new Set<string>(TELEMETRY_ENVELOPE_FIELDS)

/** 一条判别联合分支的最小形状：只关心它有哪些键，不关心各自的类型。 */
type EventOptionShape = { shape: Record<string, unknown> }

/** 事件名的两段：主体与谓词。 */
type EventNameParts = { stem: string; predicate: string }

/** 遍历用：`options` 的元素类型是按判别联合推出来的，这里只关心每个事件的键。 */
const EVENT_SHAPES = TelemetryEventSchema.options as unknown as EventOptionShape[]

/** `provider_created` → `{ stem: 'provider', predicate: 'created' }`。谓词永远是最后一段。 */
function splitEventName(name: string): EventNameParts {
  const index = name.lastIndexOf('_')
  return { stem: name.slice(0, index), predicate: name.slice(index + 1) }
}

/** 取出一个 zod 枚举的词表；不是枚举（字面量、联合）时返回 `null`，调用方跳过比对。 */
function vocabularyOf(schema: unknown): string[] | null {
  const options = (schema as { options?: unknown }).options
  return Array.isArray(options) && options.every(item => typeof item === 'string') ? (options as string[]) : null
}

describe('事件名', () => {
  it('全部是小写下划线，不带连字符、大写字母与版本号', () => {
    for (const name of TELEMETRY_EVENT_NAMES) {
      expect(name, name).toMatch(SNAKE_CASE)
    }
  })

  it('不带各家后端留给自己保留名的前缀', () => {
    // `$` 是普遍约定，`_` 是部分系统跟着保留的。撞上的解法是在适配器里映射，
    // 而不是改契约里的名字——所以从源头就不许出现。
    for (const name of TELEMETRY_EVENT_NAMES) {
      expect(name.startsWith('$'), name).toBe(false)
      expect(name.startsWith('_'), name).toBe(false)
    }
  })

  it('名字互不重复', () => {
    expect(new Set(TELEMETRY_EVENT_NAMES).size).toBe(TELEMETRY_EVENT_NAMES.length)
  })

  it('谓词取自那张封闭的动词表', () => {
    for (const name of TELEMETRY_EVENT_NAMES) {
      const { predicate } = splitEventName(name)
      expect(TELEMETRY_EVENT_PREDICATES, name).toContain(predicate)
    }
  })

  it('动词表里没有用不上的词', () => {
    // 加一个谓词就该有一条事件用它。留着一个没人用的词，读的人只会以为漏了东西，
    // 或者以为它和表里另一个词有区别——而按规则，同义词是不允许并存的。
    const used = new Set(TELEMETRY_EVENT_NAMES.map(name => splitEventName(name).predicate))
    expect(TELEMETRY_EVENT_PREDICATES.filter(predicate => !used.has(predicate))).toEqual([])
  })

  it('主体不是空的，也不会以动词结尾（那说明句式被读反了）', () => {
    for (const name of TELEMETRY_EVENT_NAMES) {
      const { stem } = splitEventName(name)
      expect(stem.length, name).toBeGreaterThan(0)
      expect(stem, name).toMatch(SNAKE_CASE)
    }
  })

  it('谓词不会出现在中间：`<主体>_<谓词>` 的谓词是最后一段', () => {
    // `provider_created_model` 这类写法会通过「含有一个谓词」的检查，却破坏了句式。
    for (const name of TELEMETRY_EVENT_NAMES) {
      const { stem } = splitEventName(name)
      const words = stem.split('_')
      const offenders = words.filter(word => (TELEMETRY_EVENT_PREDICATES as readonly string[]).includes(word))
      expect(offenders, name).toEqual([])
    }
  })
})

describe('事件属性名', () => {
  it('也是小写下划线，不用 camelCase', () => {
    for (const option of EVENT_SHAPES) {
      for (const key of Object.keys(option.shape)) {
        if (key === 'name' || ENVELOPE_FIELDS.has(key)) continue
        expect(key, key).toMatch(SNAKE_CASE)
      }
    }
  })

  it('信封字段是 camelCase，与事件属性刻意不同', () => {
    // 两者不是同一类东西：信封字段由我们自己的代码填，在两端都是同名的 TS 标识符；
    // 事件属性是要长期发到线上、给分析侧看的词表。写成一样会让人以为它们可以互换。
    for (const field of TELEMETRY_ENVELOPE_FIELDS) {
      expect(field, field).not.toContain('_')
      expect(field, field).toMatch(/^[a-z][a-zA-Z0-9]*$/)
    }
  })

  it('同名属性在不同事件里同义（同词表）', () => {
    // `kind` 在 `provider_created` 与 `rewrite_rule_created` 里都是 `builtin` / `custom`。
    // 同名而不同词表是最坏的一种不一致：分析侧只能按 `kind` 分组，两个「kind」混在一起。
    const vocabularies = new Map<string, { event: string; values: string[] }>()

    for (const option of EVENT_SHAPES) {
      for (const [key, schema] of Object.entries(option.shape)) {
        if (key === 'name' || ENVELOPE_FIELDS.has(key)) continue
        const values = vocabularyOf(schema)
        if (values === null) continue
        const seen = vocabularies.get(key)
        if (seen === undefined) {
          vocabularies.set(key, { event: eventNameOf(option), values: [...values].sort() })
          continue
        }
        expect(values.slice().sort(), `${key} 在 ${seen.event} 与 ${eventNameOf(option)} 里应该同义`).toEqual(seen.values)
      }
    }
  })
})

/** 从 schema 的 `name` 字面量里取事件名，用于断言消息与「同名属性」的归因。 */
function eventNameOf(option: EventOptionShape): string {
  const value = (option.shape.name as { value?: unknown }).value
  return typeof value === 'string' ? value : '(unknown)'
}
