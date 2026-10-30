import { useSyncExternalStore } from 'react'

/** 当前**生效**的明暗主题，也就是已经落到 `<html class="dark">` 上的那一个。 */
export type AppliedTheme = 'light' | 'dark'

function readAppliedTheme(): AppliedTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * 「生效主题」的外部存储——所有订阅方共享**同一个** `MutationObserver`。
 *
 * 为什么盯 DOM 而不是读 `useResolvedAppearance`：主题切换的动画（`animated-theme-toggler`）
 * 会在状态落地之前，先手动把 `dark` 类翻到 `<html>` 上。品牌图标要跟这一下走，就得看
 * 真正生效的那个类，而不是尚未传播的偏好值。
 *
 * 以前每个图标组件各建一个 observer + 一份 `useState`；现在收敛成一个模块级单例，
 * 用 `subscribe` / `getSnapshot` 对外（与 `routing/url-overrides` 同一套约定），
 * 组件只用一个 `useSyncExternalStore` 接进去。
 */
let current: AppliedTheme = readAppliedTheme()
const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function handleMutation(): void {
  const next = readAppliedTheme()
  // `class` 还会因为别的原因变动；只有明暗真的翻转时才通知，省掉无谓的重渲染。
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  if (!observer && typeof document !== 'undefined') {
    observer = new MutationObserver(handleMutation)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    // 挂上观察者的这一刻再读一次：订阅前 DOM 可能已经变过。
    current = readAppliedTheme()
  }
  return () => {
    listeners.delete(onStoreChange)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

function getSnapshot(): AppliedTheme {
  return current
}

/** 订阅当前生效的明暗主题。品牌图标据此在亮 / 暗两套图之间切换。 */
export function useAppliedTheme(): AppliedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 仅供测试：重置模块级单例，避免用例之间互相串台。 */
export function __resetAppliedThemeStore(): void {
  observer?.disconnect()
  observer = null
  listeners.clear()
  current = readAppliedTheme()
}
