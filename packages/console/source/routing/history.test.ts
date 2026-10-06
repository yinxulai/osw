// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { getHistory } from './history'

/*
 * 全局共享的 history。
 *
 * 关键行为只有一个但很容易被「顺手改成顶层常量」破坏：**惰性**。
 * 这个模块被 `I18nProvider` 间接引用，纯 node 环境的用例没有 `window`——
 * 顶层 `createHashHistory()` 会让那些用例在 import 阶段就崩。
 */

describe('getHistory', () => {
  it('返回同一个实例（路由与地址栏读写必须共用一份）', () => {
    expect(getHistory()).toBe(getHistory())
  })

  it('是个可用的 hash history：能读 location、能订阅', () => {
    const history = getHistory()
    expect(typeof history.location.href).toBe('string')
    expect(typeof history.subscribe).toBe('function')
    expect(typeof history.push).toBe('function')
  })

  it('订阅后 push 能收到通知，退订后不再收到', () => {
    const history = getHistory()
    let count = 0
    const unsubscribe = history.subscribe(() => { count += 1 })

    history.push('#/router')
    expect(count).toBe(1)

    unsubscribe()
    history.push('#/logs')
    expect(count).toBe(1)
  })

  it('push 之后 location 跟着变（改完能立刻读到）', () => {
    const history = getHistory()
    history.push('#/router?lang=en')
    expect(history.location.href).toContain('/router')
    expect(history.location.href).toContain('lang=en')
  })
})
