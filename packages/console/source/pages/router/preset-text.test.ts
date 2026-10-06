import { describe, expect, it } from 'vitest'

import { createAppTranslator, type UiCatalogKey } from '@common/i18n/catalogs'
import { ROUTER_POLICY_PRESETS, createDefaultPolicyGraph } from '@common/router/presets'
import { ROUTER_RULE_PRESETS } from '@common/router/rule-presets'
import type { RuntimeLogicalModel, SchemaFieldDescriptor, WorkflowNodeModel } from '@common/router/types'
import { edgeTypes, nodeTypes } from './node-registry'
import { FIELD_READ_KINDS, readCandidates } from './panel/field-candidates'
import { POLICY_PRESET_TEXT_KEYS, policyPresetTextKeys } from './policy-preset-text'
import { presetNodeTextKeys, presetNodeTextSource } from './preset-node-text'
import { RULE_PRESET_TEXT_KEYS, rulePresetTextKeys } from './rules/rules-preset-text'

/*
 * 路由工作台里那几张「展示文案键」表，加上画布节点类型注册表。
 *
 * 这几张表的共同职责是把**服务端也认识**的稳定标识符（预设 id、内置节点 id）
 * 映射成界面文案键。它们分散在三个文件里，但错的后果是同一种：菜单里出现一串
 * `router.policy.llm-complexity-routing.name` 或干脆是裸 id。
 *
 * 所以这里不去逐个抄文案，而是**遍历真实清单**：预设有几个就查几个，图上出现的每个内置
 * 节点 id 都必须查得到。新增预设忘了配文案，这一组会当场红。
 */

const t = createAppTranslator('zh-CN')

const models: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'fast', enabled: true },
  { modelId: 'smart', enabled: true },
]

describe('策略预设文案键', () => {
  it('每个内置策略预设都配了名称与说明', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      const keys = policyPresetTextKeys(preset.id)
      expect(keys, preset.id).toBeTruthy()
      expect(t(keys!.name), preset.id).toBeTruthy()
      expect(t(keys!.description), preset.id).toBeTruthy()
    }
  })

  it('查出来的键都真的是目录里的键（不是拿 id 拼出来的假键）', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      const keys = policyPresetTextKeys(preset.id)!
      // 取词函数对不存在的键会原样回 key，所以「返回值 != key」就是「目录里有这个键」。
      expect(t(keys.name)).not.toBe(keys.name)
      expect(t(keys.description)).not.toBe(keys.description)
    }
  })

  it('表里没有的 id 返回 undefined，由调用方兜底（旧版本可能存着已删掉的预设）', () => {
    expect(policyPresetTextKeys('preset-that-was-removed')).toBeUndefined()
  })

  it('表覆盖的 id 集合与预设清单一致', () => {
    expect(Object.keys(POLICY_PRESET_TEXT_KEYS).sort()).toEqual(ROUTER_POLICY_PRESETS.map(preset => preset.id).sort())
  })
})

describe('规则预设文案键', () => {
  it('每个内置规则预设都配了名称与说明', () => {
    for (const preset of ROUTER_RULE_PRESETS) {
      const keys = rulePresetTextKeys(preset.id)
      expect(keys, preset.id).toBeTruthy()
      expect(t(keys!.name)).not.toBe(keys!.name)
      expect(t(keys!.description)).not.toBe(keys!.description)
    }
  })

  it('表覆盖的 id 集合与规则预设清单一致', () => {
    expect(Object.keys(RULE_PRESET_TEXT_KEYS).sort()).toEqual(ROUTER_RULE_PRESETS.map(preset => preset.id).sort())
  })

  it('未知 id 返回 undefined', () => {
    expect(rulePresetTextKeys('nope')).toBeUndefined()
  })

  it('两个模式的第一项都是内建默认（菜单的「内置默认」角标读这个字段）', () => {
    expect(ROUTER_POLICY_PRESETS[0].isDefault).toBe(true)
    expect(ROUTER_RULE_PRESETS[0].isDefault).toBe(true)
    expect(ROUTER_POLICY_PRESETS.filter(preset => preset.isDefault)).toHaveLength(1)
    expect(ROUTER_RULE_PRESETS.filter(preset => preset.isDefault)).toHaveLength(1)
  })
})

describe('内置节点原文', () => {
  it('表里配了的节点都必须取到真的词，没配的节点按跳过来定位', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      for (const node of preset.createGraph(models).nodes) {
        // 与上一条相反的方向：这里遍历表外的节点，确认「没配」就是没配，
        // 而不是配了一个拼错的 id（那种情况下这个节点永远拿不到译文）。
        const keys = presetNodeTextKeys(preset.id, node.id)
        if (!keys) {
          expect(node.kind === 'input' || node.kind === 'output', `${preset.id}/${node.id}`).toBe(true)
          continue
        }
        expect(t(keys.name), `${preset.id}/${node.id}`).not.toBe(keys.name)
      }
    }
  })

  it('内置便签与条件节点这类「用户看得见名字」的节点必须配了文案', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      for (const node of preset.createGraph(models).nodes) {
        // 输入 / 输出是框架节点，名字由引擎定；其余节点都会在画布上显示名字。
        if (node.kind === 'input' || node.kind === 'output') continue
        expect(presetNodeTextKeys(preset.id, node.id), `${preset.id}/${node.id}`).toBeTruthy()
      }
    }
  })

  it('分支名文案键也都真的存在（条件分支名不走索引兜底）', () => {
    for (const preset of ROUTER_POLICY_PRESETS) {
      for (const node of preset.createGraph(models).nodes) {
        const keys = presetNodeTextKeys(preset.id, node.id)
        for (const caseName of Object.values(keys?.caseNames ?? {}) as UiCatalogKey[]) {
          expect(t(caseName), `${preset.id}/${node.id}: ${caseName}`).not.toBe(caseName)
        }
      }
    }
  })

  it('表外的预设 / 节点 id 返回 undefined', () => {
    expect(presetNodeTextKeys('model-direct', 'no-such-node')).toBeUndefined()
    expect(presetNodeTextKeys('no-such-preset', 'note-usage')).toBeUndefined()
  })

  it('未改动的内置节点找得到原文来源', () => {
    for (const node of createDefaultPolicyGraph(models).nodes) {
      const source = presetNodeTextSource(node)
      if (presetNodeTextKeys('model-direct', node.id) === undefined) continue
      expect(source, node.id).toBeTruthy()
      expect(source!.origin.id).toBe(node.id)
      expect(source!.origin.kind).toBe(node.kind)
    }
  })

  it('字段全被改过之后就认不出来源了（不拿内置文案覆盖用户的字）', () => {
    const origin = createDefaultPolicyGraph(models).nodes.find(node => node.id === 'condition')!
    if (origin.kind !== 'condition') throw new Error('condition node missing')
    // 打分包含分支名：只改名称描述还不够，必须连分支名一起改掉。
    const renamed: WorkflowNodeModel = {
      ...origin,
      name: '我的判断',
      description: '自己写的说明',
      cases: origin.cases.map(conditionCase => ({ ...conditionCase, name: '我的分支' })),
    }

    expect(presetNodeTextSource(renamed)).toBeUndefined()
  })

  it('返回的原文来源一定是同 id 的节点（同名 id 跨预设出现时靠内容比对选）', () => {
    const graph = createDefaultPolicyGraph(models)
    for (const node of graph.nodes) {
      const source = presetNodeTextSource(node)
      if (source) expect(source.origin.id).toBe(node.id)
    }
  })
})

describe('画布节点类型注册表', () => {
  it('注册表覆盖 node-meta 声明的全部类型名', () => {
    // 类型名是联合字面量，运行时只能用「注册表的键」反过来钉住：少一个 key，
    // React Flow 在拿到这种节点时会因为找不到组件而整块不渲染。
    expect(Object.keys(nodeTypes).sort()).toEqual([
      'condition',
      'control-input',
      'iteration',
      'model-select',
      'note',
      'prompt',
      'protocol-discovery',
      'route-input',
      'route-output',
      'script',
    ])
  })

  it('每种节点都用同一个外壳组件（内部再按 kind 分流）', () => {
    const components = new Set(Object.values(nodeTypes))
    expect(components.size).toBe(1)
  })

  it('连线类型只有一种', () => {
    expect(Object.keys(edgeTypes)).toEqual(['workflow'])
  })
})

describe('面板字段候选口径', () => {
  const field = (path: string, valueType: SchemaFieldDescriptor['valueType']): SchemaFieldDescriptor => ({
    path,
    title: path,
    valueType,
    sourceNodeId: 'input',
    sourcePort: 'out',
  })

  const fields: SchemaFieldDescriptor[] = [
    field('request.body.model', 'string'),
    field('request.method', 'string'),
    field('logicalModels', 'array'),
    field('request.body', 'object'),
    field('route.controls.flag', 'boolean'),
  ]

  it('五种会读字段的节点都登记在案', () => {
    expect([...FIELD_READ_KINDS].sort()).toEqual(['condition', 'iteration', 'model-select', 'prompt', 'script'])
  })

  it('条件 / 脚本 / 提示词不做类型收窄（读得动整体对象）', () => {
    expect(readCandidates('condition', fields)).toEqual(fields)
    expect(readCandidates('script', fields)).toEqual(fields)
    expect(readCandidates('prompt', fields)).toEqual(fields)
  })

  it('逻辑模型选择只留能当 id 用的标量与列表', () => {
    expect(readCandidates('model-select', fields).map(item => item.path)).toEqual([
      'request.body.model',
      'request.method',
      'logicalModels',
    ])
  })

  it('遍历迭代只留能逐个走的东西', () => {
    expect(readCandidates('iteration', fields).map(item => item.path)).toEqual(['logicalModels', 'request.body'])
  })

  it('收窄之后仍保留原有顺序（下拉顺序就是上游 schema 的顺序）', () => {
    const narrowed = readCandidates('iteration', fields)
    const originalOrder = fields.filter(item => narrowed.includes(item))
    expect(narrowed).toEqual(originalOrder)
  })

  it('没有字段时返回空数组而不是原样回 null', () => {
    expect(readCandidates('model-select', [])).toEqual([])
  })
})
