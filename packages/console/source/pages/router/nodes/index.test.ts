import { describe, expect, it } from 'vitest'

import { WORKFLOW_NODE_KINDS } from '@common/router/types'
import { NODE_KIND_META } from '../node-meta'
import { NODE_COMPONENT_MAP } from './index'

/*
 * 画布节点视图注册表。
 *
 * 这张表在 `workflow-node.tsx` 里被按 kind 查：少一个键的后果不是编译错误而是运行时白块
 * （React Flow 找不到组件就什么都不画），所以这里把键集钉死，并对齐 `node-meta` 的清单。
 */

const KINDS = [...WORKFLOW_NODE_KINDS]

describe('WORKFLOW_NODE_KINDS', () => {
  it('正好十种节点，顺序就是节点选择器里的分组顺序（输入 → 控制 → 判断 → 落点 → 出口，便签在最后）', () => {
    expect(KINDS).toEqual([
      'input',
      'control-input',
      'protocol-discovery',
      'condition',
      'model-select',
      'iteration',
      'script',
      'prompt',
      'note',
      'output',
    ])
  })

  it('没有重复的种类', () => {
    expect(new Set(KINDS).size).toBe(KINDS.length)
  })
})

describe('NODE_COMPONENT_MAP', () => {
  it('覆盖全部节点种类', () => {
    expect(Object.keys(NODE_COMPONENT_MAP).sort()).toEqual([...KINDS].sort())
  })

  it('每个种类都有组件（不能有 undefined 的洞）', () => {
    for (const kind of KINDS) {
      expect(NODE_COMPONENT_MAP[kind], kind).toBeTruthy()
    }
  })

  it('视图组件彼此不同（同一种视图被登记两次通常是漏改）', () => {
    const components = Object.values(NODE_COMPONENT_MAP)
    expect(new Set(components).size).toBe(components.length)
  })
})

describe('与节点元数据表的一致性', () => {
  it('node-meta 的元数据表覆盖同一批种类', () => {
    expect(Object.keys(NODE_KIND_META).sort()).toEqual([...KINDS].sort())
  })

  it('每个种类都有名称、说明与图标（节点选择器整个读这张表）', () => {
    for (const kind of KINDS) {
      const meta = NODE_KIND_META[kind]
      expect(meta.labelKey, kind).toBeTruthy()
      expect(meta.hintKey, kind).toBeTruthy()
      expect(meta.icon, kind).toBeTruthy()
      expect(meta.tone, kind).toMatch(/^bg-/)
    }
  })
})
