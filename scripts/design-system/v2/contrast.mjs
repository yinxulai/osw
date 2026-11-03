/**
 * v2 对比度矩阵。
 *
 * 每一行都绑定「前景 token × 承载底色 × 阈值」。守卫测试会按 hex 重算，
 * 不读取这里写下的结论；页面上的红/绿也来自重算结果。
 *
 * kind:
 *   text      → 4.5:1（WCAG 1.4.3）
 *   large     → 3:1
 *   ui        → 3:1（WCAG 1.4.11）
 *   decorative→ 无阈值，仅展示
 *   disabled  → 豁免，仅要求 1.5:1 可分辨
 */
import { contrastHex } from './color.mjs'
import { aliases, roles, statusRoles } from './tokens.mjs'

const thresholdOf = kind => {
  if (kind === 'text') return 4.5
  if (kind === 'ui') return 3
  if (kind === 'large') return 3
  if (kind === 'disabled') return 1.5
  return null
}

const text = (id, label, fg, bg, note) => ({ id, label, fg, bg, kind: 'text', note })
const ui = (id, label, fg, bg, note) => ({ id, label, fg, bg, kind: 'ui', note })
const decorative = (id, label, fg, bg, note) => ({ id, label, fg, bg, kind: 'decorative', note })
const disabled = (id, label, fg, bg, note) => ({ id, label, fg, bg, kind: 'disabled', note })

export const pairs = [
  text('text-primary/raised', '主文本 / 卡片', 'text-primary', 'surface-raised'),
  text('text-primary/base', '主文本 / 页面底', 'text-primary', 'surface-base'),
  text('text-primary/sunken', '主文本 / 凹槽', 'text-primary', 'surface-sunken'),
  text('text-secondary/raised', '次级文本 / 卡片', 'text-secondary', 'surface-raised'),
  text('text-secondary/base', '次级文本 / 页面底', 'text-secondary', 'surface-base'),
  text('text-secondary/sunken', '次级文本 / 凹槽', 'text-secondary', 'surface-sunken'),
  text('text-tertiary/sunken', '三级文本 / 凹槽（并入次级）', 'text-tertiary', 'surface-sunken'),
  text('placeholder/input', 'Placeholder / 输入底', 'text-placeholder', 'input-surface'),
  text('input-text/input', '输入文本 / 输入底', 'input-text', 'input-surface'),
  disabled('disabled/raised', '禁用文本 / 卡片', 'text-disabled', 'surface-raised'),
  decorative('decorative/raised', '装饰图标 / 卡片', 'text-decorative', 'surface-raised'),
  text('on-solid/solid', '实心文本 / solid', 'on-solid', 'solid'),
  text('on-solid/solid-hover', '实心文本 / solid hover', 'on-solid', 'solid-hover'),

  text('brand-text/base', '品牌文本 / 页面底', 'brand-text', 'surface-base'),
  text('brand-text/brand-surface', '品牌文本 / 品牌底', 'brand-text', 'brand-surface'),
  text('brand-on-solid/brand-solid', '品牌实心文本 / 品牌实心', 'brand-on-solid', 'brand-solid'),
  text('brand-on-solid/brand-solid-hover', '品牌实心文本 / hover', 'brand-on-solid', 'brand-solid-hover'),
  ui('focus-ring/base', '焦点环 / 页面底', 'focus-ring', 'surface-base'),
  ui('focus-ring/raised', '焦点环 / 卡片', 'focus-ring', 'surface-raised'),

  ui('input-border/raised', '输入框边界 / 卡片', 'input-border', 'surface-raised', 'DS-001 的修复点'),
  ui('input-border/base', '输入框边界 / 页面底', 'input-border', 'surface-base'),
  ui('input-border/input-surface', '输入框边界 / 输入底', 'input-border', 'input-surface'),
  ui('input-border-hover/input-hover', '输入 hover 边界 / hover 底', 'input-border-hover', 'input-surface-hover'),
  ui('border-strong/raised', '强边框 / 卡片', 'border-strong', 'surface-raised'),
  decorative('border/raised', '常规边框 / 卡片', 'border', 'surface-raised'),
  decorative('border-subtle/raised', '弱边框 / 卡片', 'border-subtle', 'surface-raised'),
  decorative('overlay-border/overlay', '浮层边框 / 浮层底', 'overlay-border', 'overlay-surface'),
  ui('brand-border/base', '品牌边框 / 页面底', 'brand-border', 'surface-base'),
  ui('brand-border-strong/raised', '品牌强边 / 卡片', 'brand-border-strong', 'surface-raised'),

  text('btn-primary/on-solid', '主按钮文本 / 主按钮底', 'on-solid', 'solid'),
  text('btn-secondary/raised', '次按钮文本 / 次按钮底', 'text-secondary', 'surface-raised'),
  text('btn-tertiary/sunken', '三级按钮文本 / 三级按钮底', 'text-secondary', 'surface-sunken'),
  text('btn-ghost/raised', '幽灵按钮文本 / 卡片', 'text-secondary', 'surface-raised'),
  text('btn-danger-ghost/raised', '危险幽灵按钮文本 / 卡片', 'danger-text', 'surface-raised'),

  text('badge-default', '徽标 default 文本 / 底', 'on-solid', 'solid'),
  text('badge-secondary', '徽标 secondary 文本 / 底', 'text-secondary', 'surface-sunken'),
  text('badge-info', '徽标 info 文本 / 底', 'info-text', 'info-surface'),
  text('badge-success', '徽标 success 文本 / 底', 'success-text', 'success-surface'),
  text('badge-warning', '徽标 warning 文本 / 底', 'warning-text', 'warning-surface'),
  text('badge-danger', '徽标 danger 文本 / 底', 'danger-text', 'danger-surface'),

  text('success-text/raised', '成功文本 / 卡片', 'success-text', 'surface-raised'),
  text('success-text/surface', '成功文本 / 状态底', 'success-text', 'success-surface'),
  text('warning-text/raised', '警告文本 / 卡片', 'warning-text', 'surface-raised'),
  text('warning-text/surface', '警告文本 / 状态底', 'warning-text', 'warning-surface'),
  text('danger-text/raised', '危险文本 / 卡片', 'danger-text', 'surface-raised'),
  text('danger-text/surface', '危险文本 / 状态底', 'danger-text', 'danger-surface'),
  text('info-text/raised', '信息文本 / 卡片', 'info-text', 'surface-raised'),
  text('info-text/surface', '信息文本 / 状态底', 'info-text', 'info-surface'),
  text('success-on-solid/solid', '成功实心文本 / solid', 'success-on-solid', 'success-solid'),
  text('warning-on-solid/solid', '警告实心文本 / solid', 'warning-on-solid', 'warning-solid'),
  text('danger-on-solid/solid', '危险实心文本 / solid', 'danger-on-solid', 'danger-solid'),
  text('info-on-solid/solid', '信息实心文本 / solid', 'info-on-solid', 'info-solid'),

  decorative('success-border/raised', '成功边框 / 卡片', 'success-border', 'surface-raised'),
  decorative('warning-border/raised', '警告边框 / 卡片', 'warning-border', 'surface-raised'),
  decorative('danger-border/raised', '危险边框 / 卡片', 'danger-border', 'surface-raised'),
  decorative('info-border/raised', '信息边框 / 卡片', 'info-border', 'surface-raised'),

  ui('chart-1/raised', '图表 1 / 卡片', 'chart-1', 'surface-raised'),
  ui('chart-2/raised', '图表 2 / 卡片', 'chart-2', 'surface-raised'),
  ui('chart-3/raised', '图表 3 / 卡片', 'chart-3', 'surface-raised'),
  ui('chart-4/raised', '图表 4 / 卡片', 'chart-4', 'surface-raised'),
  ui('chart-5/raised', '图表 5 / 卡片', 'chart-5', 'surface-raised'),
]

export const evaluatePairs = mode => {
  const table = roles[mode]
  return pairs.map(pair => {
    const foreground = table[pair.fg]?.hex
    const background = table[pair.bg]?.hex
    const threshold = thresholdOf(pair.kind)
    const ratio = foreground && background ? contrastHex(foreground, background) : null
    return {
      ...pair,
      threshold,
      fgHex: foreground,
      bgHex: background,
      ratio,
      pass: threshold === null ? null : ratio !== null && ratio >= threshold,
    }
  })
}

export const contrastTable = { light: evaluatePairs('light'), dark: evaluatePairs('dark') }

/** 只给页面/README 用的展示列表。 */
export const allPairIds = pairs.map(pair => pair.id)

export const aliasTarget = name => aliases[name]

/** 状态族的角色名清单，供守卫检查「每个状态都有四个角色」。 */
export const statusFamilies = ['success', 'warning', 'danger', 'info']
export const statusRoleKeys = ['surface', 'border', 'text', 'solid', 'solid-hover', 'on-solid']
export const statusHex = (mode, family, key) => {
  if (key === 'solid-hover') return roles[mode][`${family}-solid`]?.hex
  return statusRoles[mode][family]?.[key === 'on-solid' ? 'onSolid' : key]?.hex
}
