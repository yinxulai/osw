// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { createPersistedStore, type PersistedStoreSchema, type PersistScope } from './persisted-store'

/*
 * 持久化的唯一实现：`createPersistedStore`。
 *
 * 各页面的 store 只声明「记哪几项」「默认是什么」，所以**回落规则、storage 探测、复位**
 * 只能在这里验，不能靠各个 store 自己的测试顺带覆盖——那样每加一个 store 就重新验一遍
 * 同一段代码，而真正改坏的地方（合并规则）反而没人守。
 */

interface DemoState {
  filter: string
  page: number
  /** 不进存档：一次性的弹窗开关。 */
  dialogOpen: boolean
  setFilter: (filter: string) => void
  setPage: (page: number) => void
  setDialogOpen: (open: boolean) => void
}

interface DemoPersisted {
  filter: string
  page: number
}

const DEFAULTS: DemoPersisted = { filter: 'all', page: 1 }

interface NestedState {
  config: { rounds: number; prompt: string }
  setConfig: (config: { rounds: number; prompt: string }) => void
}

interface NestedPersisted {
  config: { rounds: number; prompt: string }
}

const NESTED_DEFAULTS: NestedPersisted = { config: { rounds: 1, prompt: '' } }

function demoStore(key = 'osw-demo', scope: PersistScope = 'machine') {
  return createPersistedStore<DemoState, DemoPersisted>({
    key,
    scope,
    create: set => ({
      filter: 'all',
      page: 1,
      dialogOpen: false,
      setFilter: filter => set({ filter }),
      setPage: page => set({ page }),
      setDialogOpen: dialogOpen => set({ dialogOpen }),
    }),
    pick: state => ({ filter: state.filter, page: state.page }),
    defaults: DEFAULTS,
  })
}

function nestedStore(key = 'osw-nested') {
  return createPersistedStore<NestedState, NestedPersisted>({
    key,
    scope: 'machine',
    create: set => ({
      config: { rounds: 1, prompt: '' },
      setConfig: config => set({ config }),
    }),
    pick: state => ({ config: state.config }),
    defaults: NESTED_DEFAULTS,
  })
}

/** 读存档；没有就返回 `null`（和 `getItem` 一致，免得把 "null" 和真 null 混起来）。 */
function read(area: 'localStorage' | 'sessionStorage', key: string): unknown {
  const raw = window[area].getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('存在哪：scope', () => {
  it('machine 记进 localStorage（这台机器上的偏好）', () => {
    const { store } = demoStore('osw-machine', 'machine')
    store.getState().setFilter('error')

    expect(read('localStorage', 'osw-machine')).toMatchObject({ state: { filter: 'error' } })
    expect(window.sessionStorage.getItem('osw-machine')).toBeNull()
  })

  it('window 记进 sessionStorage（这个窗口的草稿，关掉就该忘）', () => {
    const { store } = demoStore('osw-window', 'window')
    store.getState().setFilter('error')

    expect(read('sessionStorage', 'osw-window')).toMatchObject({ state: { filter: 'error' } })
    expect(window.localStorage.getItem('osw-window')).toBeNull()
  })

  it('键名就是传进来的字符串，不额外加前缀', () => {
    demoStore('osw-ui').store.getState().setPage(2)

    expect(window.localStorage.getItem('osw-ui')).toBeTruthy()
  })
})

describe('记什么：pick', () => {
  it('只写 pick 出来的那几项，动作与一次性开关不进存档', () => {
    const { store } = demoStore()
    store.getState().setDialogOpen(true)
    store.getState().setPage(3)

    const entry = read('localStorage', 'osw-demo') as { state: Record<string, unknown> }
    expect(entry.state).toEqual({ filter: 'all', page: 3 })
    expect(entry.state).not.toHaveProperty('dialogOpen')
  })
})

describe('旧存档兼容', () => {
  it('存档缺字段时回落到默认值，而不是变成 undefined', () => {
    window.localStorage.setItem('osw-demo', JSON.stringify({ state: { filter: 'warn' }, version: 0 }))

    const { store } = demoStore()

    expect(store.getState()).toMatchObject({ filter: 'warn', page: 1 })
  })

  it('默认值是对象时再往里合一层，缺的子项用默认值', () => {
    window.localStorage.setItem('osw-nested', JSON.stringify({
      state: { config: { rounds: 5 } },
      version: 0,
    }))

    const { store } = nestedStore()

    expect(store.getState()).toMatchObject({ config: { rounds: 5, prompt: '' } })
  })

  it('默认值是对象、存档里那一项却不是对象时整份用默认值', () => {
    // 手改过、或上一版存的是别的形状：一个字符串顶替一整组参数读不出任何一格。
    window.localStorage.setItem('osw-nested', JSON.stringify({
      state: { config: 'rounds=5' },
      version: 0,
    }))

    expect(nestedStore().store.getState()).toMatchObject({ config: NESTED_DEFAULTS.config })
  })

  it('存档是坏 JSON 或根本不是对象时退回内存，不把界面炸掉', () => {
    window.localStorage.setItem('osw-broken', '{not json')
    window.localStorage.setItem('osw-demo', '"just a string"')

    expect(demoStore('osw-broken').store.getState()).toMatchObject(DEFAULTS)
    expect(demoStore().store.getState()).toMatchObject(DEFAULTS)
  })
})

describe('复位', () => {
  it('reset 把内存与存档都带回默认值', () => {
    const { store, reset } = demoStore()
    store.getState().setFilter('error')
    store.getState().setPage(4)

    reset()

    expect(store.getState()).toMatchObject(DEFAULTS)
    expect(read('localStorage', 'osw-demo')).toMatchObject({ state: DEFAULTS })
  })

  it('复位只影响自己这一份', () => {
    const target = demoStore('osw-demo')
    const other = demoStore('osw-other')
    target.store.getState().setFilter('error')
    other.store.getState().setFilter('failed')

    target.reset()

    expect(other.store.getState()).toMatchObject({ filter: 'failed' })
    expect(read('localStorage', 'osw-other')).toMatchObject({ state: { filter: 'failed' } })
  })
})

describe('宿主不提供 storage', () => {
  const scopes: Array<{ scope: PersistScope; area: 'localStorage' | 'sessionStorage' }> = [
    { scope: 'machine', area: 'localStorage' },
    { scope: 'window', area: 'sessionStorage' },
  ]

  it.each(scopes)('$scope 取不到 $area 时退回内存，界面照常能用', ({ scope, area }) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, area)
    Object.defineProperty(window, area, {
      configurable: true,
      get: () => {
        throw new Error('storage disabled')
      },
    })

    try {
      const { store, reset } = demoStore('osw-no-storage', scope)
      store.getState().setFilter('error')

      expect(store.getState()).toMatchObject({ filter: 'error' })
      // 复位同样不能炸——本来就没存下东西。
      expect(() => reset()).not.toThrow()
      expect(store.getState()).toMatchObject(DEFAULTS)
    } finally {
      if (descriptor) Object.defineProperty(window, area, descriptor)
    }
  })

  it.each(scopes)('$scope 的 $area 只有一半 API 时也退回内存', ({ scope, area }) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, area)
    Object.defineProperty(window, area, {
      configurable: true,
      value: { getItem: () => null, setItem: () => undefined },
    })

    try {
      const { store } = demoStore('osw-partial', scope)
      store.getState().setPage(9)

      expect(store.getState()).toMatchObject({ page: 9 })
      expect(window.localStorage.getItem('osw-partial')).toBeNull()
      expect(window.sessionStorage.getItem('osw-partial')).toBeNull()
    } finally {
      if (descriptor) Object.defineProperty(window, area, descriptor)
    }
  })
})

describe('类型契约', () => {
  it('schema 只要求 key / scope / create / pick / defaults 五项', () => {
    const schema: PersistedStoreSchema<DemoState, DemoPersisted> = {
      key: 'osw-schema',
      scope: 'machine',
      create: set => ({
        filter: 'all',
        page: 1,
        dialogOpen: false,
        setFilter: filter => set({ filter }),
        setPage: page => set({ page }),
        setDialogOpen: dialogOpen => set({ dialogOpen }),
      }),
      pick: state => ({ filter: state.filter, page: state.page }),
      defaults: DEFAULTS,
    }

    expect(createPersistedStore(schema).store.getState()).toMatchObject(DEFAULTS)
  })
})
