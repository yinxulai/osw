/**
 * README 渲染：只在 `<!-- GENERATED:key:start -->` / `end` 之间写入机器生成的表，
 * 其余叙述由人维护。这样文档里的每个色值、对比度、行号都能由抽取脚本复现。
 */

const pad = value => String(value).padStart(2, '0')

const colorCell = item => {
  if (!item || !item.hex) return '—'
  if (item.alpha !== null && item.alpha !== undefined && item.alpha < 0.999) {
    return `${item.hex.slice(0, 7)} · ${Math.round(item.alpha * 100)}%`
  }
  return item.hex
}

const ratioCell = value => (value === null || value === undefined ? '—' : `${value}:1`)

const verdict = (pair, mode) => {
  if (!pair || pair.threshold === null || pair.threshold === undefined) return '—'
  return pair[mode].pass ? '✅' : '❌'
}

const escapeCell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

const groupLabels = {
  base: '基础语义（shadcn 别名层）',
  text: '文本层级',
  feedback: '状态色（success / warning / info）',
  state: '交互态',
  component: '组件级',
  module: '模块边框',
  workflow: '工作流（仅 pages/router）',
  'data-viz': '图表 / 热力 / 图标色块',
  sidebar: '侧栏',
  other: '其他',
}

const groupOrder = ['base', 'text', 'feedback', 'state', 'component', 'module', 'sidebar', 'workflow', 'data-viz', 'other']

/** token 作为前景时的首选实测对；否则取它作为背景承载文本的那一对。 */
const measurementFor = (data, token) => {
  const candidates = data.contrast.filter(pair => pair.kind !== 'decorative')
  const asForeground = candidates.find(pair => typeof pair.fg === 'string' && pair.fg === token)
  if (asForeground) return { pair: asForeground, role: 'fg' }
  const asBackground = candidates.find(pair => typeof pair.bg === 'string' && pair.bg === token)
  if (asBackground) return { pair: asBackground, role: 'bg' }
  return null
}

const measurementCells = (data, token) => {
  const found = measurementFor(data, token)
  if (!found) return { ratio: '— / —', against: '— / —', threshold: '—', note: '' }
  const { pair, role } = found
  const lightAgainst = role === 'fg' ? pair.light.bgHex : pair.light.fgHex
  const darkAgainst = role === 'fg' ? pair.dark.bgHex : pair.dark.fgHex
  const threshold = pair.threshold === null ? '—' : pair.kind === 'text' ? '4.5:1' : pair.kind === 'ui' ? '3:1' : '—'
  return {
    ratio: `${ratioCell(pair.light.ratio)} ${verdict(pair, 'light')} / ${ratioCell(pair.dark.ratio)} ${verdict(pair, 'dark')}`,
    against: `${lightAgainst ?? '—'} / ${darkAgainst ?? '—'}`,
    threshold,
    note: role === 'bg' ? '（其上文本）' : '',
  }
}

const renderStats = data => `| 项 | 数量 |
| --- | --- |
| CSS 自定义属性声明（含排版/圆角/阴影） | ${data.meta.counts.cssDeclarations} |
| 颜色 token（\`--color-*\`，含 shadcn 别名层） | ${data.meta.counts.colorTokens} |
| 原始通道 token（\`:root\` / \`.dark\`） | ${data.meta.counts.primitives} |
| 排版 utility（\`system-*\`） | ${data.meta.counts.typographyUtilities} |
| 对比度实测对 | ${data.meta.counts.contrastPairs} |
| 源码中的字面颜色出现点（含注释/插图） | ${data.meta.counts.literalColorSites} |
| 问题 | ${data.meta.issues.P0} P0 / ${data.meta.issues.P1} P1 / ${data.meta.issues.P2} P2 / ${data.meta.issues.P3} P3 |
| 未核实项 / 待拍板项 | ${data.meta.counts.unverified} / ${data.meta.counts.decisions} |
| 样式源 SHA-256（前 16 位） | \`${data.meta.sourceSha256.slice(0, 16)}\` |`

const renderPrimitives = data => {
  const light = new Map(data.primitives.light.map(item => [item.name, item]))
  const dark = new Map(data.primitives.dark.map(item => [item.name, item]))
  const names = [...light.keys()].sort()
  const rows = names.map(name => {
    const l = light.get(name)
    const d = dark.get(name)
    return `| \`${name}\` | \`${escapeCell(l?.value ?? '—')}\` | \`${escapeCell(d?.value ?? '—')}\` | ${l?.line ?? d?.line} |`
  })
  return `| Token | 亮色（原始值） | 暗色（原始值） | index.css 行 |
| --- | --- | --- | --- |
${rows.join('\n')}`
}

const renderColors = data => {
  const byGroup = new Map()
  data.colors.light.forEach((item, index) => {
    if (!byGroup.has(item.group)) byGroup.set(item.group, [])
    byGroup.get(item.group).push({ light: item, dark: data.colors.dark[index] })
  })

  const chunks = []
  for (const group of groupOrder) {
    const list = byGroup.get(group)
    if (!list || list.length === 0) continue
    const rows = list.map(({ light, dark }) => {
      const measure = measurementCells(data, light.name)
      return `| \`${light.name.replace('--color-', '')}\` | ${colorCell(light)} | ${colorCell(dark)} | ${measure.ratio} | ${measure.against}${measure.note ?? ''} | ${measure.threshold} | ${light.line ?? '—'} |`
    })
    chunks.push(`#### ${groupLabels[group] ?? group}（${list.length}）

| Token | 亮色 | 暗色 | 实测对比（亮 / 暗） | 量对（亮 / 暗） | 阈值 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}`)
  }
  return chunks.join('\n\n')
}

const renderContrast = data => {
  const rows = [...data.contrast]
    .sort((a, b) => {
      const rank = kind => (kind === 'text' ? 0 : kind === 'ui' ? 1 : 2)
      return rank(a.kind) - rank(b.kind)
    })
    .map(pair => {
      const fg = typeof pair.fg === 'string' ? pair.fg : `${pair.fg.token}${pair.fg.alpha !== undefined ? ` ×${pair.fg.alpha}` : ''}`
      const bg = typeof pair.bg === 'string' ? pair.bg : `${pair.bg.token}${pair.bg.alpha !== undefined ? ` ×${pair.bg.alpha}` : ''}${pair.bg.over ? ` over ${pair.bg.over}` : ''}`
      const pretty = value => value.replace(/--color-/g, '')
      const threshold = pair.threshold === null ? '—（装饰/禁用）' : `${pair.threshold}:1`
      return `| ${escapeCell(pair.label)} | \`${pretty(fg)}\` | \`${pretty(bg)}\` | ${ratioCell(pair.light.ratio)} ${verdict(pair, 'light')} | ${ratioCell(pair.dark.ratio)} ${verdict(pair, 'dark')} | ${threshold} |`
    })
  return `| 用途 | 前景 | 背景 | 亮色 | 暗色 | 阈值 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

> 说明：\`❌\` 表示该模式低于阈值，\`—\` 表示装饰性/禁用态（不参与 WCAG 对比度门槛）。
> 半透明前景先与背景合成再计算；半透明背景先与其承载层（卡片/页面底）合成。`
}

const renderTypography = data => {
  const rows = data.typography
    .slice()
    .sort((a, b) => Number.parseFloat(a.fontSize) - Number.parseFloat(b.fontSize) || Number(a.fontWeight) - Number(b.fontWeight) || a.name.localeCompare(b.name))
    .map(item => `| \`${item.name}\` | ${item.fontSize} | ${item.lineHeight} | ${item.fontWeight} | ${item.uppercase ? '是' : '否'} | ${item.usage} | ${item.line} |`)
  return `| Utility | 字号 | 行高 | 字重 | 大写 | 源码引用次数 | index.css 行 |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}`
}

const renderFonts = data => `| Token | 值 | index.css 行 |
| --- | --- | --- |
${data.fonts.map(item => `| \`${item.name}\` | \`${escapeCell(item.value)}\` | ${item.line} |`).join('\n')}`

const renderTypeScale = data => {
  const sizes = new Map()
  for (const item of data.typography) {
    const key = `${item.fontSize}/${item.lineHeight}`
    if (!sizes.has(key)) sizes.set(key, [])
    sizes.get(key).push(item.name.replace(/^system-/, ''))
  }
  return [...sizes.entries()]
    .sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]))
    .map(([key, names]) => `| ${key} | ${[...new Set(names.map(name => name.split('-')[0]))].join(' / ')} |`)
    .join('\n')
}

const renderSpacing = data => {
  const rows = data.spacing.steps.map(item => `| ${item.step} | ${item.px}px | ${item.count} | ${item.onFourGrid ? '✅' : '❌'} | ${item.onEightGrid ? '✅' : '❌'} |`)
  const off = data.spacing.steps.filter(item => !item.onFourGrid)
  return `| Tailwind 步长 | 像素 | 使用次数 | 4px 网格 | 8px 网格 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

- 4px 网格外的步长：${off.map(item => `\`${item.step}\`（${item.px}px，${item.count} 次）`).join('、') || '无'}
- 8px 网格外的步长：${data.spacing.steps.filter(item => !item.onEightGrid).map(item => `\`${item.step}\``).join('、')}
- 统计口径：\`packages/console/source/**/*.tsx\` 中的 \`p/m/gap/space-*\` 类名；\`--spacing\` 未在本仓库覆盖，取 Tailwind v4 默认 \`0.25rem\`。`
}

const renderRadii = data => `| Token | 原始值 | 解析值 | index.css 行 |
| --- | --- | --- | --- |
${data.radii.map(item => `| \`${item.name}\` | \`${escapeCell(item.raw)}\` | ${item.px === null ? '—' : `${Number(item.px.toFixed(2))}px`} | ${item.line} |`).join('\n')}`

const renderShadows = data => `| Token | 亮色 | 暗色 | index.css 行 |
| --- | --- | --- | --- |
${data.shadows.map(item => `| \`${item.name}\` | \`${escapeCell(item.light ?? '—')}\` | \`${escapeCell(item.dark ?? '—')}\` | ${item.line} |`).join('\n')}`

const renderZIndex = data => `| z 值 | 次数 | 示例 |
| --- | --- | --- |
${data.zIndex.map(item => `| \`z-${item.value}\` | ${item.count} | ${item.examples.map(example => `\`${example}\``).join('<br>')} |`).join('\n')}`

const renderMotion = data => `| 观察项 | 数值 |
| --- | --- |
| 使用 \`animate-*\` 的文件 | ${data.motion.animationFiles} |
| \`animate-*\` 出现次数 | ${data.motion.animationOccurrences} |
| \`motion-reduce:\` / \`motion-safe:\` 出现次数 | ${data.motion.guardOccurrences} |
| \`prefers-reduced-motion\` 媒体块 | ${data.motion.reducedMotionBlocks} |
| \`@keyframes\` | ${data.motion.keyframes.map(item => `\`${item.name}\`（index.css:${item.line}）`).join('、')} |

| \`duration-*\` | 次数 |
| --- | --- |
${data.motion.durations.map(item => `| ${item.duration}ms | ${item.count} |`).join('\n')}`

const renderBreakpoints = data => `| 断点 | 默认最小宽度 | 源码使用次数 |
| --- | --- | --- |
${data.breakpoints.map(item => `| \`${item.name}:\` | ${item.minWidthPx}px（${item.minWidthPx / 16}rem） | ${item.count} |`).join('\n')}

> 仓库没有声明 \`--breakpoint-*\`，以上为 Tailwind v4 默认值；\`xl\` 为 0 次使用。`

const renderIssues = data => {
  const order = ['P0', 'P1', 'P2', 'P3']
  const labels = { P0: 'P0 · 用户现在就可能读不到/点不到', P1: 'P1 · 系统一致性/可访问性缺口', P2: 'P2 · 可维护性与漂移', P3: 'P3 · 文档与命名' }
  const chunks = []
  for (const severity of order) {
    const list = data.issues.filter(item => item.severity === severity)
    if (list.length === 0) continue
    chunks.push(`### ${labels[severity]}（${list.length}）

| ID | 类别 | 问题 | 证据 | 影响 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
${list.map(item => `| ${item.id} | ${escapeCell(item.category)} | ${escapeCell(item.title)} | ${escapeCell(item.evidence)} | ${escapeCell(item.impact)} | ${escapeCell(item.fix)} |`).join('\n')}`)
  }
  return chunks.join('\n\n')
}

const renderInventory = data => {
  const unref = data.inventory.unreferenced.map(name => {
    const decl = data.colors.light.find(item => item.name === name)
    return `- \`${name}\`${decl?.line ? `（index.css:${decl.line}）` : ''}`
  })
  const undeclared = data.inventory.undeclaredRefs.map(item => `- \`${item.name}\`：${item.refs.map(ref => `\`${ref.file}:${ref.line}\``).join('、')}`)
  return `### 已声明、源码中零引用（${data.inventory.unreferenced.length}）

${unref.join('\n')}

### 动态引用白名单（${data.inventory.whitelist.length}）

| Token | 理由 |
| --- | --- |
${data.inventory.whitelist.map(item => `| \`${item.name}\` | ${escapeCell(item.reason)} |`).join('\n')}

### 未声明却被 \`var()\` 引用（${data.inventory.undeclaredRefs.length}）

${undeclared.length ? undeclared.join('\n') : '- 无'}

### 样式表内 \`var()\` 缺声明（${data.inventory.cssUndeclared.length}）

${data.inventory.cssUndeclared.length ? data.inventory.cssUndeclared.map(name => `- \`${name}\``).join('\n') : '- 无'}

> 第三方运行时变量（\`--radix-*\`、\`--tw-*\`、Base UI 的 \`--anchor-*\`）已登记在抽取脚本的白名单里，见 \`scripts/design-system/extract-tokens.mjs\`。`
}

const renderOpenQuestions = data => `### 未核实（${data.openQuestions.unverified.length}）

| # | 项 | 为什么没核实 | 怎么核实 |
| --- | --- | --- | --- |
${data.openQuestions.unverified.map((item, index) => `| ${index + 1} | ${escapeCell(item.item)} | ${escapeCell(item.detail)} | ${escapeCell(item.howToVerify)} |`).join('\n')}

### 待拍板（${data.openQuestions.decisions.length}）

| # | 决策 | 选项 | 为什么必须拍板 |
| --- | --- | --- | --- |
${data.openQuestions.decisions.map((item, index) => `| ${index + 1} | ${escapeCell(item.item)} | ${escapeCell(item.options)} | ${escapeCell(item.why)} |`).join('\n')}`

const renderComponentInventory = data => {
  const rows = [
    ['Button', 'button.tsx', '32px 默认 / 28 / 24 / 36', 'default · hover · active(translate-y-px) · focus-visible(ring-2) · disabled(opacity-50) · 无 loading', '原生 button；aria-invalid 有 ring；图标按钮无 aria-label 约定'],
    ['Input', 'input.tsx', 'h-8；圆角 6px；13/16', 'default · hover(底/边) · focus(底/边) · disabled(底/文字) · aria-invalid · 无 loading', '依赖 placeholder 提示；静止态无边框'],
    ['Select', 'select.tsx', 'h-8 / min-w-36；13/16', 'default · hover · focus(bg) · disabled(opacity-50) · open(浮层)', 'Radix 键盘语义；焦点只改底色'],
    ['Badge', 'badge.tsx', 'h-5；11/16 medium；圆角 4px', '6 个静态 variant；链接态 hover；无 disabled/loading', '11px 是字号下限；状态色文本未全达标'],
    ['Card', 'card.tsx', 'padding 16 / sm 12；圆角 10px', 'default · sm；无 hover/selected 内建', '卡片靠 shadow-card + 画布明度差分离'],
    ['Dialog', 'dialog.tsx', 'max-w-sm（384px）；p-4；圆角 10px', 'open · closed（fade/zoom）· 无 loading', 'Radix 焦点陷阱；关闭按钮 28px'],
    ['Table', 'table.tsx', 'th h-10；td p-2；12/16', 'default · row hover · selected · expanded', '无 sticky 表头内建；页面自行加'],
    ['Skeleton', 'skeleton.tsx', '自适应；圆角 4px', 'pulse（无 reduced-motion 降级）', '纯装饰，需 aria-hidden'],
    ['Empty', 'empty.tsx', 'p-6；圆角 10px；max-w-sm', 'default · icon · embedded（EmptyState）', '虚线边框宽度为 0'],
    ['Toast', 'sonner.tsx / toast.tsx', 'bottom-right；默认 4000ms，error 6000ms', 'success · error · info · warning · loading', 'sonner 提供 aria-live'],
    ['Tooltip', 'tooltip.tsx', 'max-w-xs；12/16；圆角 4px', 'delayed-open · open · closed', '反色底；`components-tooltip-bg` 未使用'],
  ]
  return `| 组件 | 源文件 | 关键尺寸 | 状态 | 可访问性要点 |
| --- | --- | --- | --- | --- |
${rows.map(row => `| **${row[0]}** | \`components/ui/${row[1]}\` | ${row[2]} | ${row[3]} | ${row[4]} |`).join('\n')}`
}

const replaceBlock = (source, key, content) => {
  const pattern = new RegExp(`(<!-- GENERATED:${key}:start -->)[\\s\\S]*?(<!-- GENERATED:${key}:end -->)`)
  if (!pattern.test(source)) return source
  return source.replace(pattern, `$1\n${content.trim()}\n$2`)
}

export const renderReadme = (data, previous) => {
  let output = previous || ''
  output = replaceBlock(output, 'stats', renderStats(data))
  output = replaceBlock(output, 'primitives', renderPrimitives(data))
  output = replaceBlock(output, 'colors', renderColors(data))
  output = replaceBlock(output, 'contrast', renderContrast(data))
  output = replaceBlock(output, 'fonts', renderFonts(data))
  output = replaceBlock(output, 'typography', renderTypography(data))
  output = replaceBlock(output, 'type-scale', renderTypeScale(data))
  output = replaceBlock(output, 'spacing', renderSpacing(data))
  output = replaceBlock(output, 'radii', renderRadii(data))
  output = replaceBlock(output, 'shadows', renderShadows(data))
  output = replaceBlock(output, 'z-index', renderZIndex(data))
  output = replaceBlock(output, 'motion', renderMotion(data))
  output = replaceBlock(output, 'breakpoints', renderBreakpoints(data))
  output = replaceBlock(output, 'issues', renderIssues(data))
  output = replaceBlock(output, 'inventory', renderInventory(data))
  output = replaceBlock(output, 'open-questions', renderOpenQuestions(data))
  output = replaceBlock(output, 'component-inventory', renderComponentInventory(data))
  return output
}
