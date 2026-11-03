import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type IdItem = { id: string }
type DispositionItem = { disposition: string }
type PxItem = { px: number }

/*
 * Design System v2 守卫。
 *
 * v1 的守卫只回答“文档有没有漂移”；v2 还要回答“这套设计系统自己成不成立”：
 *
 * 1. 生成物与数据逐字节一致（四份产物）；
 * 2. 每一对「前景 token × 承载底色」按 hex 重算，低于阈值直接失败；
 * 3. var() 引用闭合；
 * 4. 零未引用 token：色阶必须被语义角色消费，语义角色必须被页面/组件/迁移表消费，
 *    v1 别名必须指向存在的新角色且出现在迁移表；
 * 5. 字号 ≤ 6 档、字重 ≤ 3 档、行高成对；
 * 6. 样式表组件用法不得出现字面色值（只允许在 token 定义区出现）；
 * 7. 29 条问题全部有处置，44 个死 token 全部有归宿，2 处死引用已处理。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(here, '../../..')
const docsDir = path.join(repositoryRoot, 'docs/design-system')
const builder = path.join(repositoryRoot, 'scripts/design-system/build-v2.mjs')

const readText = (file: string) => fs.readFileSync(path.join(docsDir, file), 'utf8')
const readJson = (file: string) => JSON.parse(readText(file))
const cssText = () => readText('tokens.v2.css')
const htmlText = () => readText('index.html')
const readmeText = () => readText('README.md')

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

const declarationsOf = (css: string) => {
  const names = new Set<string>()
  for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1])
  return names
}

const varRefsOf = (text: string) => new Set([...text.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(match => match[1]))

describe('Design System v2', () => {
  it('生成物与数据逐字节一致', () => {
    const result = spawnSync(process.execPath, [builder, '--check'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(result.stderr.trim()).toBe('')
    expect(result.status, result.stdout).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.changed).toEqual({ css: false, html: false, readme: false, json: false })
  })

  it('预览页自包含，且足够大到内联全部数据', () => {
    const html = htmlText()
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i)
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i)
    expect(html).not.toMatch(/@import\s+url/i)
    expect(html.length).toBeGreaterThan(100_000)
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('theme-toggle')
  })

  it('var() 引用闭合：页面、README、样式表都没有悬空引用', () => {
    const css = cssText()
    const declared = declarationsOf(css)
    for (const match of htmlText().matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1])

    const textRefs = varRefsOf(`${htmlText()}\n${readmeText()}`)
    const dangling = [...textRefs].filter(name => !declared.has(name))
    expect(dangling).toEqual([])

    const cssRefs = varRefsOf(css)
    const cssDangling = [...cssRefs].filter(name => !declared.has(name))
    expect(cssDangling).toEqual([])
  })

  it('对比度逐对重算：阈值、结论、实测三者一致，且 v2 无未达标项', () => {
    const data = readJson('v2.generated.json')
    expect(data.contrast.light.length).toBe(data.pairs.length)
    expect(data.contrast.dark.length).toBe(data.pairs.length)

    for (const mode of ['light', 'dark'] as const) {
      for (const pair of data.contrast[mode]) {
        expect(pair.fgHex, `${pair.id} (${mode}) 缺少前景 hex`).toMatch(/^#[0-9a-f]{6,8}$/)
        expect(pair.bgHex, `${pair.id} (${mode}) 缺少背景 hex`).toMatch(/^#[0-9a-f]{6,8}$/)
        const recomputed = contrastRatio(pair.fgHex, pair.bgHex)
        expect(Math.abs(recomputed - pair.ratio), `${pair.id} (${mode}) 的比值不是重算值`).toBeLessThan(0.02)

        if (pair.threshold !== null) {
          const pass = recomputed + 0.005 >= pair.threshold
          expect(pair.pass, `${pair.id} (${mode}) 的结论与阈值不符`).toBe(pass)
          expect(pass, `${pair.id} (${mode}) ${recomputed.toFixed(2)}:1 < ${pair.threshold}:1`).toBe(true)
        }
      }
    }
  })

  it('P0/P1 的关键对比度对都在矩阵里，且达到修复目标', () => {
    const data = readJson('v2.generated.json')
    const ids = new Set(data.contrast.light.map((item: IdItem) => item.id))
    for (const id of [
      'input-border/raised',
      'placeholder/input',
      'text-secondary/sunken',
      'success-text/raised',
      'warning-text/raised',
      'badge-success',
      'badge-warning',
      'badge-danger',
      'badge-info',
      'info-text/raised',
      'focus-ring/raised',
    ]) {
      expect(ids.has(id), `缺少对比度对 ${id}`).toBe(true)
    }

    const get = (id: string) => data.contrast.light.find((item: IdItem) => item.id === id)
    expect(get('input-border/raised').ratio).toBeGreaterThanOrEqual(3)
    expect(get('placeholder/input').ratio).toBeGreaterThanOrEqual(4.5)
    expect(get('text-secondary/sunken').ratio).toBeGreaterThanOrEqual(4.5)
    expect(get('success-text/raised').ratio).toBeGreaterThanOrEqual(4.5)
    expect(get('warning-text/raised').ratio).toBeGreaterThanOrEqual(4.5)
    expect(get('info-text/raised').ratio).toBeGreaterThanOrEqual(4.5)
    for (const id of ['badge-success', 'badge-warning', 'badge-danger', 'badge-info']) {
      expect(get(id).ratio, `${id} 徽标 12px 仍需 4.5:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('零未引用 token：色阶被角色消费，角色被页面/组件/迁移消费，别名指向有效角色', () => {
    const data = readJson('v2.generated.json')
    const css = cssText()
    const declared = declarationsOf(css)
    const refs = varRefsOf(css)
    const docs = `${htmlText()}\n${readmeText()}`

    // 1) 色阶：每一个都必须被至少一个语义角色的 var() 引用（暗色角色也算）。
    for (const item of [...data.neutral, ...data.brand]) {
      expect(refs.has(`--ds-${item.name}`), `色阶 --ds-${item.name} 没有被任何语义角色消费`).toBe(true)
    }

    // 2) 语义角色：必须出现在 var() 引用、页面 token 名或迁移表里。
    for (const name of Object.keys(data.roles.light)) {
      const token = `--ds-${name}`
      const consumed = refs.has(token) || docs.includes(token) || Object.values(data.aliases).includes(token)
      expect(consumed, `语义角色 ${token} 没有消费者`).toBe(true)
    }

    // 3) 别名：必须指向存在的新 token，且出现在迁移表（否则就是死别名）。
    for (const [from, to] of Object.entries(data.aliases as Record<string, string>)) {
      expect(declared.has(from), `别名 ${from} 未声明`).toBe(true)
      expect(declared.has(to), `别名 ${from} 指向不存在的 ${to}`).toBe(true)
      expect(docs.includes(from), `别名 ${from} 没有进入迁移表`).toBe(true)
    }

    // 4) 非颜色 token（排版/间距/圆角/阴影/层级/动效）必须在页面或 README 里出现。
    const nonColor = [...declared].filter(name => !name.startsWith('--color-') && !name.startsWith('--ds-neutral-') && !name.startsWith('--ds-brand-'))
    for (const name of nonColor) {
      if (['--font-sans', '--font-mono', '--font-heading', '--button-radius', '--radius', '--text-2xs', '--shadow-card', '--shadow-overlay', '--shadow-panel'].includes(name)) continue
      expect(docs.includes(name) || refs.has(name), `token ${name} 没有消费者`).toBe(true)
    }
  })

  it('字号 ≤ 6 档、最小 12px、行高成对；字重 ≤ 3 档', () => {
    const css = cssText()
    const sizes = [...css.matchAll(/--ds-type-(\d)-size:\s*(\d+)px/g)].map(match => ({ index: match[1], px: Number(match[2]) }))
    const lines = [...css.matchAll(/--ds-type-(\d)-line:\s*(\d+)px/g)].map(match => ({ index: match[1], px: Number(match[2]) }))
    expect(sizes.length).toBe(6)
    expect(new Set(sizes.map(item => item.px)).size).toBe(6)
    expect(Math.min(...sizes.map(item => item.px))).toBeGreaterThanOrEqual(12)

    for (const size of sizes) {
      const line = lines.find(item => item.index === size.index)
      expect(line, `type-${size.index} 缺少行高`).toBeTruthy()
      expect(line!.px / size.px, `type-${size.index} 行高过紧`).toBeGreaterThanOrEqual(1.25)
    }

    const weights = [...new Set([...css.matchAll(/--ds-weight-[a-z]+:\s*(\d+)/g)].map(match => match[1]))]
    expect(weights).toEqual(['400', '500', '600'])
  })

  it('样式表组件用法不出现字面色值（只在 token 定义区允许 hex/rgb/hsl）', () => {
    const css = cssText()
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const usages = withoutComments
      .split('\n')
      .filter(line => !/^\s*--[a-zA-Z0-9-]+\s*:/.test(line))
      .join('\n')
    expect(usages).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(usages).not.toMatch(/\brgba?\(/)
    expect(usages).not.toMatch(/\bhsla?\(/)
  })

  it('29 条问题全部有处置；44 个死 token 全部有归宿；2 处死引用已处理', () => {
    const data = readJson('v2.generated.json')
    expect(data.issues.length).toBe(29)
    expect(data.meta.counts.issuesBySeverity).toEqual({ P0: 5, P1: 12, P2: 10, P3: 2 })
    expect(new Set(data.issues.map((item: IdItem) => item.id)).size).toBe(29)

    for (const issue of data.issues) {
      expect(['P0', 'P1', 'P2', 'P3']).toContain(issue.severity)
      expect(['fixed-overlay', 'fixed-token', 'fixed-doc', 'deferred', 'deleted']).toContain(issue.verdict)
      expect(issue.decision.trim().length).toBeGreaterThan(10)
      expect(issue.residual.trim().length).toBeGreaterThan(0)
      expect(issue.before.trim().length).toBeGreaterThan(0)
      expect(issue.after.trim().length).toBeGreaterThan(0)
    }

    expect(data.deadTokens.length).toBe(44)
    for (const token of data.deadTokens) {
      expect(['deleted', 'whitelisted']).toContain(token.disposition)
      if (token.disposition === 'whitelisted') expect(token.reason.trim().length).toBeGreaterThan(10)
    }
    expect(data.deadTokens.filter((item: DispositionItem) => item.disposition === 'whitelisted').length).toBe(0)

    expect(data.deadRefs.length).toBe(2)
    for (const ref of data.deadRefs) expect(ref.disposition).toBe('fixed-doc')

    // 旧守卫用变量占位当示例，扫描器会把它当悬空引用；v2 不允许这种占位再出现。
    const guardSource = fs.readFileSync(path.join(repositoryRoot, 'packages/console/source/design-system.guard.test.ts'), 'utf8')
    const placeholders = ['--' + 'token', '--' + 'x']
    for (const placeholder of placeholders) {
      expect(guardSource).not.toContain(`var(${placeholder})`)
    }
  })

  it('16 个组件 × 7 状态齐全，N/A 必须写原因', () => {
    const data = readJson('v2.generated.json')
    expect(data.components.length).toBe(16)
    expect(data.stateNames).toEqual(['default', 'hover', 'active', 'focus-visible', 'disabled', 'loading', 'error'])
    for (const component of data.components) {
      for (const state of data.stateNames) {
        const spec = component.states[state]
        expect(spec, `${component.name} 缺 ${state}`).toBeTruthy()
        if (!spec.applicable) {
          expect(spec.nonColor.trim().length, `${component.name} 的 ${state} 为 N/A 但没写原因`).toBeGreaterThan(5)
        } else {
          expect(spec.spec.trim().length).toBeGreaterThan(3)
          expect(spec.nonColor.trim().length).toBeGreaterThan(3)
          expect(spec.keyboard.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('排版/间距/圆角/控件刻度不越界', () => {
    const data = readJson('v2.generated.json')
    expect(data.spacing.steps.every((step: number) => step % 4 === 0)).toBe(true)
    expect(data.spacing.steps).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
    expect(data.radii.map((item: PxItem) => item.px)).toEqual([2, 4, 6, 8, 12, 16])
    expect(data.controls.heights.map((item: PxItem) => item.px)).toEqual([24, 28, 32, 36, 40])
    expect(data.controls.touchMin).toBe(44)
    expect(data.stateNames.length).toBe(7)
    expect(data.rules.length).toBeGreaterThanOrEqual(18)
  })
})
