import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 设计系统文档的守卫。
 *
 * `docs/design-system/` 里的三份产物（token JSON、README 生成块、预览页）不是手写的，
 * 而是 `scripts/design-system/extract-tokens.mjs` 从 `index.css` 与组件源码里解析出来的。
 * 手写的内容只有解释与判断，数字一律来自解析结果。
 *
 * 这里不重复解析逻辑，而是验证四类"文档会不会开始撒谎"的失效：
 *
 * 1. 源码改了、生成物没重跑 → 文档与实现漂移；
 * 2. 预览页偷偷依赖外部资源 → 离线/`file://` 打开时缺字缺色，但没人发现；
 * 3. 页面里写了 `var(--不存在)` → 该处静默不生效，看起来像"设计如此"；
 * 4. 对比度数字与问题清单的行号被手改/漂移 → 结论失去证据。
 *
 * 守卫不判断设计好坏，只保证"写下来的每个数都能被当前代码复算出来"。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(here, '../../..')
const docsDir = path.join(repositoryRoot, 'docs/design-system')
const extractor = path.join(repositoryRoot, 'scripts/design-system/extract-tokens.mjs')

const readJson = () => JSON.parse(fs.readFileSync(path.join(docsDir, 'tokens.generated.json'), 'utf8'))
const readText = (file: string) => fs.readFileSync(path.join(docsDir, file), 'utf8')

/* 颜色对比度：WCAG 2.1 相对亮度。色值可能带 alpha（8 位 hex），先把它叠到底色上再算。 */
const parseHex = (hex: string): [number, number, number, number] => {
  const digits = hex.replace('#', '')
  const channel = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16) / 255
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return [channel(0), channel(2), channel(4), alpha]
}

const luminance = ([r, g, b]: [number, number, number, number]) => {
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

const contrastRatio = (fgHex: string, bgHex: string) => {
  const foreground = parseHex(fgHex)
  const background = parseHex(bgHex)
  const alpha = foreground[3]
  const composited: [number, number, number, number] = [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ]
  const a = luminance(composited)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/*
 * 文档里的 `var(--token)` 示例（比如"点击复制 var(--token)"）不是真实引用。
 * 这是唯一的例外清单：新增例外必须在注释里写清楚为什么它不是引用。
 */
const documentationPlaceholders = new Set(['--token', '--x'])

type Issue = { id: string; severity: string; evidence: string }

describe('设计系统文档', () => {
  it('生成物与源码一致（不重跑生成器就会红）', () => {
    const result = spawnSync(process.execPath, [extractor, '--check'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      // 测试本身跑在 Electron 的 Node 里，子进程沿用同一个可执行文件。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    expect(result.stderr.trim()).toBe('')
    expect(result.status, result.stdout).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.changed).toEqual({ json: false, readme: false, html: false })
  })

  it('预览页自包含：没有外链、没有远程脚本样式', () => {
    const html = readText('index.html')

    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i)
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i)
    expect(html).not.toMatch(/@import\s+url/i)
    // 数据必须内联：页面要能直接 file:// 双击打开。
    expect(html.length).toBeGreaterThan(100_000)
  })

  it('页面与文档里的每个 var(--x) 都有声明', () => {
    const data = readJson()
    const html = readText('index.html')
    const readme = readText('README.md')

    const declared = new Set<string>(data.inventory.declared)
    // 页面自己的展示变量（`--ds-*` 与本页布局变量）就地声明在同一份 HTML 里。
    for (const match of html.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1])

    const referenced = new Set<string>()
    for (const text of [html, readme]) {
      for (const match of text.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) referenced.add(match[1])
    }

    const dangling = [...referenced].filter(name => !declared.has(name) && !documentationPlaceholders.has(name))
    expect(dangling).toEqual([])
  })

  it('对比度表里的每个数字都能由色值重算', () => {
    const data = readJson()
    expect(data.contrast.length).toBe(data.meta.counts.contrastPairs)

    for (const pair of data.contrast) {
      for (const mode of ['light', 'dark'] as const) {
        const measurement = pair[mode]
        const recomputed = contrastRatio(measurement.fgHex, measurement.bgHex)
        expect(Math.abs(recomputed - measurement.ratio), `${pair.id} (${mode})`).toBeLessThan(0.02)
        if (pair.threshold !== null) {
          expect(measurement.pass, `${pair.id} (${mode}) 的结论与阈值不符`).toBe(recomputed + 0.005 >= pair.threshold)
        }
      }
    }
  })

  it('问题清单引用的文件与行号仍然存在', () => {
    const data = readJson()
    const issues = data.issues as Issue[]
    const evidencePattern = /((?:packages|apps)\/[\w\-./]+\.(?:tsx|ts|css|md|mjs)):(\d+)/g

    expect(issues.length).toBeGreaterThan(0)
    expect(new Set(issues.map(issue => issue.id)).size).toBe(issues.length)

    for (const issue of issues) {
      expect(['P0', 'P1', 'P2', 'P3']).toContain(issue.severity)
      expect(issue.evidence.trim()).not.toBe('')

      const citations = [...issue.evidence.matchAll(evidencePattern)]
      expect(citations.length, `${issue.id} 没有可核对的源码位置`).toBeGreaterThan(0)

      for (const [, file, line] of citations) {
        const absolute = path.join(repositoryRoot, file)
        expect(fs.existsSync(absolute), `${issue.id} 引用的文件不存在：${file}`).toBe(true)
        const lines = fs.readFileSync(absolute, 'utf8').split('\n')
        const index = Number(line)
        expect(index, `${issue.id} 的行号越界：${file}:${line}`).toBeLessThanOrEqual(lines.length)
        expect(lines[index - 1]?.trim(), `${issue.id} 指向空行：${file}:${line}`).not.toBe('')
      }
    }

    // 统计数必须与清单一致，避免"正文写的 5 个 P0、表里只有 4 条"。
    const counts = Object.fromEntries(
      ['P0', 'P1', 'P2', 'P3'].map(severity => [severity, issues.filter(issue => issue.severity === severity).length]),
    )
    expect(counts).toEqual(data.meta.issues)
  })
})
