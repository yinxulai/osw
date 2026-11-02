#!/usr/bin/env node
/**
 * 设计系统取证脚本。
 *
 * 只读 `packages/console/source/styles/index.css` 与 `packages/console/source/**` 的真实源码，
 * 输出 `docs/design-system/tokens.generated.json`，并据此重写 README 的生成区块与预览页。
 *
 * 原则：
 * - 不猜值：颜色一律从声明里解析，解析不了就记 null，由守卫测试报错。
 * - 不改实现：脚本只写 docs/design-system 下的文件。
 * - 可重复：同一份源码必须产出逐字节相同的 JSON / HTML / README 区块。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildIssues, buildOpenQuestions } from './issues.mjs'
import { renderPage } from './render-page.mjs'
import { renderReadme } from './render-readme.mjs'
import { buildComponentSpecs } from './specs.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const STYLE_REL = 'packages/console/source/styles/index.css'
const STYLE_ABS = path.join(ROOT, STYLE_REL)
const SOURCE_ROOT = path.join(ROOT, 'packages/console/source')
const DOCS_DIR = path.join(ROOT, 'docs/design-system')

const read = file => fs.readFileSync(file, 'utf8')

const walk = dir => {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* CSS 解析                                                                    */
/* -------------------------------------------------------------------------- */

const lineStartsOf = text => {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

const lineAt = (starts, index) => {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= index) low = mid
    else high = mid - 1
  }
  return low + 1
}

/** 注释替换成等长空白（保留换行），这样行号与原文一致。 */
const stripCssComments = text => text.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))

export const parseCss = text => {
  const stripped = stripCssComments(text)
  const starts = lineStartsOf(stripped)
  const declarations = []
  const stack = []
  let segmentStart = 0

  const flush = end => {
    const raw = stripped.slice(segmentStart, end)
    const trimmed = raw.trim()
    if (!trimmed) return
    const inUtility = stack.some(item => item.startsWith('@utility'))
    if (!trimmed.startsWith('--') && !inUtility) return
    const colon = trimmed.indexOf(':')
    if (colon < 0) return
    const name = trimmed.slice(0, colon).trim()
    if (inUtility) {
      if (!/^[a-z-]+$/.test(name)) return
    } else if (!/^--[a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(name)) return
    const value = trimmed.slice(colon + 1).trim()
    const offset = segmentStart + raw.search(/[a-zA-Z-]/)
    declarations.push({
      name,
      value,
      line: lineAt(starts, offset),
      stack: [...stack],
      property: inUtility,
    })
  }

  for (let i = 0; i < stripped.length; i += 1) {
    const char = stripped[i]
    if (char === '{') {
      stack.push(stripped.slice(segmentStart, i).trim().replace(/\s+/g, ' '))
      segmentStart = i + 1
    } else if (char === ';') {
      flush(i)
      segmentStart = i + 1
    } else if (char === '}') {
      flush(i)
      stack.pop()
      segmentStart = i + 1
    }
  }
  return declarations
}

const scopeOf = stack => {
  if (stack.some(item => item.startsWith('@utility'))) return 'utility'
  if (stack.some(item => item === '@theme inline')) return 'theme-inline'
  if (stack.some(item => item === '@theme')) return 'theme'
  if (stack.includes('.dark')) return 'dark'
  if (stack.includes(':root')) return 'root'
  return 'other'
}

/* -------------------------------------------------------------------------- */
/* 颜色解析                                                                    */
/* -------------------------------------------------------------------------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 1)
  const light = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  let rgb
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map(channel => Math.round((channel + m) * 255))
}

const parseAlpha = token => (token === undefined ? 1 : clamp(Number.parseFloat(token), 0, 1))

const parseColor = value => {
  if (typeof value !== 'string') return null
  const source = value.trim()

  const hex = source.match(/^#([0-9a-fA-F]{3,8})$/)
  if (hex) {
    const raw = hex[1]
    if (raw.length === 3 || raw.length === 4) {
      const channels = raw.split('').map(ch => Number.parseInt(ch + ch, 16))
      return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] === undefined ? 1 : channels[3] / 255 }
    }
    if (raw.length === 6 || raw.length === 8) {
      const int = Number.parseInt(raw.slice(0, 6), 16)
      return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
        a: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }

  const fn = source.match(/^(hsla?|rgba?)\(([\s\S]+)\)$/i)
  if (!fn) return null
  const name = fn[1].toLowerCase()
  let body = fn[2].trim()

  let alphaToken
  const slash = body.lastIndexOf('/')
  if (slash >= 0) {
    alphaToken = body.slice(slash + 1).trim()
    body = body.slice(0, slash).trim()
  }
  const parts = body.split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null

  const alpha = parseAlpha(alphaToken)

  if (name.startsWith('rgb')) {
    const channel = part =>
      part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)
    return {
      r: clamp(Math.round(channel(parts[0])), 0, 255),
      g: clamp(Math.round(channel(parts[1])), 0, 255),
      b: clamp(Math.round(channel(parts[2])), 0, 255),
      a: alpha,
    }
  }

  const hue = Number.parseFloat(parts[0])
  const sat = Number.parseFloat(parts[1]) / 100
  const light = Number.parseFloat(parts[2]) / 100
  if ([hue, sat, light].some(Number.isNaN)) return null
  const [r, g, b] = hslToRgb(hue, sat, light)
  return { r, g, b, a: alpha }
}

const toHex = color => {
  const part = value => value.toString(16).padStart(2, '0')
  const base = `#${part(color.r)}${part(color.g)}${part(color.b)}`
  if (color.a >= 0.999) return base
  return `${base}${part(Math.round(color.a * 255))}`
}

const composite = (top, bottom) => {
  const alpha = top.a + bottom.a * (1 - top.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 1 }
  return {
    r: Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha),
    g: Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha),
    b: Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha),
    a: alpha,
  }
}

const relativeLuminance = color => {
  const channel = value => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

const contrastRatio = (foreground, background) => {
  const fg = relativeLuminance(foreground)
  const bg = relativeLuminance(background)
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

/* -------------------------------------------------------------------------- */
/* 源码装载                                                                    */
/* -------------------------------------------------------------------------- */

const cssText = read(STYLE_ABS)
const declarations = parseCss(cssText)

const buildScope = (items, base = new Map()) => {
  const map = new Map(base)
  for (const item of items) map.set(item.name, item)
  return map
}

const byScope = scope => declarations.filter(item => scopeOf(item.stack) === scope)

const themeInline = buildScope(byScope('theme-inline'))
const themeBase = buildScope(byScope('theme'), themeInline)
const darkOverrides = buildScope(byScope('dark'))
const rootBase = buildScope(byScope('root'))
const darkRoot = buildScope(byScope('dark'), rootBase)

const themeLight = themeBase
const themeDark = buildScope([...darkOverrides.values()], themeBase)
const rootLight = rootBase
const rootDark = darkRoot

const resolveRaw = (name, mode, seen = new Set()) => {
  if (seen.has(name)) return undefined
  const map = mode === 'dark' ? themeDark : themeLight
  const primitives = mode === 'dark' ? rootDark : rootLight
  const decl = map.get(name) ?? primitives.get(name)
  if (!decl) return undefined
  const nextSeen = new Set(seen).add(name)
  return decl.value.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (match, inner) => {
    const resolved = resolveRaw(inner, mode, nextSeen)
    return resolved === undefined ? match : resolved
  })
}

const colorOf = (name, mode) => {
  const raw = resolveRaw(name, mode)
  return raw === undefined ? null : parseColor(raw)
}

const resolveTokenColor = (name, mode) => {
  const raw = resolveRaw(name, mode)
  if (raw === undefined) return null
  const color = parseColor(raw)
  return color ? { raw, ...color, hex: toHex(color) } : { raw, unresolved: true }
}

/* -------------------------------------------------------------------------- */
/* 颜色 token                                                                  */
/* -------------------------------------------------------------------------- */

const colorGroups = [
  ['base', /^--color-(background|foreground|card|canvas|popover|primary|secondary|muted|accent|destructive|border|input|ring|inset)(-|$)/],
  ['text', /^--color-text-/],
  ['state', /^--color-state-/],
  ['component', /^--color-components-/],
  ['module', /^--color-module-/],
  ['workflow', /^--color-workflow-/],
  ['data-viz', /^--color-(chart|heat|util-colors)-/],
  ['feedback', /^--color-(success|warning|info)/],
  ['sidebar', /^--color-sidebar-/],
]

const groupOf = name => {
  for (const [group, pattern] of colorGroups) if (pattern.test(name)) return group
  return 'other'
}

const colorNames = [...new Set([...themeLight.keys(), ...themeDark.keys()])]
  .filter(name => name.startsWith('--color-'))
  .sort()

const colorsOf = mode =>
  colorNames.map(name => {
    const lightDecl = themeLight.get(name) ?? rootLight.get(name)
    const decl = mode === 'dark' ? themeDark.get(name) ?? darkRoot.get(name) : lightDecl
    const resolved = resolveTokenColor(name, mode)
    return {
      name,
      group: groupOf(name),
      raw: decl ? decl.value : null,
      line: decl ? decl.line : null,
      hex: resolved?.hex ?? null,
      alpha: resolved ? Number(resolved.a.toFixed(3)) : null,
      unresolved: Boolean(resolved?.unresolved),
    }
  })

const colors = { light: colorsOf('light'), dark: colorsOf('dark') }
const colorByName = Object.fromEntries(colors.light.map((item, index) => [item.name, { light: item, dark: colors.dark[index] }]))

/* -------------------------------------------------------------------------- */
/* 对比度                                                                      */
/* -------------------------------------------------------------------------- */

const resolveSpec = (spec, mode) => {
  if (typeof spec === 'string') {
    const color = colorOf(spec, mode)
    return color ? { ...color } : null
  }
  const base = colorOf(spec.token, mode)
  if (!base) return null
  let color = spec.alpha === undefined ? base : { ...base, a: base.a * spec.alpha }
  if (spec.over) {
    const over = colorOf(spec.over, mode)
    if (!over) return null
    color = composite(color, over)
  }
  return color
}

const CONTRAST_PAIRS = [
  { id: 'text-primary/card', label: '主文本 / 卡片', fg: '--color-text-primary', bg: '--color-card', kind: 'text' },
  { id: 'text-primary/canvas', label: '主文本 / 画布', fg: '--color-text-primary', bg: '--color-canvas', kind: 'text' },
  { id: 'text-primary/body', label: '主文本 / 页面底', fg: '--color-text-primary', bg: '--color-background-body', kind: 'text' },
  { id: 'text-secondary/card', label: '次级文本 / 卡片', fg: '--color-text-secondary', bg: '--color-card', kind: 'text' },
  { id: 'text-tertiary/card', label: '三级文本 / 卡片', fg: '--color-text-tertiary', bg: '--color-card', kind: 'text' },
  { id: 'text-tertiary/body', label: '三级文本 / 页面底', fg: '--color-text-tertiary', bg: '--color-background-body', kind: 'text' },
  { id: 'text-quaternary/card', label: '四级文本 / 卡片', fg: '--color-text-quaternary', bg: '--color-card', kind: 'text' },
  { id: 'text-accent/card', label: '强调文本 / 卡片', fg: '--color-text-accent', bg: '--color-card', kind: 'text' },
  { id: 'text-destructive/card', label: '危险文本 / 卡片', fg: '--color-text-destructive', bg: '--color-card', kind: 'text' },
  { id: 'text-success/card', label: '成功文本 / 卡片', fg: '--color-text-success', bg: '--color-card', kind: 'text' },
  { id: 'text-warning/card', label: '警告文本 / 卡片', fg: '--color-text-warning', bg: '--color-card', kind: 'text' },
  { id: 'text-primary/inset', label: '主文本 / 凹槽', fg: '--color-text-primary', bg: '--color-inset', kind: 'text' },
  { id: 'text-tertiary/inset', label: '三级文本 / 凹槽', fg: '--color-text-tertiary', bg: '--color-inset', kind: 'text' },
  { id: 'foreground/background', label: '前景 / 背景', fg: '--color-foreground', bg: '--color-background', kind: 'text' },
  { id: 'card-foreground/card', label: '卡片文本 / 卡片', fg: '--color-card-foreground', bg: '--color-card', kind: 'text' },
  { id: 'popover-foreground/popover', label: '浮层文本 / 浮层', fg: '--color-popover-foreground', bg: '--color-popover', kind: 'text' },
  { id: 'muted-foreground/muted', label: '弱化文本 / 弱化底', fg: '--color-muted-foreground', bg: '--color-muted', kind: 'text' },
  { id: 'sidebar-foreground/sidebar', label: '侧栏文本 / 侧栏', fg: '--color-sidebar-foreground', bg: '--color-sidebar', kind: 'text' },
  { id: 'sidebar-accent-fg/sidebar-accent', label: '侧栏选中文本 / 选中底', fg: '--color-sidebar-accent-foreground', bg: { token: '--color-sidebar-accent', over: '--color-sidebar' }, kind: 'text' },
  { id: 'primary-fg/primary', label: '主色按钮文本 / 主色底', fg: '--color-primary-foreground', bg: '--color-primary', kind: 'text' },
  { id: 'btn-primary-text/bg', label: '主按钮文本 / 主按钮底', fg: '--color-components-button-primary-text', bg: '--color-components-button-primary-bg', kind: 'text' },
  { id: 'btn-secondary-text/bg', label: '次按钮文本 / 次按钮底', fg: '--color-components-button-secondary-text', bg: { token: '--color-components-button-secondary-bg', over: '--color-card' }, kind: 'text' },
  { id: 'btn-tertiary-text/bg', label: '三级按钮文本 / 三级按钮底', fg: '--color-components-button-tertiary-text', bg: { token: '--color-components-button-tertiary-bg', over: '--color-card' }, kind: 'text' },
  { id: 'btn-ghost-text/card', label: '幽灵按钮文本 / 卡片', fg: '--color-components-button-ghost-text', bg: '--color-card', kind: 'text' },
  { id: 'btn-destructive-text/card', label: '危险幽灵按钮文本 / 卡片', fg: '--color-components-button-destructive-ghost-text', bg: '--color-card', kind: 'text' },
  { id: 'input-text/input', label: '输入文本 / 输入底', fg: '--color-components-input-text-filled', bg: { token: '--color-components-input-bg-normal', over: '--color-card' }, kind: 'text' },
  { id: 'input-placeholder/input', label: '输入占位 / 输入底', fg: '--color-components-input-text-placeholder', bg: { token: '--color-components-input-bg-normal', over: '--color-card' }, kind: 'text' },
  { id: 'input-disabled/input-disabled', label: '禁用输入文本 / 禁用底', fg: '--color-components-input-text-filled-disabled', bg: { token: '--color-components-input-bg-disabled', over: '--color-card' }, kind: 'disabled' },
  { id: 'text-disabled/card', label: '禁用文本 / 卡片', fg: '--color-text-disabled', bg: '--color-card', kind: 'disabled' },
  { id: 'badge-default', label: '徽标 default 文本 / 底', fg: '--color-primary-foreground', bg: '--color-primary', kind: 'text' },
  { id: 'badge-secondary', label: '徽标 secondary 文本 / 底', fg: '--color-text-secondary', bg: '--color-inset', kind: 'text' },
  { id: 'badge-success', label: '徽标 success 文本 / 底', fg: '--color-text-success', bg: { token: '--color-success', alpha: 0.1, over: '--color-card' }, kind: 'text' },
  { id: 'badge-warning', label: '徽标 warning 文本 / 底', fg: '--color-text-warning', bg: { token: '--color-warning', alpha: 0.1, over: '--color-card' }, kind: 'text' },
  { id: 'badge-destructive', label: '徽标 destructive 文本 / 底', fg: '--color-text-destructive', bg: { token: '--color-destructive', alpha: 0.1, over: '--color-card' }, kind: 'text' },
  { id: 'badge-info', label: '徽标 info 文本 / 底', fg: '--color-info', bg: { token: '--color-info', alpha: 0.1, over: '--color-card' }, kind: 'text' },
  { id: 'border/card', label: '分隔线 / 卡片（装饰）', fg: '--color-border', bg: '--color-card', kind: 'decorative' },
  { id: 'module-border/card', label: '模块边框 / 卡片（容器，装饰）', fg: '--color-module-border', bg: '--color-card', kind: 'decorative' },
  { id: 'panel-border/panel', label: '浮层边框 / 浮层底（装饰）', fg: '--color-components-panel-border', bg: '--color-components-panel-bg', kind: 'decorative' },
  { id: 'input-boundary/card', label: '输入框边界 / 卡片', fg: { token: '--color-components-input-bg-normal', over: '--color-card' }, bg: '--color-card', kind: 'ui' },
  { id: 'input-border-hover/input', label: '输入框悬停边框 / 悬停底', fg: '--color-components-input-border-hover', bg: { token: '--color-components-input-bg-hover', over: '--color-card' }, kind: 'ui' },
  { id: 'ring/card', label: '焦点环 / 卡片', fg: '--color-ring', bg: '--color-card', kind: 'ui' },

  { id: 'input/background', label: '输入框底 / 页面底', fg: '--color-input', bg: '--color-background', kind: 'decorative' },
]

const thresholdOf = kind => {
  if (kind === 'text') return 4.5
  if (kind === 'large') return 3
  if (kind === 'ui') return 3
  return null
}

const evaluatePair = (pair, mode) => {
  const foreground = resolveSpec(pair.fg, mode)
  let background = resolveSpec(pair.bg, mode)
  if (!foreground || !background) {
    return { ratio: null, fgHex: null, bgHex: null, pass: null }
  }
  if (background.a < 0.999) background = composite(background, { r: 255, g: 255, b: 255, a: 1 })
  let foregroundOpaque = foreground
  if (foregroundOpaque.a < 0.999) foregroundOpaque = composite(foregroundOpaque, background)
  const ratio = contrastRatio(foregroundOpaque, background)
  const threshold = thresholdOf(pair.kind)
  return {
    ratio: Number(ratio.toFixed(2)),
    fgHex: toHex(foregroundOpaque),
    bgHex: toHex(background),
    pass: threshold === null ? null : ratio >= threshold,
  }
}

const contrast = CONTRAST_PAIRS.map(pair => ({
  ...pair,
  threshold: thresholdOf(pair.kind),
  light: evaluatePair(pair, 'light'),
  dark: evaluatePair(pair, 'dark'),
}))

const contrastByToken = new Map()
const linkPair = (token, pairId) => {
  if (!contrastByToken.has(token)) contrastByToken.set(token, [])
  contrastByToken.get(token).push(pairId)
}

for (const pair of contrast) {
  const fg = typeof pair.fg === 'string' ? pair.fg : pair.fg.token
  if (fg) linkPair(fg, pair.id)
  const bg = typeof pair.bg === 'string' ? pair.bg : pair.bg.token
  if (bg) linkPair(bg, pair.id)
}

/* -------------------------------------------------------------------------- */
/* 排版                                                                        */
/* -------------------------------------------------------------------------- */

const typography = declarations
  .filter(item => scopeOf(item.stack) === 'utility')
  .reduce((list, item) => {
    const utility = item.stack.find(entry => entry.startsWith('@utility'))
    if (!utility) return list
    const name = utility.replace('@utility', '').trim()
    let record = list.find(entry => entry.name === name)
    if (!record) {
      record = { name, line: item.line, properties: {} }
      list.push(record)
    }
    record.properties[item.name] = item.value
    return list
  }, [])
  .map(record => ({
    name: record.name,
    line: record.line,
    fontSize: record.properties['font-size'] ?? null,
    fontWeight: record.properties['font-weight'] ?? null,
    lineHeight: record.properties['line-height'] ?? null,
    uppercase: record.properties['text-transform'] === 'uppercase',
  }))

const allSourceFiles = walk(SOURCE_ROOT).filter(file => /\.(tsx?|css)$/.test(file))
const sourceContents = new Map(allSourceFiles.map(file => [file, read(file)]))

const usageCount = needle => {
  const pattern = new RegExp(`(?<![\\w-])${needle}(?![\\w-])`, 'g')
  let count = 0
  for (const content of sourceContents.values()) count += [...content.matchAll(pattern)].length
  return count
}

for (const record of typography) record.usage = usageCount(record.name)

const textVariable = themeLight.get('--text-2xs')

/* -------------------------------------------------------------------------- */
/* 圆角 / 阴影 / 字体                                                          */
/* -------------------------------------------------------------------------- */

const pxOf = expr => {
  const match = expr.trim().match(/^(-?\d*\.?\d+)(px|rem)$/)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return match[2] === 'rem' ? value * 16 : value
}

const evalLength = (expr, mode) => {
  let text = expr
  for (let depth = 0; depth < 5 && text.includes('var('); depth += 1) {
    text = text.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (match, name) => resolveRaw(name, mode) ?? match)
  }
  const calc = text.match(/^calc\(([\s\S]+)\)$/)
  if (!calc) return pxOf(text)
  let inner = calc[1].replace(/(\d*\.?\d+)rem/g, (match, value) => `${Number.parseFloat(value) * 16}px`)
  const operation = inner.match(/^(-?\d*\.?\d+)(px)?\s*([+*\-/])\s*(-?\d*\.?\d+)(px)?$/)
  if (!operation) return null
  const left = Number.parseFloat(operation[1])
  const right = Number.parseFloat(operation[4])
  switch (operation[3]) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return right === 0 ? null : left / right
    default:
      return null
  }
}

const radii = [...themeLight.entries()]
  .filter(([name]) => name === '--radius' || name.startsWith('--radius-') || name === '--button-radius')
  .map(([name, decl]) => ({
    name,
    raw: decl.value,
    line: decl.line,
    px: evalLength(decl.value, 'light'),
  }))
  .sort((a, b) => (a.px ?? 0) - (b.px ?? 0))

const shadowNames = [...new Set([...themeLight.keys(), ...themeDark.keys()])].filter(name => name.startsWith('--shadow-')).sort()
const shadows = shadowNames.map(name => ({
  name,
  light: themeLight.get(name)?.value ?? null,
  dark: themeDark.get(name)?.value ?? null,
  line: themeLight.get(name)?.line ?? themeDark.get(name)?.line ?? null,
}))

const fonts = ['--font-sans', '--font-mono', '--font-heading']
  .map(name => ({
    name,
    value: themeLight.get(name)?.value ?? null,
    line: themeLight.get(name)?.line ?? null,
    declared: themeLight.has(name),
  }))
  .filter(item => item.declared)

/* -------------------------------------------------------------------------- */
/* 间距 / 断点 / 层级                                                          */
/* -------------------------------------------------------------------------- */

const spacingPattern =
  /(?<![\w-])(gap-x|gap-y|gap|space-x|space-y|px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m)-(\d+(?:\.\d+)?)(?![\w.-])/g

const spacingCounts = new Map()
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
  for (const match of content.matchAll(spacingPattern)) {
    const step = Number.parseFloat(match[2])
    spacingCounts.set(step, (spacingCounts.get(step) ?? 0) + 1)
  }
}

const spacing = [...spacingCounts.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([step, count]) => ({
    step,
    px: Number((step * 4).toFixed(2)),
    count,
    onFourGrid: Number.isInteger((step * 4) / 4),
    onEightGrid: Number.isInteger((step * 4) / 8),
  }))

const breakpoints = ['sm', 'md', 'lg', 'xl', '2xl'].map(name => {
  const pattern = new RegExp(`(?<![\\w-])${name}:`, 'g')
  let count = 0
  for (const content of sourceContents.values()) count += [...content.matchAll(pattern)].length
  const defaults = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }
  return { name, minWidthPx: defaults[name], count }
})

const zIndexPattern = /(?<![\w-])z-(\d+|\[[^\]]+\])/g
const zIndexMap = new Map()
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.tsx')) continue
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    for (const match of line.matchAll(zIndexPattern)) {
      const key = match[1]
      if (!zIndexMap.has(key)) zIndexMap.set(key, { value: key, count: 0, examples: [] })
      const record = zIndexMap.get(key)
      record.count += 1
      if (record.examples.length < 3) {
        record.examples.push(`${path.relative(ROOT, file)}:${index + 1}`)
      }
    }
  })
}
const zIndex = [...zIndexMap.values()].sort((a, b) => Number.parseInt(a.value, 10) - Number.parseInt(b.value, 10))

/* -------------------------------------------------------------------------- */
/* 动效                                                                        */
/* -------------------------------------------------------------------------- */

const countPattern = pattern => {
  let total = 0
  for (const [file, content] of sourceContents) {
    if (!file.endsWith('.tsx') && !file.endsWith('.css')) continue
    total += [...content.matchAll(pattern)].length
  }
  return total
}

const durationCounts = new Map()
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.tsx')) continue
  for (const match of content.matchAll(/(?<![\w-])duration-(\d+)(?!\d)/g)) {
    durationCounts.set(match[1], (durationCounts.get(match[1]) ?? 0) + 1)
  }
}

const keyframes = []
{
  const starts = lineStartsOf(cssText)
  for (const match of cssText.matchAll(/@keyframes\s+([\w-]+)/g)) {
    keyframes.push({ name: match[1], line: lineAt(starts, match.index) })
  }
}

const motion = {
  durations: [...durationCounts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([duration, count]) => ({ duration: Number(duration), count })),
  animationFiles: [...sourceContents.entries()].filter(([file, content]) => file.endsWith('.tsx') && /(?<![\w-])animate-/.test(content)).length,
  animationOccurrences: countPattern(/(?<![\w-])animate-[a-z]/g),
  guardOccurrences: countPattern(/motion-reduce:|motion-safe:/g),
  reducedMotionBlocks: countPattern(/prefers-reduced-motion/g),
  keyframes,
}

/* -------------------------------------------------------------------------- */
/* 引用完整性                                                                  */
/* -------------------------------------------------------------------------- */

const declared = new Set(declarations.filter(item => item.name.startsWith('--')).map(item => item.name))
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
  for (const match of content.matchAll(/\[(--[a-zA-Z0-9-]+)\s*:/g)) {
    if (/^--[a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(match[1])) declared.add(match[1])
  }
  for (const match of content.matchAll(/["'](--[a-zA-Z0-9-]+)["']\s*:/g)) {
    if (/^--[a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(match[1])) declared.add(match[1])
  }
}

const referenced = new Set()
const varRefs = []
const scannedFiles = [
  ...sourceContents.keys(),
  ...walk(path.join(ROOT, 'apps/docs')).filter(file => file.endsWith('.css')).slice(0, 0),
]

const exampleLine = (content, index) => content.slice(0, index).split('\n').length

for (const [file, content] of sourceContents) {
  for (const match of content.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    referenced.add(match[1])
    varRefs.push({ name: match[1], file: path.relative(ROOT, file), line: exampleLine(content, match.index) })
  }
  // Tailwind v4 简写：`bg-(--color-bg)`、`px-(--card-spacing)`。
  for (const match of content.matchAll(/\((--[a-zA-Z0-9-]+)\)/g)) referenced.add(match[1])
}
for (const file of scannedFiles) void file

const tailwindPrefixes = ['bg', 'text', 'border', 'ring', 'inset-ring', 'outline', 'fill', 'stroke', 'from', 'via', 'to', 'decoration', 'divide', 'accent', 'caret', 'placeholder']
const referencedByClass = (tokenName, mode) => {
  const names = []
  if (tokenName.startsWith('--color-')) names.push({ prefix: tailwindPrefixes, suffix: tokenName.slice('--color-'.length) })
  if (tokenName.startsWith('--radius-')) names.push({ prefix: ['rounded', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l', 'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl'], suffix: tokenName.slice('--radius-'.length) })
  if (tokenName.startsWith('--shadow-')) names.push({ prefix: ['shadow'], suffix: tokenName.slice('--shadow-'.length) })
  if (tokenName.startsWith('--font-')) names.push({ prefix: ['font'], suffix: tokenName.slice('--font-'.length) })
  if (tokenName === '--text-2xs') names.push({ prefix: ['text'], suffix: '2xs' })
  void mode
  for (const entry of names) {
    for (const prefix of entry.prefix) {
      const pattern = new RegExp(`(?<![\\w-])${prefix}-${entry.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
      for (const content of sourceContents.values()) {
        if (pattern.test(content)) return true
      }
    }
  }
  return false
}

const tokenWhitelist = new Map([
  ['--color-heat-0', 'usage-heat-grid 用 `bg-heat-${level}` 动态拼接，静态扫描不可见'],
  ['--color-heat-1', '同上'],
  ['--color-heat-2', '同上'],
  ['--color-heat-3', '同上'],
  ['--color-heat-4', '同上'],
  ['--color-util-colors-blue-brand-blue-brand-500', 'provider-icon 由数据表动态拼接类名'],
  ['--color-util-colors-indigo-indigo-500', '同上'],
  ['--color-util-colors-blue-blue-500', '同上'],
  ['--color-util-colors-cyan-cyan-500', '同上'],
  ['--color-util-colors-green-green-500', '同上'],
  ['--color-util-colors-warning-warning-500', '同上'],
  ['--color-util-colors-violet-violet-500', '同上'],
  ['--color-util-colors-yellow-yellow-500', '同上'],
  ['--color-util-colors-pink-pink-500', '同上'],
  ['--normal-bg', 'sonner 内部消费，声明在 sonner.tsx 的 style 对象'],
  ['--normal-text', 'sonner 内部消费，声明在 sonner.tsx 的 style 对象'],
  ['--normal-border', 'sonner 内部消费，声明在 sonner.tsx 的 style 对象'],
  ['--border-radius', 'sonner 内部消费，声明在 sonner.tsx 的 style 对象'],
  ['--color-bg', 'chart.tsx 运行时注入给 Recharts 的指示器底色'],
  ['--color-count', 'latency-distribution.tsx 运行时注入给 Recharts 的系列色'],
])

const classReferenced = [...declared]
  .filter(name => name.startsWith('--'))
  .filter(name => !referenced.has(name))
  .filter(name => referencedByClass(name, 'light'))
  .sort()

const unreferenced = [...declared]
  .filter(name => name.startsWith('--'))
  .filter(name => !referenced.has(name))
  .filter(name => !referencedByClass(name, 'light'))
  .filter(name => !tokenWhitelist.has(name))
  .sort()

const undeclaredWhitelist = new Map([
  ['--anchor-width', 'Base UI Combobox 运行时注入'],
  ['--available-height', 'Base UI Combobox 运行时注入'],
  ['--available-width', 'Base UI Combobox 运行时注入'],
  ['--transform-origin', 'Base UI Combobox 运行时注入'],
  ['--color-count', 'chart.tsx 按 `--color-${key}` 动态注入的 Recharts 系列色'],
  ['--radix-select-content-available-height', 'Radix 运行时注入'],
  ['--radix-select-content-transform-origin', 'Radix 运行时注入'],
  ['--radix-dropdown-menu-content-available-height', 'Radix 运行时注入'],
  ['--radix-dropdown-menu-trigger-width', 'Radix 运行时注入'],
  ['--radix-dropdown-menu-content-transform-origin', 'Radix 运行时注入'],
  ['--radix-popover-content-transform-origin', 'Radix 运行时注入'],
  ['--radix-tooltip-content-transform-origin', 'Radix 运行时注入'],
  ['--radix-popper-available-width', 'Radix 运行时注入'],
  ['--radix-popper-available-height', 'Radix 运行时注入'],
  ['--radix-popper-anchor-width', 'Radix 运行时注入'],
  ['--radix-popper-transform-origin', 'Radix 运行时注入'],
  ['--tw-ring-offset-width', 'Tailwind 运行时注入'],
])

const undeclaredRefs = [...new Set(varRefs.map(item => item.name))]
  .filter(name => !declared.has(name))
  .filter(name => !undeclaredWhitelist.has(name))
  .filter(name => /^--[a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(name))
  .filter(name => !name.startsWith('--tw-') && !name.startsWith('--radix-'))
  .sort()
  .map(name => ({ name, refs: varRefs.filter(item => item.name === name).slice(0, 5) }))

const literalColorSites = []
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)]
    for (const match of matches) {
      const trimmed = line.trim()
      literalColorSites.push({
        file: path.relative(ROOT, file),
        line: index + 1,
        value: match[0],
        comment: trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*'),
      })
    }
  })
}

/* -------------------------------------------------------------------------- */
/* CSS 变量引用完整性                                                          */
/* -------------------------------------------------------------------------- */

const cssVarReferences = []
for (const [file, content] of sourceContents) {
  if (!file.endsWith('.css')) continue
  for (const match of content.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    cssVarReferences.push({ name: match[1], file: path.relative(ROOT, file), line: exampleLine(content, match.index) })
  }
}

const cssUndeclared = [...new Set(cssVarReferences.map(item => item.name))]
  .filter(name => !declared.has(name))
  .filter(name => !undeclaredWhitelist.has(name))
  .filter(name => !name.startsWith('--tw-') && !name.startsWith('--radix-'))
  .sort()

/* -------------------------------------------------------------------------- */
/* 汇总                                                                        */
/* -------------------------------------------------------------------------- */

const sourceHash = createHash('sha256').update(cssText).digest('hex')

const loc = token => {
  const decl = themeLight.get(token) ?? darkOverrides.get(token) ?? rootLight.get(token) ?? rootDark.get(token)
  return decl ? `${STYLE_REL}:${decl.line}` : `${STYLE_REL}:?`
}

const issues = buildIssues({ loc, colorByName, contrast, contrastByToken, unreferenced, undeclaredRefs, cssUndeclared, typography, radii, spacing, zIndex, literalColorSites })
const openQuestions = buildOpenQuestions({ colorByName, spacing })

// 组件规格：数字从组件源码的 class 串解析，anchor 对不上会直接抛错。
const components = buildComponentSpecs({
  root: ROOT,
  readFile: file => fs.readFileSync(file, 'utf8'),
  typography,
  radii,
})

const severityOrder = ['P0', 'P1', 'P2', 'P3']
const issueCounts = Object.fromEntries(severityOrder.map(severity => [severity, issues.filter(item => item.severity === severity).length]))

const data = {
  meta: {
    generator: 'scripts/design-system/extract-tokens.mjs',
    source: STYLE_REL,
    sourceSha256: sourceHash,
    styleLineCount: cssText.split('\n').length,
    counts: {
      cssDeclarations: declarations.length,
      colorTokens: colorNames.length,
      primitives: [...rootLight.keys()].length,
      typographyUtilities: typography.length,
      contrastPairs: contrast.length,
      componentSpecs: components.length,
      literalColorSites: literalColorSites.length,
      unverified: openQuestions.unverified.length,
      decisions: openQuestions.decisions.length,
    },
    issues: issueCounts,
  },
  colors,
  primitives: {
    light: [...rootLight.values()].map(item => ({ name: item.name, value: item.value, line: item.line })),
    dark: [...rootDark.values()].map(item => ({ name: item.name, value: item.value, line: rootBase.get(item.name)?.line ?? item.line })),
  },
  colorRefs: Object.fromEntries([...contrastByToken.entries()].map(([token, pairs]) => [token, pairs])),
  contrast,
  typography,
  components,
  textVariable: textVariable ? { name: '--text-2xs', value: textVariable.value, line: textVariable.line } : null,
  radii,
  shadows,
  fonts,
  spacing: {
    unitPx: 4,
    steps: spacing,
    offFourGrid: spacing.filter(item => !item.onFourGrid).map(item => item.step),
    offEightGrid: spacing.filter(item => !item.onEightGrid).map(item => item.step),
  },
  breakpoints,
  motion,
  zIndex,
  inventory: {
    declared: [...declared].sort(),
    referenced: [...referenced].sort(),
    classReferenced,
    unreferenced,
    whitelist: [...tokenWhitelist.entries()].map(([name, reason]) => ({ name, reason })),
    undeclaredRefs,
    cssUndeclared,
    undeclaredWhitelist: [...undeclaredWhitelist.entries()].map(([name, reason]) => ({ name, reason })),
  },
  literalColorSites,
  issues,
  openQuestions,
}

/* -------------------------------------------------------------------------- */
/* 输出                                                                        */
/* -------------------------------------------------------------------------- */

const json = `${JSON.stringify(data, null, 2)}\n`
const jsonPath = path.join(DOCS_DIR, 'tokens.generated.json')
const readmePath = path.join(DOCS_DIR, 'README.md')
const htmlPath = path.join(DOCS_DIR, 'index.html')

const readmeSource = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : ''

// 三份产物先在内存里全部算好，再决定是"写"还是"只校验"。
// `--check` 给守卫测试用：不落盘，只回答"现在的产物还等于源码推出来的东西吗"。
const outputs = [
  { key: 'json', file: jsonPath, content: json },
  { key: 'readme', file: readmePath, content: renderReadme(data, readmeSource) },
  { key: 'html', file: htmlPath, content: renderPage(data) },
]

const changed = Object.fromEntries(
  outputs.map(item => [item.key, !fs.existsSync(item.file) || fs.readFileSync(item.file, 'utf8') !== item.content]),
)

const checkOnly = process.argv.includes('--check')
if (checkOnly) {
  for (const item of outputs) {
    if (!changed[item.key]) continue
    console.error(`${path.relative(ROOT, item.file)} 与源码不一致：请重新运行 node scripts/design-system/extract-tokens.mjs`)
  }
} else {
  fs.mkdirSync(DOCS_DIR, { recursive: true })
  for (const item of outputs) {
    if (changed[item.key]) fs.writeFileSync(item.file, item.content)
  }
}

const report = {
  mode: checkOnly ? 'check' : 'write',
  json: path.relative(ROOT, jsonPath),
  readme: path.relative(ROOT, readmePath),
  html: path.relative(ROOT, htmlPath),
  changed,
  counts: data.meta.counts,
  issues: issueCounts,
}
console.log(JSON.stringify(report, null, 2))

if (checkOnly && Object.values(changed).some(Boolean)) process.exitCode = 1

export { data }
