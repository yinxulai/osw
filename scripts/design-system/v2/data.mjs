/**
 * 组装 v2 的单一数据源。
 *
 * 所有数字都在这里算一次，CSS / HTML / README / JSON 共用同一份结果；
 * 守卫测试再从 CSS 与 JSON 反算，避免“页面好看但数字是手写的”。
 */
import fs from 'node:fs'
import path from 'node:path'

import { contrastHex } from './color.mjs'
import { contrastTable, pairs, statusFamilies, statusRoleKeys } from './contrast.mjs'
import { buildDispositions } from './issues-v2.mjs'
import { components, stateNames } from './components.mjs'
import {
  aliases,
  brand,
  controls,
  motion,
  neutral,
  radii,
  roles,
  shadows,
  spacing,
  statusRoles,
  tokenCount,
  typography,
  zIndex,
} from './tokens.mjs'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

const DEAD_REPLACEMENTS = {
  '--color-background-body': '--ds-surface-base',
  '--color-background-default': '--ds-surface-raised',
  '--color-background-default-dimmed': '--ds-surface-active',
  '--color-background-default-dodge': '--ds-surface-raised',
  '--color-background-default-hover': '--ds-surface-hover',
  '--color-background-default-subtle': '--ds-surface-raised',
  '--color-chart-1': '--ds-chart-1',
  '--color-chart-2': '--ds-chart-2',
  '--color-chart-3': '--ds-chart-3',
  '--color-chart-4': '--ds-chart-4',
  '--color-chart-5': '--ds-chart-5',
  '--color-components-button-secondary-accent-text': '--ds-brand-text',
  '--color-components-option-card-option-bg': '--ds-surface-raised',
  '--color-components-option-card-option-bg-hover': '--ds-surface-hover',
  '--color-components-option-card-option-border': '--ds-border-subtle',
  '--color-components-option-card-option-border-hover': '--ds-border-strong',
  '--color-components-option-card-option-selected-bg': '--ds-brand-surface',
  '--color-components-tooltip-bg': '--ds-text-primary（反色底）',
  '--color-destructive-foreground': '--ds-danger-on-solid',
  '--color-info-foreground': '--ds-info-on-solid',
  '--color-secondary-foreground': '--ds-text-primary',
  '--color-sidebar-border': '--ds-border-subtle',
  '--color-sidebar-primary-foreground': '--ds-on-solid',
  '--color-sidebar-ring': '--ds-focus-ring',
  '--color-state-base-handle-hover': '--ds-border-strong',
  '--color-state-warning-solid': '--ds-warning-solid',
  '--color-success-foreground': '--ds-success-on-solid',
  '--color-text-accent-secondary': '--ds-brand-text-muted',
  '--color-text-inverted': '--ds-text-on-solid',
  '--color-text-success-secondary': '--ds-success-text',
  '--color-text-warning-secondary': '--ds-warning-text',
  '--color-warning-foreground': '--ds-warning-on-solid',
  '--color-workflow-block-bg-transparent': '--ds-surface-raised',
  '--color-workflow-block-border': '--ds-border-subtle',
  '--color-workflow-block-border-highlight': '--ds-brand-border',
  '--color-workflow-link-line-error-active': '--ds-danger-solid',
  '--color-workflow-link-line-failure-active': '--ds-warning-solid',
  '--color-workflow-link-line-failure-button-bg': '--ds-warning-solid',
  '--color-workflow-link-line-failure-handle': '--ds-warning-solid',
  '--color-workflow-link-line-normal-transparent': '--ds-border',
  '--color-workflow-link-line-success-active': '--ds-success-solid',
  '--radius-3xl': '--ds-radius-2xl（16px）',
  '--radius-4xl': '--ds-radius-2xl（16px）',
  '--shadow-card-hover': '--ds-shadow-overlay',
}

export const RULES = [
  { id: 'R-01', level: 'MUST', statement: '正文文本对比度 ≥ 4.5:1；≥ 18.66px 粗体或 ≥ 24px 可降到 3:1', check: '对承载底色实测；运行 node scripts/design-system/build-v2.mjs --check，任何 text 行 < 阈值即失败', status: 'v2 矩阵全部通过' },
  { id: 'R-02', level: 'MUST', statement: '非文本控件边界与相邻表面 ≥ 3:1', check: 'input-border / border-strong 对 raised、base、input-surface 三处重算', status: '输入框 3.30:1 起（亮/暗）' },
  { id: 'R-03', level: 'MUST', statement: '键盘焦点统一 2px 环 + 2px offset，颜色取 focus-ring', check: 'Tab 遍历；守卫断言 --ds-focus-width=2px、--ds-focus-offset=2px', status: '覆盖层统一 :focus-visible' },
  { id: 'R-04', level: 'MUST', statement: '状态不能只靠颜色；必须有形状、文字、图标或 aria-* 之一', check: '灰度截图逐态比对；组件规范每态都有 nonColor 字段', status: '16 个组件逐态登记' },
  { id: 'R-05', level: 'MUST', statement: '字号 ≤ 6 档，最小 12px；禁止 10/11px', check: '解析 tokens.v2.css 的 --ds-type-*-size；多于 6 或 < 12 即失败', status: '6 档，11px 取消' },
  { id: 'R-06', level: 'MUST', statement: '字重 ≤ 3 档：400 / 500 / 600', check: '解析 --ds-weight-*；出现其他值即失败', status: '3 档' },
  { id: 'R-07', level: 'MUST', statement: '每个字号必须成对声明行高，行高 ≥ 1.25× 字号', check: '解析 --ds-type-N-line / size；缺对或比例不足即失败', status: '6 对' },
  { id: 'R-08', level: 'MUST', statement: '间距落在 4px 网格；只允许 1px 描边与 2px 焦点/图标内衬例外', check: '解析 --ds-space-*；非 4 倍数且不在例外表即失败', status: '11 档 + 2 例外' },
  { id: 'R-09', level: 'MUST', statement: '控件高度只取 24/28/32/36/40；触控目标 ≥ 44px', check: '解析 --ds-control-* 与 --ds-touch-min', status: '5 档 + 44px 下限' },
  { id: 'R-10', level: 'MUST', statement: '圆角只取 2/4/6/8/12/16；禁止 10.8 / 13.2 / 15.6', check: '解析 --ds-radius-*', status: '6 档' },
  { id: 'R-11', level: 'MUST', statement: '阴影只取 --ds-shadow-card / overlay / panel；暗色不叠加黑色重影', check: '搜 shadow-[、shadow-lg、shadow-2xl；守卫白名单为空', status: '3 档 + 暗色值' },
  { id: 'R-12', level: 'MUST', statement: 'z-index 只取命名层 base/sticky/sidebar/overlay/modal/toast', check: '搜 z-[0-9]+；旧 z-50/z-70 在覆盖层映射到 token', status: '6 层；收据降到 overlay' },
  { id: 'R-13', level: 'MUST', statement: '动效 100/150/200/300ms；prefers-reduced-motion 下 animation/transition 归零', check: '解析 --ds-duration-*；覆盖层媒体块存在', status: '4 档 + 全局降级' },
  { id: 'R-14', level: 'MUST', statement: '状态族只能消费 surface/border/text/solid/on-solid；禁止拿 solid 当 text', check: '守卫断言每个 family 五角色齐全，且 text 对 card 与 surface ≥ 4.5:1', status: '4 族 × 5 角色' },
  { id: 'R-15', level: 'MUST', statement: '颜色只引用 token；组件用法不得出现字面色值', check: '搜 tokens.v2.css 兼容层与组件源码：#hex / rgb() / hsl()；v2 覆盖层定义区除外', status: '覆盖层 0 处字面色值' },
  { id: 'R-16', level: 'MUST', statement: '每个声明都必须有 consumer；零未引用 token', check: '解析 tokens.v2.css，按 var() 引用与白名单判定', status: '0 未引用；白名单 0' },
  { id: 'R-17', level: 'MUST', statement: '生成物与源码逐字节一致', check: 'node scripts/design-system/build-v2.mjs --check', status: 'CI 守卫' },
  { id: 'R-18', level: 'MUST', statement: '文档引用 token 名与实测值，不引用易漂移的行号', check: 'README/HTML 中不出现 index.css:数字', status: 'v2 文档由数据生成' },
]

export const buildData = root => {
  const v1 = readJson(path.join(root, 'docs/design-system/tokens.generated.json'))
  const v2 = { contrast: contrastTable, roles }

  const deadTokens = (v1.inventory?.unreferenced ?? []).map(name => ({
    name,
    line: v1.colors.light.find(item => item.name === name)?.line ?? null,
    disposition: 'deleted',
    replacement: DEAD_REPLACEMENTS[name] ?? '无（删除）',
    reason: DEAD_REPLACEMENTS[name]
      ? 'v1 零引用；v2 不声明，迁移到语义角色'
      : 'v1 零引用且没有 v2 对应角色；直接删除',
  }))

  // v1 的 2 处“未声明却被 var() 引用”只存在于旧守卫测试的示例字符串。
  // v2 重写守卫时已删除这些占位；这里保留历史记录，避免“修了但没人知道修了什么”。
  const deadRefs = [
    {
      name: '--token',
      refs: [{ file: 'packages/console/source/design-system.guard.test.ts', line: 61 }],
      disposition: 'fixed-doc',
      reason: '旧守卫用 var(--token) 当示例；v2 守卫改为直接读取 v2.generated.json，不再出现该占位',
    },
    {
      name: '--x',
      refs: [{ file: 'packages/console/source/design-system.guard.test.ts', line: 94 }],
      disposition: 'fixed-doc',
      reason: '旧守卫的第二个占位；v2 守卫已删除，var() 闭合扫描只剩真实引用',
    },
  ]

  const issues = buildDispositions({ root, v2 })
  const counts = {
    primitives: neutral.length + brand.length,
    neutralSteps: neutral.length,
    brandSteps: brand.length,
    semanticLight: Object.keys(roles.light).length,
    aliases: Object.keys(aliases).length,
    total: tokenCount(),
    contrastPairs: pairs.length * 2,
    issues: issues.length,
    issuesBySeverity: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map(severity => [severity, issues.filter(item => item.severity === severity).length])),
    deadTokens: deadTokens.length,
    deadRefs: deadRefs.length,
    components: components.length,
    componentStates: components.length * stateNames.length,
    rules: RULES.length,
  }

  const tokenIndex = [
    ...typography.sizes.flatMap(item => [
      { name: `--ds-${item.name}-size`, value: `${item.px}px`, use: `${item.px}/${item.lineHeight} 字号` },
      { name: `--ds-${item.name}-line`, value: `${item.lineHeight}px`, use: `${item.px}/${item.lineHeight} 行高` },
    ]),
    ...typography.weights.map(item => ({ name: `--ds-weight-${item.name}`, value: String(item.value), use: item.use })),
    ...spacing.steps.map(step => ({ name: `--ds-space-${step}`, value: `${step}px`, use: '4px 主网格' })),
    { name: '--ds-hairline', value: '1px', use: '描边宽度' },
    { name: '--ds-focus-offset', value: '2px', use: '焦点环 offset' },
    { name: '--ds-icon-inset', value: '2px', use: '图标光学内衬' },
    ...controls.heights.map(item => ({ name: `--ds-control-${item.name}`, value: `${item.px}px`, use: item.use })),
    { name: '--ds-touch-min', value: `${controls.touchMin}px`, use: 'coarse pointer 触控下限' },
    ...radii.map(item => ({ name: `--ds-radius-${item.name}`, value: `${item.px}px`, use: item.use })),
    { name: '--ds-shadow-card', value: 'card', use: '卡片静置' },
    { name: '--ds-shadow-overlay', value: 'overlay', use: '浮层' },
    { name: '--ds-shadow-panel', value: 'panel', use: '面板' },
    ...zIndex.map(item => ({ name: `--ds-z-${item.name}`, value: String(item.value), use: item.use })),
    { name: '--ds-z-receipt', value: 'overlay', use: '收据控件（不高于 Dialog）' },
    ...motion.map(item => ({ name: `--ds-duration-${item.name}`, value: `${item.ms}ms`, use: item.use })),
    { name: '--ds-focus-width', value: '2px', use: '焦点环宽度' },
  ]

  const migration = [
    ...Object.entries(aliases).map(([from, to]) => ({
      from,
      to,
      action: 'alias',
      note: 'v2 保留旧名，值指向新角色；迁移期无需改调用点',
    })),
    ...deadTokens.map(item => ({
      from: item.name,
      to: item.replacement,
      action: 'deleted',
      note: item.reason,
    })),
    { from: '--color-text-quaternary', to: '--ds-text-decorative', action: 'rename', note: '旧名兼容到 secondary（正文可读）；装饰用途改新名，禁止当正文' },
    { from: '--color-text-tertiary', to: '--ds-text-secondary', action: 'merge', note: '取消更浅的三级文本，层级靠字号/字重' },
    { from: '--color-background-default-*', to: '--ds-surface-*', action: 'rename', note: '五档语义 surface 取代 default 系列' },
    { from: '--radius-2xl', to: '--ds-radius-xl', action: 'rename', note: '10.8px → 12px；工作流用独立 --ds-radius-workflow-2xl:16px' },
  ]

  return {
    meta: {
      version: '2.0.0',
      generator: 'scripts/design-system/build-v2.mjs',
      source: 'packages/console/source/styles/index.css',
      v1SourceSha256: v1.meta?.sourceSha256 ?? null,
      counts,
    },
    neutral,
    brand,
    roles,
    statusFamilies,
    statusRoleKeys,
    aliases,
    contrast: contrastTable,
    pairs,
    issues,
    deadTokens,
    deadRefs,
    components,
    stateNames,
    typography,
    spacing,
    controls,
    radii,
    shadows,
    zIndex,
    motion,
    tokenIndex,
    rules: RULES,
    migration,
    v1Contrast: v1.contrast,
    v1Colors: v1.colors,
    v1Issues: v1.issues,
    literalCount: v1.meta?.counts?.literalColorSites ?? null,
  }
}

export const dataFingerprint = data => {
  const sample = [
    data.meta.version,
    data.neutral.map(item => item.hex).join(','),
    data.brand.map(item => item.hex).join(','),
    data.contrast.light.map(item => `${item.id}:${item.ratio}:${item.pass}`).join('|'),
    data.contrast.dark.map(item => `${item.id}:${item.ratio}:${item.pass}`).join('|'),
    data.issues.map(item => `${item.id}:${item.verdict}`).join('|'),
  ].join(';')
  let hash = 2166136261
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const contrastOf = (mode, id) => contrastTable[mode].find(item => item.id === id)
export const checkCssContrast = (fg, bg) => contrastHex(fg, bg)
