/**
 * 轻量外部 store 工厂，基于 useSyncExternalStore。
 * 零外部依赖，支持 selector 订阅和浅比较。
 */

import { useSyncExternalStore } from 'react'

export type Listener = () => void

export interface Store<T> {
  getSnapshot: () => T
  setState: (updater: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: Listener) => () => void
  /** 强制通知所有订阅者（用于引用未变但需要刷新的场景） */
  notify: () => void
}

export function createStore<T extends object>(initialState: T): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  const getSnapshot = () => state

  const setState = (updater: Partial<T> | ((prev: T) => Partial<T>)) => {
    const patch = typeof updater === 'function' ? updater(state) : updater
    let hasChange = false
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(state[key], patch[key])) {
        hasChange = true
        break
      }
    }
    if (!hasChange) return
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }

  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const notify = () => {
    listeners.forEach(listener => listener())
  }

  return { getSnapshot, setState, subscribe, notify }
}

/**
 * 订阅 store 的某个切片，仅当切片引用变化时重渲染。
 */
export function useStoreSelector<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  )
}
