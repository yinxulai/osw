import { describe, expect, it } from 'vitest'

import { getTranslator } from '@/i18n/active'
import { PATH_WILDCARD_SUFFIX } from '@common/router/types'
import { INPUT_NODE_FIELDS } from './input-shape'
import { MODEL_SELECT_OUTPUT_FIELDS } from './model-select-shape'

/*
 * 输入节点「交给下游什么」与逻辑模型选择节点「交出什么」的两份契约。
 *
 * 这两份清单是**唯一来源**：字段候选表、条件节点的「比较字段」下拉、脚本的 `get()` 补全、
 * 提示词的 `${}` 补全都读它们。清单少一条，下游就是「能跑但选不出来」——预设里写了
 * `logicalModels[*].modelId`，用户的下拉里却找不到它。
 *
 * 所以这里钉的不是「有哪几条」这么简单：每条路径的**静态类型**同样要钉住，
 * 因为类型决定它出现在哪个节点的候选表里（见 `panel/field-candidates.ts`）。
 */

const t = getTranslator('zh-CN')

describe('INPUT_NODE_FIELDS', () => {
  it('交出的是不解析请求体就知道的那些东西：请求行、请求头、请求体整体、调用方 metadata、逻辑模型列表', () => {
    expect(INPUT_NODE_FIELDS.map(field => field.path)).toEqual([
      'request.path',
      'request.method',
      'request.headers',
      'request.body',
      'metadata',
      'logicalModels',
      `logicalModels${PATH_WILDCARD_SUFFIX}.modelId`,
      `logicalModels${PATH_WILDCARD_SUFFIX}.enabled`,
    ])
  })

  it('每条路径的类型是声明好的（类型决定它进哪个节点的候选表）', () => {
    expect(Object.fromEntries(INPUT_NODE_FIELDS.map(field => [field.path, field.valueType]))).toEqual({
      'request.path': 'string',
      'request.method': 'string',
      'request.headers': 'object',
      'request.body': 'object',
      metadata: 'object',
      logicalModels: 'array',
      [`logicalModels${PATH_WILDCARD_SUFFIX}.modelId`]: 'string',
      [`logicalModels${PATH_WILDCARD_SUFFIX}.enabled`]: 'boolean',
    })
  })

  it('路径不重复（重复会让候选表里出现两条一模一样的选项）', () => {
    const paths = INPUT_NODE_FIELDS.map(field => field.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('通配投影只有两条，且都挂在 logicalModels 下（运行时注入的东西静态示例里给不出来，只能显式列）', () => {
    const wildcards = INPUT_NODE_FIELDS.filter(field => field.path.includes(PATH_WILDCARD_SUFFIX))

    expect(wildcards).toHaveLength(2)
    expect(wildcards.every(field => field.path.startsWith(`logicalModels${PATH_WILDCARD_SUFFIX}`))).toBe(true)
    expect(PATH_WILDCARD_SUFFIX).toBe('[*]')
  })

  it('说明键都真的在目录里（面板上写的是人话，不是 router.fieldNote.xxx）', () => {
    const noted = INPUT_NODE_FIELDS.filter(field => field.noteKey)
    for (const field of noted) {
      expect(t(field.noteKey!), field.path).not.toBe(field.noteKey)
    }
    // 通配投影刻意不带说明键：它们是列表元素的属性，逐条解释反而啰嗦，靠父项那句说明就够。
    expect(INPUT_NODE_FIELDS.filter(field => field.path.includes(PATH_WILDCARD_SUFFIX)).every(field => !field.noteKey)).toBe(true)
  })

  it('请求体里有什么字段属于协议的结论，所以这里只给到 request.body 整体', () => {
    const bodyFields = INPUT_NODE_FIELDS.filter(field => field.path.startsWith('request.body.'))

    expect(bodyFields).toEqual([])
  })
})

describe('MODEL_SELECT_OUTPUT_FIELDS', () => {
  it('只交出决策结果两条：落点列表与「是不是兜底来的」标记', () => {
    expect(MODEL_SELECT_OUTPUT_FIELDS.map(field => field.path)).toEqual(['route.modelIds', 'route.fallback'])
    expect(Object.fromEntries(MODEL_SELECT_OUTPUT_FIELDS.map(field => [field.path, field.valueType]))).toEqual({
      'route.modelIds': 'array',
      'route.fallback': 'boolean',
    })
  })

  it('两条都是无条件产出的（不随取值来源变），空数组也算产出了这一条', () => {
    // 缺了 route.fallback，「取值字段落空」与「恰好选中兜底里那个模型」在图里就分不开。
    expect(MODEL_SELECT_OUTPUT_FIELDS.some(field => field.path === 'route.fallback')).toBe(true)
    expect(MODEL_SELECT_OUTPUT_FIELDS.every(field => field.noteKey)).toBe(true)
  })

  it('路由自身产生的数据一律写在 route 下，不往调用方的 metadata 里塞', () => {
    for (const field of MODEL_SELECT_OUTPUT_FIELDS) {
      expect(field.path.startsWith('route.'), field.path).toBe(true)
    }
  })

  it('说明键都真的在目录里', () => {
    for (const field of MODEL_SELECT_OUTPUT_FIELDS) {
      expect(t(field.noteKey), field.path).not.toBe(field.noteKey)
    }
  })
})
