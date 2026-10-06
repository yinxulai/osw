import { describe, expect, it } from 'vitest'

import { WORKFLOW_NODE_KINDS } from '@common/router/types'
import { NODE_COMPONENT_MAP } from '../nodes'
import { PANEL_COMPONENT_MAP } from './index'

/*
 * 右侧节点面板注册表。
 *
 * 与节点视图注册表必须**逐键对齐**：两者都在同一个位置被按 kind 查表，
 * 只补了一边就会出现「节点画得出来、点开却是一片空白」。
 */

const KINDS = [...WORKFLOW_NODE_KINDS]

describe('PANEL_COMPONENT_MAP', () => {
  it('覆盖全部节点种类', () => {
    expect(Object.keys(PANEL_COMPONENT_MAP).sort()).toEqual([...KINDS].sort())
  })

  it('每个种类都有面板组件', () => {
    for (const kind of KINDS) {
      expect(PANEL_COMPONENT_MAP[kind], kind).toBeTruthy()
    }
  })

  it('面板组件彼此不同（同一种面板被登记两次通常是漏改）', () => {
    const components = Object.values(PANEL_COMPONENT_MAP)
    expect(new Set(components).size).toBe(components.length)
  })

  it('与节点视图注册表逐键对齐', () => {
    expect(Object.keys(PANEL_COMPONENT_MAP).sort()).toEqual(Object.keys(NODE_COMPONENT_MAP).sort())
  })

  it('视图与面板是两套组件，不复用（同一个组件同时管画布与配置面板一定是登记错了）', () => {
    for (const kind of KINDS) {
      expect(PANEL_COMPONENT_MAP[kind], kind).not.toBe(NODE_COMPONENT_MAP[kind])
    }
  })
})
