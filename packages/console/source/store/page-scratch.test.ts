// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { clearAllPageScratch, clearPageScratch, createPageScratchStore, scratchStorageKey } from './page-scratch'

interface DemoState {
  filter: string
  page: number
  /** 不进草稿：一次性的弹窗开关。 */
  dialogOpen: boolean
  setFilter: (filter: string) => void
  setPage: (page: number) => void
  setDialogOpen: (open: boolean) => void
}

interface DemoScratch {
  filter: string
  page: number
}

const DEFAULTS: DemoScratch = { filter: 'all', page: 1 }

interface NestedState {
  filter: { level: string; scope: string }
  page: number
  setFilter: (filter: { level: string; scope: string }) => void
  setPage: (page: number) => void
}

interface NestedScratch {
  filter: { level: string; scope: string }
  page: number
}

/** 建一页临时状态；`suffix` 用来让同一条用例里出现多页，互不覆盖键名。 */
function demoPage(suffix = 'demo') {
  return createPageScratchStore<DemoState, DemoScratch>({
    page: suffix,
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

function read(key: string): unknown {
  const raw = window.sessionStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('键名', () => {
  it('统一挂在 osw-scratch: 前缀下，一眼看得出是临时草稿', () => {
    expect(scratchStorageKey('logs')).toBe('osw-scratch:logs')
  })
})

describe('存与读', () => {
  it('没有存档时用默认值', () => {
    const { store } = demoPage()

    expect(store.getState()).toMatchObject(DEFAULTS)
  })

  it('记在 sessionStorage 而不是 localStorage（关掉窗口就该忘掉）', () => {
    const { store } = demoPage()
    store.getState().setFilter('error')

    expect(read('osw-scratch:demo')).toMatchObject({ state: { filter: 'error' } })
    expect(window.localStorage.getItem('osw-scratch:demo')).toBeNull()
  })

  it('只记 pick 出来的那几项，动作与一次性开关不进存档', () => {
    const { store } = demoPage()
    store.getState().setDialogOpen(true)
    store.getState().setPage(3)

    const entry = read('osw-scratch:demo') as { state: Record<string, unknown> }
    expect(entry.state).toEqual({ filter: 'all', page: 3 })
    expect(entry.state).not.toHaveProperty('dialogOpen')
  })

  it('新开一个同样的页面会读回上次的值', () => {
    demoPage().store.getState().setFilter('warn')

    // 重新建一次等价于重载窗口后重新加载模块。
    const reopened = demoPage()

    expect(reopened.store.getState()).toMatchObject({ filter: 'warn', page: 1 })
  })
})

describe('旧存档兼容', () => {
  it('存档缺字段时回落到默认值，而不是变成 undefined', () => {
    window.sessionStorage.setItem('osw-scratch:demo', JSON.stringify({
      state: { filter: 'warn' },
      version: 0,
    }))

    const { store } = demoPage()

    expect(store.getState()).toMatchObject({ filter: 'warn', page: 1 })
  })

  it('筛选条件这类嵌套对象再往里合一层，老存档里没有的子项用默认值', () => {
    window.sessionStorage.setItem('osw-scratch:nested', JSON.stringify({
      state: { filter: { level: 'warn' }, page: 2 },
      version: 0,
    }))

    const { store } = createPageScratchStore<NestedState, NestedScratch>({
      page: 'nested',
      create: set => ({
        filter: { level: 'all', scope: 'proxy' },
        page: 1,
        setFilter: filter => set({ filter }),
        setPage: page => set({ page }),
      }),
      pick: state => ({ filter: state.filter, page: state.page }),
      defaults: { filter: { level: 'all', scope: 'proxy' }, page: 1 },
    })

    expect(store.getState()).toMatchObject({ filter: { level: 'warn', scope: 'proxy' }, page: 2 })
  })

  it('存档是坏 JSON 或不是对象时退回内存，不把页面炸掉', () => {
    window.sessionStorage.setItem('osw-scratch:broken', '{not json')
    window.sessionStorage.setItem('osw-scratch:demo', '"just a string"')

    expect(demoPage('broken').store.getState()).toMatchObject(DEFAULTS)
    expect(demoPage().store.getState()).toMatchObject(DEFAULTS)
  })
})

describe('清场', () => {
  it('清一页：删掉它自己的键、复位内存，别的键一概不动', () => {
    const page = demoPage()
    page.store.getState().setFilter('error')
    const other = demoPage('request-logs')
    other.store.getState().setFilter('failed')
    window.localStorage.setItem('osw-ui', '{"state":{"themeMode":"dark"},"version":0}')

    clearPageScratch('demo')

    expect(window.sessionStorage.getItem('osw-scratch:demo')).toBeNull()
    expect(page.store.getState()).toMatchObject(DEFAULTS)
    expect(read('osw-scratch:request-logs')).toMatchObject({ state: { filter: 'failed' } })
    expect(window.localStorage.getItem('osw-ui')).not.toBeNull()
  })

  it('清全部：sessionStorage 里只剩不是草稿的键，localStorage 一点没动', () => {
    const logs = demoPage('logs')
    const requestLogs = demoPage('request-logs')
    logs.store.getState().setFilter('error')
    requestLogs.store.getState().setFilter('failed')
    window.sessionStorage.setItem('unrelated', 'keep me')
    window.localStorage.setItem('osw-ui', '{"state":{},"version":0}')

    clearAllPageScratch()

    expect(window.sessionStorage.getItem('osw-scratch:logs')).toBeNull()
    expect(window.sessionStorage.getItem('osw-scratch:request-logs')).toBeNull()
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep me')
    expect(window.localStorage.getItem('osw-ui')).not.toBeNull()
    expect(logs.store.getState()).toMatchObject(DEFAULTS)
    expect(requestLogs.store.getState()).toMatchObject(DEFAULTS)
  })

  it('清完全部之后不会又留下一批写着默认值的键', () => {
    demoPage('logs').store.getState().setFilter('error')

    clearAllPageScratch()

    expect(Object.keys(window.sessionStorage)).toHaveLength(0)
  })
})

describe('没有 storage 的宿主', () => {
  it('读不到 sessionStorage 时退回内存：页面照常能用，只是不记事', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage disabled')
      },
    })

    try {
      const { store } = demoPage('no-storage')
      store.getState().setFilter('error')

      expect(store.getState()).toMatchObject({ filter: 'error' })
      // 清场也不能炸——本来就没存下东西。
      expect(() => clearPageScratch('no-storage')).not.toThrow()
      expect(() => clearAllPageScratch()).not.toThrow()
    } finally {
      if (descriptor) Object.defineProperty(window, 'sessionStorage', descriptor)
    }
  })
})
