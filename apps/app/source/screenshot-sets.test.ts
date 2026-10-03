import { describe, expect, it } from 'vitest'
import {
  buildScreenshotUrl,
  expandScreenshotSet,
  findScreenshotSet,
  SCREENSHOT_SETS,
  type ScreenshotSet,
} from './screenshot-sets'

/**
 * 编排层是「拍哪些页、拍成什么语言主题」这件事的唯一决策点 —— 引擎只认它展开出的
 * case 列表。所以这里的断言都冲着「一份 set 展开成什么」去，而不是引擎怎么抓图。
 */
describe('expandScreenshotSet', () => {
  const set: ScreenshotSet = {
    name: 'test',
    description: 'test set',
    shots: [
      { fileName: 'a', route: '/a' },
      { fileName: 'b', route: '/b?x=1' },
    ],
  }

  it('expands a set with no locale/theme restriction into both languages and both themes', () => {
    const cases = expandScreenshotSet(set)
    // 2 页 × 2 语言 × 2 主题。
    expect(cases).toHaveLength(8)
    expect(new Set(cases.map(captureCase => captureCase.locale))).toEqual(new Set(['en', 'zh-CN']))
    expect(new Set(cases.map(captureCase => captureCase.theme))).toEqual(new Set(['light', 'dark']))
  })

  it('honours an explicit locale/theme restriction', () => {
    const cases = expandScreenshotSet({ ...set, themes: ['light'] })
    expect(cases).toHaveLength(4)
    expect(cases.every(captureCase => captureCase.theme === 'light')).toBe(true)
  })

  it('carries per-shot storage state through to every expanded case', () => {
    const storage = { 'osw-ui': { state: { onboardingComplete: false }, version: 0 } }
    const cases = expandScreenshotSet({ ...set, shots: [{ fileName: 'a', route: '/a', storage }], themes: ['light'], locales: ['en'] })
    expect(cases).toEqual([expect.objectContaining({ storage })])
  })

  it('carries per-shot clip through to every expanded case', () => {
    const clip = { selector: '[data-screenshot="route-mode"]', padding: 12 }
    const cases = expandScreenshotSet({ ...set, shots: [{ fileName: 'a', route: '/a', clip }], themes: ['light'], locales: ['en'] })
    expect(cases).toEqual([expect.objectContaining({ clip })])
  })
})

describe('buildScreenshotUrl', () => {
  it('keeps the query string that lives inside the hash route', () => {
    // `/overview?range=7d` 自带查询串，而语言/主题也挂在 hash 上：手工拼只有一个规则，
    // 不会拼出两层 `?`。
    expect(buildScreenshotUrl('http://localhost:5173', { route: '/overview?range=7d', locale: 'zh-CN', theme: 'dark' }))
      .toBe('http://localhost:5173#/overview?range=7d?lang=zh-CN&theme=dark')
  })
})

describe('SCREENSHOT_SETS', () => {
  it('has a site set and a docs set with unique names', () => {
    const names = SCREENSHOT_SETS.map(set => set.name)
    expect(names).toContain('site')
    expect(names).toContain('docs')
    expect(new Set(names).size).toBe(names.length)
  })

  it('resolves known sets and rejects unknown ones', () => {
    expect(findScreenshotSet('docs')?.name).toBe('docs')
    expect(findScreenshotSet('nope')).toBeUndefined()
  })

  it('keeps fileName unique within each set', () => {
    for (const set of SCREENSHOT_SETS) {
      const fileNames = set.shots.map(shot => shot.fileName)
      expect(new Set(fileNames).size).toBe(fileNames.length)
    }
  })
})
