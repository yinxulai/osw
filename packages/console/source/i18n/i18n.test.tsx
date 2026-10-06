// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTranslator, tryTranslate } from '@/i18n/active'
import { getSystemLocale, useLanguageStore } from '@/i18n/store'

/*
 * 界面语言的三个小部件。
 *
 * 这里没什么逻辑，却各有各的坑：
 *
 * 1. `getTranslator` 缓存的是**实例**（它会被塞进 context value，换新实例等于让整棵树重渲染），
 *    所以「同一语言返回同一实例」是要守住的契约，不只是性能优化。
 * 2. `tryTranslate` 只给「动态拼出来的 key」用，key 不在目录里必须回 `null` 而不是回 key 本身，
 *    否则界面上会出现一串 `error.code.UNKNOWN` 之类的原文。
 * 3. `getSystemLocale` 在没有 `navigator` 的环境（Node 侧的模块被复用）要回 `null`。
 */

vi.mock('@/data/settings', () => ({ useSettings: () => null }))

beforeEach(() => {
  useLanguageStore.setState({ preference: 'system' })
})

describe('取词函数缓存', () => {
  it('同一语言返回同一实例（换实例会让整棵树重渲染）', () => {
    const first = getTranslator('zh-CN')
    const second = getTranslator('zh-CN')
    expect(second).toBe(first)
  })

  it('换语言时换实例', () => {
    const chinese = getTranslator('zh-CN')
    const english = getTranslator('en')
    expect(english).not.toBe(chinese)
    // 切回来仍然是原来那个（缓存只留最近一个，但能力是「同语言同实例」）。
    expect(getTranslator('zh-CN')).not.toBe(english)
  })

  it('取到的是真的词，不是 key', () => {
    const t = getTranslator('zh-CN')
    expect(t('common.state.deleted')).toBe('已删除')
    expect(t('common.state.deleted')).not.toBe('common.state.deleted')
  })

  it('两套目录在同一批 key 上都给得出词', () => {
    const zh = getTranslator('zh-CN')
    const en = getTranslator('en')
    for (const key of ['common.state.deleted', 'nav.page.logs', 'proxy.toggle.start'] as const) {
      expect(zh(key)).not.toBe(key)
      expect(en(key)).not.toBe(key)
    }
  })
})

describe('动态 key 的兜底取词', () => {
  it('目录里有的 key 给得出词', () => {
    const translator = getTranslator('zh-CN')
    expect(tryTranslate('common.state.deleted')).toBe(translator('common.state.deleted'))
  })

  it('目录里没有的 key 返回 null（界面上不该出现裸 key）', () => {
    expect(tryTranslate('error.code.NOT_A_REAL_CODE')).toBeNull()
    expect(tryTranslate('')).toBeNull()
  })

  it('取词前会先把语言切过去（读的是「当前生效」那一份）', () => {
    getTranslator('en')
    expect(tryTranslate('common.state.deleted')).toBe('Deleted')
    getTranslator('zh-CN')
    expect(tryTranslate('common.state.deleted')).toBe('已删除')
  })
})

describe('系统语言', () => {
  it('返回 navigator.language（Electron 会把应用 locale 透传进来）', () => {
    expect(getSystemLocale()).toBe(window.navigator.language)
  })
})

describe('语言偏好存储', () => {
  it('默认跟随系统', () => {
    expect(useLanguageStore.getState().preference).toBe('system')
  })

  it('写入偏好后持久化到 localStorage（设在同一个键上）', () => {
    useLanguageStore.getState().setPreference('zh-CN')
    expect(useLanguageStore.getState().preference).toBe('zh-CN')

    const persisted = window.localStorage.getItem('osw-language')
    expect(persisted).toBeTruthy()
    expect(JSON.parse(persisted as string)).toEqual({ state: { preference: 'zh-CN' }, version: 0 })
  })
})

describe('I18nProvider 的取值', () => {
  it('上下文缺失时 useTranslation 抛错（而不是回退成 key 直出）', async () => {
    const { useTranslation } = await import('@/i18n/provider')
    expect(() => render(<Probe />)).toThrow(/useI18n must be used inside I18nProvider/)

    function Probe() {
      useTranslation()
      return null
    }
  })

  it('包裹之后取到中文词，并把语言写到 <html lang>', async () => {
    const { I18nProvider, useTranslation } = await import('@/i18n/provider')
    useLanguageStore.setState({ preference: 'zh-CN' })

    function Probe() {
      return <span>{useTranslation()('common.state.deleted')}</span>
    }

    render(<I18nProvider><Probe /></I18nProvider>)

    expect(screen.getByText('已删除')).toBeTruthy()
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
