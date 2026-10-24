import { afterEach } from 'vitest'

// Vitest 未开启 `globals`，Testing Library 依赖全局 `afterEach` 注册的自动 cleanup
// 不会生效，导致上一个用例渲染的 DOM 残留并污染后续用例（例如「空状态」文本）。
// 这里显式清理，仅在 jsdom 环境下执行，node 环境直接跳过。
//
// 为什么住在 console：需要 DOM 清理的只有控制台的组件测试（jsdom + Testing Library），
// core / contracts 的用例跑在 node 环境里，走到这里会直接 return。
afterEach(async () => {
  if (typeof document === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})

// jsdom 没有实现 `matchMedia`，而订阅深色偏好的两处代码（App 的主题监听、
// sonner 的 Toaster）都在挂载时就会调用它，缺了这个 shim 组件压根渲染不出来。
// 固定返回「不匹配」，即测试一律跑在浅色分支上，断言不受宿主系统主题影响。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom 也没有实现 `Element.prototype.scrollIntoView`，而 radix 的 Select / DropdownMenu
// 在打开时会对高亮项调用它（选中项滚动到可视区）。缺了这个 shim，一交互就抛
// `candidate?.scrollIntoView is not a function`。空实现即可——测试里不验滚动位置。
if (typeof window !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
