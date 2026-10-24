import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BILL_BACKDROP_ICON_URLS } from './bill-backdrop-icons'

/*
 * 导出账单的背景图标。
 *
 * 这一层存在的唯一理由是「导出过程完全不碰网络」：桌面端是 `file://` 加载的，
 * `html-to-image` 去 `fetch` `<img>` 资源会被浏览器直接拒绝，导出图里的图标会整片消失。
 * 所以图标必须**在构建期**被内联进来，转成 data URL。
 *
 * 这条链一旦断掉是**静默**的：`import.meta.glob` 匹配不到文件时返回空对象，不报错、
 * 不警告，导出图只是少了一层肌理——没有测试的话没人会发现。
 */

/** 带 identity 的 data URL 前缀；`SVG` 源码里有 `#`、`<`、`>`，必须编码。 */
const DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,'

const PROVIDER_ICON_DIR = join(process.cwd(), 'packages/console/source/catalog/providers')

/** 按目录名排序的厂商图标 —— 与实现里的 `Object.keys(...).sort()` 同一套顺序。 */
function expectedIconUrls(): string[] {
  return readdirSync(PROVIDER_ICON_DIR, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => item.name)
    .sort()
    .map(key => DATA_URL_PREFIX + encodeURIComponent(readFileSync(join(PROVIDER_ICON_DIR, key, 'icon.dark.svg'), 'utf8')))
}

describe('背景图标资源', () => {
  it('构建期真的把厂商图标内联进来了（glob 路径必须指向图标实际所在目录）', () => {
    expect(BILL_BACKDROP_ICON_URLS.length).toBeGreaterThan(0)
  })

  it('与磁盘上的厂商 dark 图标逐项一致：不重不漏、顺序与目录名排序相同', () => {
    // 顺序稳定是导出的硬要求：同一份账单每次导出必须长得一模一样。
    expect(BILL_BACKDROP_ICON_URLS).toEqual(expectedIconUrls())
  })

  it('每个厂商的 dark 图标都在（导出底板是深色，light 变体会糊成黑块）', () => {
    // `catalog/providers` 下每个厂商都有一份 icon.dark.svg。
    expect(BILL_BACKDROP_ICON_URLS).toHaveLength(12)
  })

  it('全是 data URL，导出时不会触发任何网络请求', () => {
    for (const url of BILL_BACKDROP_ICON_URLS) {
      expect(url.startsWith(DATA_URL_PREFIX)).toBe(true)
      // `xmlns="http://www.w3.org/2000/svg"` 里的 http 是被编码过的命名空间，不是请求目标。
      expect(url).not.toMatch(/^https?:/)
    }
  })

  it('解出来是真正的 SVG 源码，不是空串或文件路径', () => {
    const svg = decodeURIComponent(BILL_BACKDROP_ICON_URLS[0].slice(DATA_URL_PREFIX.length))
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('没有重复项（重复只是把同一个图标叠画两遍，白费一次光栅化）', () => {
    expect(new Set(BILL_BACKDROP_ICON_URLS).size).toBe(BILL_BACKDROP_ICON_URLS.length)
  })

  it('特殊字符被百分号编码了，不会把 data URL 截断', () => {
    // SVG 源码里的 `<`、`>`、`"`、`#` 若原样进 URL，浏览器会在 `#` 处当成 fragment 截断。
    for (const url of BILL_BACKDROP_ICON_URLS) {
      expect(url).not.toContain('<')
      expect(url).not.toContain('>')
      expect(url).not.toContain('"')
      expect(url).not.toContain('#')
    }
  })
})
