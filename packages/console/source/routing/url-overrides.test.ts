// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getHistory } from './history'
import { LANG_PARAM, THEME_PARAM, appearanceSearch, isThemeParam, parseOverrides, useUrlOverrides } from './url-overrides'

/*
 * 地址栏里的 `?lang=` / `?theme=`：语言与主题的「这一屏怎么看」。
 *
 * 三条容易出错、也最容易在重构里被悄悄改掉的规则，都在这里钉住：
 *  1. 解析走的是 `normalizeLocale`，`?lang=zh`、`?lang=zh-TW`、`?lang=zh-Hans-CN` 都算中文；
 *  2. `?theme=system` 是**合法值**（表达「跟随系统」这个选择），不是「没有值」；
 *  3. `appearanceSearch` 只补缺的，已经有的键一律不动，且 `null` 表示这一项不写。
 */

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('isThemeParam', () => {
  it('三个合法值都对', () => {
    expect(isThemeParam('light')).toBe(true)
    expect(isThemeParam('dark')).toBe(true)
    expect(isThemeParam('system')).toBe(true)
  })

  it('其它一律不是', () => {
    for (const value of ['', 'Dark', 'auto', null, undefined, 0, {}]) {
      expect(isThemeParam(value)).toBe(false)
    }
  })
})

describe('parseOverrides', () => {
  it('什么都不带时两项都是 null', () => {
    expect(parseOverrides('#/router')).toEqual({ lang: null, theme: null })
  })

  it('正正经经的 query 都能读出来', () => {
    expect(parseOverrides('#/router?lang=zh-CN&theme=dark')).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('不规范的写法也收敛到同一个语言（zh / zh-TW / zh-Hans-CN 都是中文）', () => {
    for (const raw of ['zh', 'zh-TW', 'zh-Hans-CN', 'ZH-cn']) {
      expect(parseOverrides(`#/router?lang=${raw}`).lang).toBe('zh-CN')
    }
  })

  it('不是中文就是英文，其它语种当作没给', () => {
    expect(parseOverrides('#/router?lang=en-GB').lang).toBe('en')
    expect(parseOverrides('#/router?lang=fr').lang).toBeNull()
  })

  it('主题参数大小写敏感，`Dark` 当作没给（免得写出两个都像对的取值）', () => {
    expect(parseOverrides('#/router?theme=Dark').theme).toBeNull()
  })

  it('system 会被如实读出来，不被当成空', () => {
    expect(parseOverrides('#/router?theme=system').theme).toBe('system')
  })

  it('不带 # 的裸地址也能解析（history 给的 href 形态不止一种）', () => {
    expect(parseOverrides('/router?lang=en&theme=light')).toEqual({ lang: 'en', theme: 'light' })
  })

  it('参数重复时取第一个（URLSearchParams 的既有行为）', () => {
    expect(parseOverrides('#/router?lang=en&lang=zh-CN').lang).toBe('en')
  })

  it('空值参数当作没给', () => {
    expect(parseOverrides('#/router?lang=&theme=')).toEqual({ lang: null, theme: null })
  })

  it('只认识这两项，别的参数照旧忽略', () => {
    expect(parseOverrides('#/router?providerId=p1&lang=en')).toEqual({ lang: 'en', theme: null })
  })
})

describe('appearanceSearch', () => {
  it('两项都缺时都补上', () => {
    expect(appearanceSearch({}, { lang: 'zh-CN', theme: 'dark' })).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('已经有的键一律不动——不覆盖用户手改的地址栏', () => {
    const current = { lang: 'en', theme: 'system' }
    expect(appearanceSearch(current, { lang: 'zh-CN', theme: 'light' })).toEqual({ lang: 'en', theme: 'system' })
  })

  it('同层其它键必须带出来（search 是整体替换语义）', () => {
    expect(appearanceSearch({ providerId: 'p1' }, { lang: 'en', theme: null })).toEqual({ providerId: 'p1', lang: 'en' })
  })

  it('值为 null 表示这项不动，不会留下 `?lang=` 这种空值', () => {
    expect(appearanceSearch({}, { lang: null, theme: null })).toEqual({})
  })

  it('不改动传进来的对象', () => {
    const current = { providerId: 'p1' }
    appearanceSearch(current, { lang: 'en', theme: null })
    expect(current).toEqual({ providerId: 'p1' })
  })
})

describe('useUrlOverrides', () => {
  it('首帧就读到地址栏里的值', () => {
    getHistory().push('#/router?lang=en&theme=light')

    const view = renderHook(() => useUrlOverrides())
    expect(view.result.current).toEqual({ lang: 'en', theme: 'light' })
  })

  it('地址栏变了就重算（不刷新页面）', () => {
    getHistory().push('#/router')
    const view = renderHook(() => useUrlOverrides())
    expect(view.result.current).toEqual({ lang: null, theme: null })

    act(() => { getHistory().push('#/router?lang=zh-CN&theme=dark') })

    expect(view.result.current).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('href 没变时返回同一个对象（useSyncExternalStore 反复取快照不能换引用）', () => {
    getHistory().push('#/router?lang=en')
    const view = renderHook(() => useUrlOverrides())

    const first = view.result.current
    view.rerender()

    expect(view.result.current).toBe(first)
  })

  it('同一次渲染里解析结果被缓存，切走再切回来仍是同一份内容', () => {
    getHistory().push('#/router?lang=zh-CN&theme=dark')
    const view = renderHook(() => useUrlOverrides())
    act(() => { getHistory().push('#/router?lang=en') })
    expect(view.result.current.lang).toBe('en')

    act(() => { getHistory().push('#/router?lang=zh-CN&theme=dark') })
    expect(view.result.current).toEqual({ lang: 'zh-CN', theme: 'dark' })
  })

  it('卸载后再变化不会报「更新已卸载组件」', () => {
    getHistory().push('#/router')
    const view = renderHook(() => useUrlOverrides())
    view.unmount()

    expect(() => act(() => { getHistory().push('#/router?lang=en') })).not.toThrow()
  })
})

describe('参数名', () => {
  it('就用 lang 与 theme 两个短名', () => {
    expect(LANG_PARAM).toBe('lang')
    expect(THEME_PARAM).toBe('theme')
  })
})
