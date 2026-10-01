import { describe, expect, it } from 'vitest'
import { CATALOGS } from '@common/i18n/catalogs'
import { PROTOCOL_REQUEST_SHAPES } from '@common/router/request-shape'
import { ROUTE_RULE_FIELD_KINDS } from '@common/router/route-rules'
import { RULE_PATH_HINTS, RULE_VARIABLE_PATH_HINTS } from './rule-path-hints'

/** 来源表里那些本身就是**完整路径**的来源 —— 候选表只由它们拼成。 */
const declaredHints = ROUTE_RULE_FIELD_KINDS
  .filter(meta => !meta.needsName && meta.prefix)
  .map(meta => ({ path: meta.prefix, valueType: meta.valueType, noteKey: meta.labelKey }))

const declaredPaths = new Set(declaredHints.map(hint => hint.path))
const paths = RULE_PATH_HINTS.map(hint => hint.path)

describe('RULE_PATH_HINTS', () => {
  it('与来源表一一对应：路径、取值类型、说明都取自规则表自己那张表', () => {
    // 顺序也是来源表的顺序：候选列表照着来源下拉的顺序读下来才像同一套东西。
    expect(RULE_PATH_HINTS).toEqual(declaredHints)
  })

  it('路径不重复：同一格列出两条同名路径，用户没法判断该选哪条', () => {
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('不收录按协议解析出来的请求体字段：规则模式没有协议解析器', () => {
    // `request.body.messages` / `system` / `input` 这些是图上的协议发现节点按**连上的端口**
    // 声明给下游的（声明表就是 `PROTOCOL_REQUEST_SHAPES`）。规则表没有端口也没有解析器，
    // 连这次请求是不是 JSON 都不知道 —— 列表里出现它们，就等于替规则表声称一个在别的协议上
    // 永远取不到值的字段。唯一的例外是规则表自己收下的那一条（请求模型名 `request.body.model`）：
    // 那是**来源表**说的，不是协议层替它说的。
    const parsed = new Set(Object.values(PROTOCOL_REQUEST_SHAPES).flatMap(shape => shape.fields.map(field => field.path)))
    const foreign = [...parsed].filter(path => !declaredPaths.has(path))
    expect(foreign.length).toBeGreaterThan(0)
    expect(paths.filter(path => parsed.has(path) && !declaredPaths.has(path))).toEqual([])
  })

  it('每条说明都能在两种语言的目录里查到：查不到就等于界面上露出一个 key', () => {
    const notes = RULE_PATH_HINTS.flatMap(hint => (hint.noteKey ? [hint.noteKey] : []))
    expect(notes.length).toBe(RULE_PATH_HINTS.length)
    for (const note of notes) {
      expect(CATALOGS['zh-CN'][note]).toBeTruthy()
      expect(CATALOGS.en[note]).toBeTruthy()
    }
  })
})

describe('RULE_VARIABLE_PATH_HINTS', () => {
  it('只留能当逻辑模型 id 用的类型：口径与图侧 `model-select` 一致', () => {
    for (const hint of RULE_VARIABLE_PATH_HINTS) expect(['string', 'array']).toContain(hint.valueType)
    expect(RULE_VARIABLE_PATH_HINTS.length).toBeGreaterThan(0)
    expect(RULE_VARIABLE_PATH_HINTS.length).toBeLessThanOrEqual(RULE_PATH_HINTS.length)
  })

  it('留下落点真正会用到的两条：请求里的模型名与可用逻辑模型 id', () => {
    const variablePaths = RULE_VARIABLE_PATH_HINTS.map(hint => hint.path)
    expect(variablePaths).toContain('request.body.model')
    expect(variablePaths).toContain('logicalModels[*].modelId')
  })
})
