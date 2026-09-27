/**
 * 全局共享的哈希 history 实例。
 *
 * 为什么单独成一个模块：`./router.tsx` 建路由要用它，`./url-overrides.ts` 读地址栏也要用它，
 * 而 `./url-overrides.ts` 被 `I18nProvider`（位于 `RouterProvider` **之上**）间接引用，
 * 直接在那边 import 路由会成环。抽成叶子模块后两边都能安全引用。
 *
 * 为什么是**惰性**单例而不是顶层的 `export const history = createHashHistory()`：
 * 顶层建实例等于给这个模块加了导入副作用，任何「顺带 import 了这条链」的用例都会被执行到 ——
 * 纯 node 环境的用例没有 `window`，会直接崩；把 `@tanstack/react-router` 整体 mock 掉的用例
 * 会因为没有 `createHashHistory` 这个导出而崩。惰性化之后 import 是纯的，
 * 真正建实例推迟到第一次取用（也就是建路由那一刻）。
 */

import { createHashHistory } from '@tanstack/react-router'

type History = ReturnType<typeof createHashHistory>

let cached: History | null = null

/** 取共享的 history。第一次调用时创建，之后返回同一个实例。 */
export function getHistory(): History {
  if (!cached) cached = createHashHistory()
  return cached
}
