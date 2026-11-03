/**
 * 预览页渲染。所有颜色/尺寸/对比度都来自 `tokens.generated.json`，
 * 页面自身的颜色只通过生成的 `--ds-color-*` 变量引用，不另写一套色值。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(HERE, 'page.template.html')

const esc = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const groupLabels = {
  base: '基础语义（shadcn 别名层）',
  text: '文本层级',
  feedback: '状态色',
  state: '交互态',
  component: '组件级',
  module: '模块边框',
  sidebar: '侧栏',
  workflow: '工作流',
  'data-viz': '图表 / 热力 / 图标',
  other: '其他',
}
const groupOrder = ['base', 'text', 'feedback', 'state', 'component', 'module', 'sidebar', 'workflow', 'data-viz', 'other']

const pretty = name => name.replace(/^--color-/, '')
const cssVar = name => `--ds-${name.replace(/^--/, '')}`

const hexLabel = item => {
  if (!item || !item.hex) return '未解析'
  if (item.alpha !== null && item.alpha !== undefined && item.alpha < 0.999) {
    return `${item.hex.slice(0, 7)} · ${Math.round(item.alpha * 100)}%`
  }
  return item.hex
}

const measurementFor = (data, token) => {
  const candidates = data.contrast.filter(pair => pair.kind !== 'decorative')
  const asForeground = candidates.find(pair => typeof pair.fg === 'string' && pair.fg === token)
  if (asForeground) return { pair: asForeground, role: 'fg' }
  const asBackground = candidates.find(pair => typeof pair.bg === 'string' && pair.bg === token)
  if (asBackground) return { pair: asBackground, role: 'bg' }
  return null
}

const ratioText = (pair, mode) => {
  if (!pair || pair[mode].ratio === null) return '—'
  const mark = pair[mode].pass === null ? '' : pair[mode].pass ? ' ✅' : ' ❌'
  return `${pair[mode].ratio}:1${mark}`
}

const measurement = (data, token) => {
  const found = measurementFor(data, token)
  if (!found) {
    const empty = { ratio: '—', against: '—', className: 'ratio-none' }
    return { light: empty, dark: empty, threshold: '—' }
  }
  const { pair, role } = found
  const build = mode => {
    const against = role === 'fg' ? pair[mode].bgHex : pair[mode].fgHex
    const failed = pair[mode].pass === false
    return {
      ratio: ratioText(pair, mode),
      against: against ?? '—',
      className: pair[mode].pass === null ? 'ratio-none' : failed ? 'ratio-fail' : 'ratio-pass',
    }
  }
  return {
    light: build('light'),
    dark: build('dark'),
    threshold: pair.threshold === null ? '—' : `${pair.threshold}:1`,
  }
}

const renderSwatches = data => {
  const groups = new Map()
  data.colors.light.forEach((item, index) => {
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group).push({ light: item, dark: data.colors.dark[index] })
  })

  const chunks = []
  for (const group of groupOrder) {
    const list = groups.get(group)
    if (!list || list.length === 0) continue
    const cards = list.map(({ light, dark }) => {
      const measure = measurement(data, light.name)
      const lightDisplay = hexLabel(light)
      const darkDisplay = hexLabel(dark)
      return `<button class="swatch" type="button" data-token="${esc(light.name)}" data-hex-light="${esc(lightDisplay)}" data-hex-dark="${esc(darkDisplay)}" data-ratio-light="${esc(measure.light.ratio)}" data-ratio-dark="${esc(measure.dark.ratio)}" data-against-light="${esc(measure.light.against)}" data-against-dark="${esc(measure.dark.against)}" data-threshold="${esc(measure.threshold)}" title="${esc(light.name)} · 亮 ${esc(lightDisplay)} · 暗 ${esc(darkDisplay)}">
  <span class="chip"><span class="fill" style="background: var(${cssVar(light.name)})"></span></span>
  <span class="meta">
    <span class="name">${esc(pretty(light.name))}</span>
    <span class="value"><span>亮 ${esc(lightDisplay)}</span><span class="ratio ${measure.light.className}">${esc(measure.light.ratio)}</span></span>
    <span class="value"><span>暗 ${esc(darkDisplay)}</span><span class="ratio ${measure.dark.className}">${esc(measure.dark.ratio)}</span></span>
  </span>
</button>`
    })
    chunks.push(`<h3 id="colors-${group}">${groupLabels[group] ?? group} <span class="muted tiny">${list.length}</span></h3>
<div class="grid swatches">
${cards.join('\n')}
</div>`)
  }
  return chunks.join('\n')
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
      const threshold = pair.threshold === null ? '—' : `${pair.threshold}:1`
      const lightClass = pair.light.pass === false ? 'ratio-fail' : pair.light.pass ? 'ratio-pass' : 'ratio-none'
      const darkClass = pair.dark.pass === false ? 'ratio-fail' : pair.dark.pass ? 'ratio-pass' : 'ratio-none'
      return `<tr>
<td>${esc(pair.label)}</td>
<td class="token-name">${esc(pretty(fg))}</td>
<td class="token-name">${esc(bg.replace(/--color-/g, ''))}</td>
<td class="num ${lightClass}">${ratioText(pair, 'light')}</td>
<td class="num ${darkClass}">${ratioText(pair, 'dark')}</td>
<td class="nowrap">${threshold}</td>
</tr>`
    })
  return `<div class="table-wrap"><table><thead><tr><th>用途</th><th>前景</th><th>背景</th><th class="num">亮色</th><th class="num">暗色</th><th>阈值</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

const renderSpacing = data => {
  const max = Math.max(...data.spacing.steps.map(item => item.px), 1)
  const rows = data.spacing.steps
    .map(item => {
      const width = Math.max(2, (item.px / max) * 100)
      return `<div class="spacing-row ${item.onFourGrid ? '' : 'off'}">
  <span class="label">${item.step} → ${item.px}px</span>
  <span><span class="spacing-bar" style="width:${width.toFixed(2)}%"></span></span>
  <span class="tiny">${item.onFourGrid ? '4px ✅' : '4px ❌'} · ${item.onEightGrid ? '8px ✅' : '8px —'}</span>
  <span class="count">×${item.count}</span>
</div>`
    })
    .join('\n')
  return rows
}

const renderType = data => {
  const sizes = new Map()
  for (const item of data.typography) {
    const key = `${item.fontSize}/${item.lineHeight}`
    if (!sizes.has(key)) sizes.set(key, [])
    sizes.get(key).push(item)
  }
  const samples = [...sizes.entries()]
    .sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]))
    .map(([key, items]) => {
      const [fontSize, lineHeight] = key.split('/')
      const names = [...new Set(items.map(item => item.name.replace(/^system-/, '').split('-')[0]))].join(' / ')
      return `<div class="type-row">
  <div class="type-meta">${key} · ${names}<br>${items.length} 个变体</div>
  <div class="type-sample" style="font-size:${fontSize};line-height:${lineHeight};font-weight:${items[0].fontWeight}">请求日志 Request logs · 1,284 条 · 0.42s · 失败 3</div>
</div>`
    })
    .join('\n')

  const table = data.typography
    .slice()
    .sort((a, b) => Number.parseFloat(a.fontSize) - Number.parseFloat(b.fontSize) || Number(a.fontWeight) - Number(b.fontWeight))
    .map(item => `<tr><td class="token-name">${esc(item.name)}</td><td class="num">${item.fontSize}</td><td class="num">${item.lineHeight}</td><td class="num">${item.fontWeight}</td><td>${item.uppercase ? '是' : '否'}</td><td class="num">${item.usage}</td><td class="num">${item.line}</td></tr>`)
    .join('')

  return { samples, table }
}

const renderRadii = data => data.radii
  .map(item => `<div class="shape">
  <div class="box" style="border-radius:${item.px ?? 0}px"></div>
  <div class="type-meta">${esc(item.name)}<br>${item.px === null ? '—' : `${Number(item.px.toFixed(2))}px`}</div>
</div>`)
  .join('')

const renderLayers = data => {
  const cardShadow = data.shadows.find(item => item.name === '--shadow-card')
  const hoverShadow = data.shadows.find(item => item.name === '--shadow-card-hover')
  const shadowCards = [cardShadow, hoverShadow]
    .filter(Boolean)
    .map(item => `<div class="shape">
  <div class="shadow-box" style="box-shadow:var(${item.name === '--shadow-card' ? '--ds-shadow-card' : '--ds-shadow-hover'})">${esc(item.name)}</div>
  <div class="type-meta">${item.light ? '亮/暗各一套' : ''}</div>
</div>`)
    .join('')

  const zRows = data.zIndex
    .map(item => `<tr><td class="token-name">z-${esc(item.value)}</td><td class="num">${item.count}</td><td>${item.examples.map(example => `<code>${esc(example)}</code>`).join('<br>')}</td></tr>`)
    .join('')

  const layers = data.zIndex.map((item, index) => `<div class="z-layer" style="bottom:${8 + index * 30}px;left:${16 + index * 7}px;right:${16 + index * 7}px;z-index:${Number.parseInt(item.value, 10) || 1}">
  <span>${esc(item.examples[0]?.split('/').pop() ?? '')}</span><span class="z">z-${esc(item.value)} · ×${item.count}</span>
</div>`).join('')

  return { shadowCards, zRows, layers }
}

const spinner = '<span class="spinner" aria-hidden="true"></span>'
const chevron = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

const stateGrid = (component, rows) => `<div class="state-grid">
  <div class="head">${esc(component)}</div>
  <div class="head">default</div><div class="head">hover</div><div class="head">active</div><div class="head">focus</div><div class="head">disabled</div><div class="head">loading</div>
${rows}
</div>`

const btn = (variant, state, text) => {
  const cls = variant === 'primary' ? 'btn' : `btn ${variant}`
  const disabled = state === 'disabled' ? ' disabled' : ''
  const content = state === 'loading' ? `${spinner}<span>${esc(text)}</span>` : esc(text)
  return `<button class="${cls}" type="button" data-state="${state}"${disabled} tabindex="-1">${content}</button>`
}

const buttonRows = ['primary', 'secondary', 'ghost', 'destructive']
  .map(variant => {
    const label = variant === 'primary' ? 'Primary' : variant === 'secondary' ? 'Secondary' : variant === 'ghost' ? 'Ghost' : 'Destructive'
    return `<div class="row-label">${label}</div>` + ['default', 'hover', 'active', 'focus', 'disabled', 'loading']
      .map(state => `<div class="state-cell">${btn(variant, state, state === 'loading' ? '保存中' : '保存')}</div>`)
      .join('')
  })
  .join('')

const fieldCells = states => states
  .map(state => {
    if (state === 'loading') return `<div class="state-cell"><div class="field" data-state="loading" aria-busy="true">${spinner}<span class="placeholder">校验中…</span></div></div>`
    if (state === 'active') return `<div class="state-cell"><div class="field" data-state="focus">已输入的内容</div></div>`
    return `<div class="state-cell"><div class="field" data-state="${state}"${state === 'disabled' ? ' aria-disabled="true"' : ''}>${state === 'default' || state === 'hover' ? '<span class="placeholder">输入模型名称</span>' : state === 'disabled' ? '不可编辑' : '已输入的内容'}</div></div>`
  })
  .join('')

const selectCells = ['default', 'hover', 'active', 'focus', 'disabled', 'loading']
  .map(state => {
    const content = state === 'loading' ? `${spinner}<span class="placeholder">加载选项…</span>` : `gpt-4o-mini ${chevron}`
    return `<div class="state-cell"><div class="field select-field" data-state="${state === 'active' ? 'focus' : state}"${state === 'disabled' ? ' aria-disabled="true"' : ''}${state === 'loading' ? ' aria-busy="true"' : ''}>${content}</div></div>`
  })
  .join('')

// Badge 没有状态档（不能 hover/不能聚焦），它只有色调。把色调塞进六态列会凭空造出四个状态。
const badgeTones = [
  ['neutral', '默认'], ['success', '成功'], ['warning', '警告'], ['info', '信息'], ['danger', '危险'],
].map(([tone, text]) => `<div class="state-cell"><span class="chip-badge ${tone}">${text}</span></div>`).join('')

const cardCells = ['default', 'hover', 'active', 'focus', 'disabled', 'loading']
  .map(state => {
    if (state === 'loading') return '<div class="state-cell"><div class="mini-card"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:90%"></div><div class="skeleton-line" style="width:40%"></div></div></div>'
    // 静态卡片没有状态；可点击的卡片（route-mode-option-card）才有 hover/selected：
    // hover 改描边为 text-quaternary，选中改为 state-accent-solid——这是实现里的真实取值。
    if (state === 'focus') return '<div class="state-cell na"><span class="tiny">N/A</span></div>'
    const extra = state === 'hover' ? 'border-color:var(--ds-color-text-quaternary)' : state === 'active' ? 'border-color:var(--ds-color-state-accent-solid)' : state === 'disabled' ? 'opacity:.55' : ''
    return `<div class="state-cell"><div class="mini-card" data-state="${state}" style="${extra}"><div style="font-size:12px;font-weight:600">路由规则</div><div class="tiny" style="margin-top:4px">3 条规则 · 命中 128 次</div></div></div>`
  })
  .join('')

const dialogCells = [
  ['default', '打开'],
  ['hover', '悬停关闭'],
  ['active', '按下'],
  ['focus', '焦点'],
  ['disabled', '禁用'],
  ['loading', '提交中'],
].map(([state, label]) => `<div class="state-cell"><div class="dialog-card" data-state="${state === 'focus' ? 'selected' : state === 'active' ? 'hover' : state}" style="${state === 'focus' ? 'outline:2px solid var(--ds-accent);outline-offset:2px' : ''}">
  <div style="font-size:11.5px;font-weight:600;display:flex;justify-content:space-between"><span>删除模型</span><span class="muted">×</span></div>
  <div class="tiny" style="margin:5px 0">此操作不可撤销。</div>
  <div style="display:flex;gap:5px;justify-content:flex-end">${state === 'loading' ? `<span class="btn" style="height:24px;font-size:11px">${spinner}删除中</span>` : `<span class="btn secondary" style="height:24px;font-size:11px">取消</span><span class="btn" style="height:24px;font-size:11px">删除</span>`}</div>
  <div class="tiny" style="margin-top:4px">${label}</div>
</div></div>`).join('')

const tableRows = [
  ['default', '200', '/v1/chat/completions', '1.2s'],
  ['hover', '200', '/v1/chat/completions', '0.8s'],
  ['selected', '200', '/v1/embeddings', '0.2s'],
  ['expanded', '429', '/v1/chat/completions', '0.1s'],
  ['disabled', '—', '已归档', '—'],
  ['loading', '', '', ''],
].map(([state, status, path, latency]) => `<tr data-state="${state}"><td>${esc(state)}</td><td>${state === 'loading' ? '<span class="skeleton-line" style="width:34px;margin:0"></span>' : esc(status)}</td><td>${state === 'loading' ? '<span class="skeleton-line" style="width:120px;margin:0"></span>' : `<code>${esc(path)}</code>`}</td><td>${state === 'loading' ? '<span class="skeleton-line" style="width:28px;margin:0"></span>' : esc(latency)}</td></tr>`).join('')

const skeletonCells = [
  ['pulse', '<div class="skeleton-line" style="width:80%"></div><div class="skeleton-line" style="width:55%"></div>'],
  ['static', '<div style="height:8px;border-radius:4px;background:color-mix(in srgb, var(--ds-text) 12%, transparent);width:80%;margin:6px 0"></div><div style="height:8px;border-radius:4px;background:color-mix(in srgb, var(--ds-text) 12%, transparent);width:55%;margin:6px 0"></div>'],
  ['line', '<div class="skeleton-line" style="width:100%"></div>'],
  ['circle', '<div style="width:28px;height:28px;border-radius:50%;background:color-mix(in srgb, var(--ds-text) 12%, transparent)"></div>'],
  ['block', '<div style="width:100%;height:42px;border-radius:6px;background:color-mix(in srgb, var(--ds-text) 12%, transparent)"></div>'],
  ['—', '<span class="tiny">N/A</span>'],
].map(([label, content]) => `<div class="state-cell"><div style="width:100%"><div class="tiny">${label}</div>${content}</div></div>`).join('')

// Empty 的真实取值：p-6 / rounded-xl，`border-dashed` 没给宽度所以边框不渲染（DS-012）。
// 这里按实现的真实结果画：没有边框，并在格子里标出来，而不是替组件补一条虚线。
const emptyCard = '<div style="border:0;border-radius:var(--ds-radius-xl);padding:24px;text-align:center;width:100%"><div style="font-size:14px;font-weight:600">暂无数据</div><div class="tiny">调整筛选后重试</div><div class="tiny" style="margin-top:6px;color:var(--ds-text-4)">border-width 0（DS-012）</div></div>'

// Empty 只有 default 与 loading 两个状态档；其余四档在实现里不存在，标 N/A 而不是编一个出来。
const emptyCells = [
  ['default', emptyCard],
  ['hover', '<span class="tiny">N/A</span>'],
  ['active', '<span class="tiny">N/A</span>'],
  ['focus', '<span class="tiny">N/A</span>'],
  ['disabled', '<span class="tiny">N/A</span>'],
  ['loading', '<div style="width:100%"><div class="skeleton-line" style="width:70%;margin:6px auto"></div><div class="skeleton-line" style="width:45%;margin:6px auto"></div></div>'],
// 状态名由表头给，不在格子里重复；这里只渲染内容。
].map(([, content]) => `<div class="state-cell"><div style="width:100%">${content}</div></div>`).join('')

// 这些是 Empty 的变体（内嵌 / 失败 / 带操作），不是状态，所以单独一行，不塞进六态矩阵。
const emptyVariants = [
  ['embedded', '<div style="padding:8px;text-align:center;width:100%"><div class="tiny">没有匹配的请求</div></div>'],
  ['destructive', '<div style="border:1px dashed var(--ds-danger);border-radius:8px;padding:10px;text-align:center;width:100%;color:var(--ds-danger)"><div style="font-size:12px">加载失败</div></div>'],
  ['action', '<div style="text-align:center;width:100%"><div class="tiny">还没有密钥</div><div class="btn" style="height:24px;font-size:11px;margin-top:4px">新建</div></div>'],
].map(([label, content]) => `<div class="state-cell"><div style="width:100%"><div class="tiny">${label}</div>${content}</div></div>`).join('')

const toastCells = ['default', 'hover', 'active', 'focus', 'disabled', 'loading']
  .map(state => {
    const extra = state === 'focus' ? 'outline:2px solid var(--ds-accent);outline-offset:1px' : state === 'disabled' ? 'opacity:.5' : state === 'active' ? 'transform:translateY(1px)' : ''
    return `<div class="state-cell"><div class="toast-sample" data-state="${state}" style="${extra}"${state === 'loading' ? ' aria-busy="true"' : ''}>${state === 'loading' ? spinner : '<span class="dot"></span>'}<span>${state === 'loading' ? '正在提交…' : '已保存'}</span></div></div>`
  })
  .join('')

const toastTones = [
  ['success', '已保存'], ['error', '保存失败'], ['info', '已复制'], ['warning', '即将过期'],
].map(([tone, text]) => `<div class="state-cell"><div class="toast-sample ${tone}"><span class="dot"></span><span>${text}</span></div></div>`).join('')

const renderComponents = data => `<h3 id="components-button">Button · 四变体 × 六态</h3>
${specLine(data, 'button')}
<div class="card" style="overflow-x:auto">${stateGrid('Button', buttonRows)}</div>

<h3 id="components-field">Input / Select · 六态</h3>
${specLine(data, 'input') + specLine(data, 'select')}
<div class="card" style="overflow-x:auto">
  ${stateGrid('Input', `<div class="row-label">Input</div>${fieldCells(['default', 'hover', 'active', 'focus', 'disabled', 'loading'])}`)}
  <div style="height:10px"></div>
  ${stateGrid('Select', `<div class="row-label">Select</div>${selectCells}`)}
</div>

<h3 id="components-badge">Badge · 色调 / Card · 状态</h3>
${specLine(data, 'badge') + specLine(data, 'card')}
<div class="card" style="overflow-x:auto">
  <div class="state-grid"><div class="row-label">Badge</div>${badgeTones}</div>
  <div style="height:10px"></div>
  ${stateGrid('Card', `<div class="row-label">Card</div>${cardCells}`)}
</div>

<h3 id="components-tooltip">Tooltip · 六态</h3>
${specLine(data, 'tooltip')}
<div class="card" style="overflow-x:auto">
  ${stateGrid('Tooltip', `<div class="row-label">Bubble</div>` + ['default', 'hover', 'active', 'focus', 'disabled', 'loading'].map(state => {
    if (state === 'disabled') return '<div class="state-cell na">N/A</div>'
    if (state === 'loading') return '<div class="state-cell na">N/A</div>'
    const extra = state === 'focus' ? 'outline:2px solid var(--ds-accent);outline-offset:1px' : state === 'active' ? 'transform:translateY(1px)' : state === 'hover' ? 'box-shadow:var(--ds-shadow-card)' : ''
    return `<div class="state-cell"><div class="toast-sample" style="${extra}"><span>Shift + Enter 换行</span></div></div>`
  }).join(''))}
</div>

<h3 id="components-dialog">Dialog · 六态</h3>
${specLine(data, 'dialog')}
<div class="card" style="overflow-x:auto">
  ${stateGrid('Dialog', `<div class="row-label">Alert</div>${dialogCells}`)}
</div>

<h3 id="components-table">Table · 行六态</h3>
${specLine(data, 'table')}
<div class="table-wrap">
  <table class="spec-table">
    <thead><tr><th>状态</th><th>状态码</th><th>路径</th><th>耗时</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>

<h3 id="components-skeleton">Skeleton / Empty / Toast · 六态</h3>
${specLine(data, 'skeleton') + specLine(data, 'empty')}
<div class="card" style="overflow-x:auto">
  ${stateGrid('Skeleton', `<div class="row-label">Skeleton</div>${skeletonCells}`)}
  <div style="height:10px"></div>
  ${stateGrid('Empty', `<div class="row-label">Empty</div>${emptyCells}`)}
  <div style="height:10px"></div>
  ${stateGrid('Toast', `<div class="row-label">Toast</div>${toastCells}`)}
  <div class="state-grid" style="margin-top:6px"><div class="row-label">语义</div>${toastTones}</div>
</div>
<div class="card" style="margin-top:10px">
  <div class="row-label" style="margin-bottom:6px">Empty 的变体（不是状态）</div>
  <div class="variant-grid">${emptyVariants}</div>
</div>
<p class="tiny">“—”/N/A 表示该组件没有这一档；缺档本身就是问题（见 <a href="#issues">DS-023</a>），不要用假状态补。</p>`

const renderPageFragment = () => `<div class="fragment">
  <div class="appbar"><span class="lights"><i></i><i></i><i></i></span><span>osw · 控制台</span><span style="margin-left:auto">⌘K</span></div>
  <div class="app">
    <div class="side">
      <div class="item active"><span class="dot"></span>概览</div>
      <div class="item"><span class="dot"></span>模型管理</div>
      <div class="item"><span class="dot"></span>路由规则</div>
      <div class="item"><span class="dot"></span>请求日志</div>
      <div class="item"><span class="dot"></span>设置</div>
      <div class="tiny" style="margin:14px 8px 0">侧栏 14rem / 收起 3rem</div>
    </div>
    <div class="main">
      <div class="page-head">
        <div><h4>请求日志</h4><div class="tiny">最近 24 小时 · 全部提供商</div></div>
        <div class="actions"><span class="btn secondary" style="height:26px;font-size:11px">导出</span><span class="btn" style="height:26px;font-size:11px">刷新</span></div>
      </div>
      <div class="page-body">
        <div class="kpis">
          <div class="kpi"><div class="k">请求数</div><div class="v">12,840</div><div class="tiny ratio-pass">+8.2%</div></div>
          <div class="kpi"><div class="k">成功率</div><div class="v">99.2%</div><div class="tiny ratio-pass">+0.4%</div></div>
          <div class="kpi"><div class="k">P95 延迟</div><div class="v">1.42s</div><div class="tiny ratio-fail">+120ms</div></div>
        </div>
        <div class="table-wrap">
          <table class="spec-table">
            <thead><tr><th>时间</th><th>模型</th><th>状态</th><th>耗时</th></tr></thead>
            <tbody>
              <tr><td>14:32:08</td><td><code>gpt-4o-mini</code></td><td><span class="chip-badge success">200</span></td><td>0.82s</td></tr>
              <tr><td>14:31:55</td><td><code>claude-sonnet-4</code></td><td><span class="chip-badge warning">429</span></td><td>0.10s</td></tr>
              <tr><td>14:31:41</td><td><code>deepseek-chat</code></td><td><span class="chip-badge success">200</span></td><td>1.24s</td></tr>
            </tbody>
          </table>
        </div>
        <div class="mini-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px">新建路由规则</div>
          <div class="field" data-state="default" style="margin-bottom:6px"><span class="placeholder">规则名称</span></div>
          <div class="field" data-state="focus"><span>gpt-4o-mini → claude-sonnet-4</span></div>
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><span class="btn secondary" style="height:26px;font-size:11px">取消</span><span class="btn" style="height:26px;font-size:11px">保存</span></div>
        </div>
      </div>
    </div>
  </div>
</div>`

const renderIssues = data => {
  const order = ['P0', 'P1', 'P2', 'P3']
  const labels = {
    P0: 'P0 · 用户现在就可能读不到/点不到',
    P1: 'P1 · 系统一致性/可访问性缺口',
    P2: 'P2 · 可维护性与漂移',
    P3: 'P3 · 文档与命名',
  }
  return order
    .map(severity => {
      const list = data.issues.filter(item => item.severity === severity)
      if (!list.length) return ''
      const rows = list.map(item => `<tr>
<td class="nowrap"><span class="badge ${severity.toLowerCase()}">${severity}</span><br><span class="token-name">${item.id}</span></td>
<td class="title">${esc(item.title)}<div class="tiny">${esc(item.category)}</div></td>
<td class="evidence">${esc(item.evidence)}</td>
<td class="impact">${esc(item.impact)}</td>
<td class="fix">${esc(item.fix)}</td>
</tr>`).join('')
      return `<h3 id="issues-${severity}">${labels[severity]} <span class="muted tiny">${list.length}</span></h3>
<div class="table-wrap"><table class="issue-table"><thead><tr><th>级别 / ID</th><th>问题</th><th>证据（文件:行）</th><th>影响</th><th>建议修法</th></tr></thead><tbody>${rows}</tbody></table></div>`
    })
    .join('\n')
}

const renderTokenTable = data => {
  const rows = data.colors.light
    .map((item, index) => {
      const dark = data.colors.dark[index]
      const group = groupLabels[item.group] ?? item.group
      return `<tr data-search="${esc([item.name, item.hex, dark.hex, group].join(' ').toLowerCase())}">
<td class="token-name">${esc(item.name)}</td>
<td class="mono">${esc(hexLabel(item))}</td>
<td class="mono">${esc(hexLabel(dark))}</td>
<td>${esc(group)}</td>
<td class="num">${item.line ?? '—'}</td>
</tr>`
    })
    .join('')
  return `<div class="table-wrap"><table id="token-table"><thead><tr><th>Token</th><th>亮色</th><th>暗色</th><th>分组</th><th class="num">行</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

const renderNonColorTable = data => {
  const rows = [
    ...data.typography.map(item => ({ name: item.name, kind: '排版', value: `${item.fontSize}/${item.lineHeight} · ${item.fontWeight}${item.uppercase ? ' · uppercase' : ''}`, line: item.line })),
    ...data.radii.map(item => ({ name: item.name, kind: '圆角', value: item.px === null ? '—' : `${Number(item.px.toFixed(2))}px`, line: item.line })),
    ...data.shadows.map(item => ({ name: item.name, kind: '阴影', value: '见 §6', line: item.line })),
  ]
  return `<div class="table-wrap"><table><thead><tr><th>Token / utility</th><th>类型</th><th>值</th><th class="num">行</th></tr></thead><tbody>${rows.map(row => `<tr><td class="token-name">${esc(row.name)}</td><td>${row.kind}</td><td class="mono">${esc(row.value)}</td><td class="num">${row.line ?? '—'}</td></tr>`).join('')}</tbody></table></div>`
}

const renderBody = data => {
  const { samples, table: typeTable } = renderType(data)
  const { shadowCards, zRows, layers } = renderLayers(data)
  const failed = data.contrast.filter(pair => pair.light.pass === false || pair.dark.pass === false).length
  const p0 = data.issues.filter(item => item.severity === 'P0').length

  return `<section class="chapter" id="overview">
  <div class="chapter-head"><span class="num">01</span><h2>结论先行</h2></div>
  <p class="lede">这不是一次重设计。它把当前代码里真实生效的 token、组件状态与页面骨架抽出来，让矛盾、缺档和死 token 在同一张页面上显形。数值全部来自 <code>styles/index.css</code> 与 40 个组件文件，重新生成即可复核。</p>
  <div class="grid three">
    <div class="card"><div class="tiny">颜色 token</div><div style="font-size:26px;font-weight:600;margin:4px 0">${data.meta.counts.colorTokens}</div><div class="tiny">${data.meta.counts.primitives} 个原始通道 · ${data.meta.counts.contrastPairs} 组实测对比</div></div>
    <div class="card"><div class="tiny">问题</div><div style="font-size:26px;font-weight:600;margin:4px 0">${data.issues.length}</div><div class="tiny"><span class="ratio-fail">${p0} 个 P0</span> · ${failed} 组对比度未达标</div></div>
    <div class="card"><div class="tiny">死 token / 未声明引用</div><div style="font-size:26px;font-weight:600;margin:4px 0">${data.inventory.unreferenced.length} / ${data.inventory.undeclaredRefs.length}</div><div class="tiny">白名单 ${data.inventory.whitelist.length} 项（动态拼接）</div></div>
  </div>
  <div class="card" style="margin-top:12px">
    <strong>怎么读</strong>
    <div class="tiny" style="margin-top:4px">色块：悬停显示详情，点击复制 <code>var(--token)</code>。✅ 达到阈值，❌ 未达标，— 装饰/禁用或没有配对。正文阈值 4.5:1，控件与非文字 3:1。暗色值由同一批 token 在 <code>.dark</code> 下的覆盖解析而来。</div>
  </div>
</section>

<section class="chapter" id="colors">
  <div class="chapter-head"><span class="num">02</span><h2>颜色</h2></div>
  <p class="lede">按语义分组。每个色块下方是解析后的色值与“对卡片”的实测对比度；完整配对见对比度矩阵。带棋盘格的是半透明色。</p>
  <div id="swatch-detail" role="status" aria-live="polite"><span class="muted">悬停或点击任意色块查看 token、色值与对比度。</span></div>
  ${renderSwatches(data)}
  <h3 id="contrast">对比度矩阵</h3>
  <p class="tiny">半透明前景先与背景合成；半透明背景先与它承载的卡片/页面底合成。禁用态与装饰性配对不参与 WCAG 门槛。</p>
  ${renderContrast(data)}
</section>

<section class="chapter" id="type">
  <div class="chapter-head"><span class="num">03</span><h2>字体</h2></div>
  <p class="lede">字号阶梯用真实 <code>system-*</code> utility 的值渲染。11px 是下限；13px 是正文主档。</p>
  <div class="card">${samples}</div>
  <h3>family</h3>
  <div class="table-wrap"><table><thead><tr><th>Token</th><th>值</th><th class="num">行</th></tr></thead><tbody>${data.fonts.map(item => `<tr><td class="token-name">${esc(item.name)}</td><td><code>${esc(item.value)}</code></td><td class="num">${item.line}</td></tr>`).join('')}</tbody></table></div>
  <h3>全部排版 utility <span class="muted tiny">${data.typography.length}</span></h3>
  <div class="table-wrap"><table><thead><tr><th>Utility</th><th class="num">字号</th><th class="num">行高</th><th class="num">字重</th><th>大写</th><th class="num">引用</th><th class="num">行</th></tr></thead><tbody>${typeTable}</tbody></table></div>
</section>

<section class="chapter" id="spacing">
  <div class="chapter-head"><span class="num">04</span><h2>间距</h2></div>
  <p class="lede">Tailwind 步长 × 4px。绿色落在 4px 网格，橙色是 2px 半档；半档不是错，但目前没有登记为 hairline 例外。</p>
  <div class="legend"><span><i style="background:var(--ds-accent)"></i>4px 网格</span><span><i style="background:var(--ds-warning)"></i>2px 半档</span><span>条形按像素等比</span></div>
  <div class="card">${renderSpacing(data)}</div>
</section>

<section class="chapter" id="shape">
  <div class="chapter-head"><span class="num">05</span><h2>圆角与阴影</h2></div>
  <p class="lede">圆角刻度由 <code>--radius</code> 派生；2xl/3xl/4xl 是非整数。阴影只有卡片两档，其余浮层用 0.5px 边 + 毛玻璃。</p>
  <h3>圆角</h3>
  <div class="grid shape-grid">${renderRadii(data)}</div>
  <h3 id="layers">阴影与层级</h3>
  <div class="grid two">${shadowCards}</div>
  <p class="tiny">其余浮层（Select / Dropdown / Popover）使用 <code>shadow-none</code> + 0.5px 边 + 毛玻璃，没有阴影 token。</p>
  <h3>z-index</h3>
  <p class="tiny">数字越大越靠上：z-70 收据控件 > z-50 浮层 > z-30 侧栏 > z-20 页头 > z-10 粘性表头 > z-0 基础。</p>
  <div class="z-stack" aria-label="z-index 分层">
    ${layers}
  </div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>z 值</th><th class="num">次数</th><th>出现处</th></tr></thead><tbody>${zRows}</tbody></table></div>
</section>

<section class="chapter" id="components">
  <div class="chapter-head"><span class="num">09</span><h2>组件六态</h2></div>
  <p class="lede">每个构件同屏列出 default / hover / active / focus / disabled / loading。没有实现的档位标 N/A，不用假状态补——缺档要回到问题清单。</p>
  ${renderComponents(data)}
</section>

<section class="chapter" id="page">
  <div class="chapter-head"><span class="num">10</span><h2>真实页面片段</h2></div>
  <p class="lede">用抽出的外壳、页头、表格与表单结构拼成的一屏。尺寸沿用布局证据（侧栏 14rem、页头 sticky、表格 36px 行高），颜色只引用 token。</p>
  ${renderPageFragment()}
</section>

<section class="chapter" id="issues">
  <div class="chapter-head"><span class="num">11</span><h2>问题清单</h2></div>
  <p class="lede">按严重程度分组。每条给出文件:行、影响与修法；对比度数值由脚本实时计算，改代码后重新生成会变。</p>
  ${renderIssues(data)}
  <h3 id="inventory">token 引用完整性</h3>
  <div class="grid two">
    <div class="card">
      <strong>已声明、零引用（${data.inventory.unreferenced.length}）</strong>
      <ul class="tiny" style="margin:8px 0 0;padding-left:18px;max-height:240px;overflow:auto">
        ${data.inventory.unreferenced.map(name => `<li><code>${esc(name)}</code></li>`).join('')}
      </ul>
    </div>
    <div class="card">
      <strong>动态引用白名单（${data.inventory.whitelist.length}）</strong>
      <ul class="tiny" style="margin:8px 0 0;padding-left:18px;max-height:240px;overflow:auto">
        ${data.inventory.whitelist.map(item => `<li><code>${esc(item.name)}</code> — ${esc(item.reason)}</li>`).join('')}
      </ul>
      <div class="tiny" style="margin-top:8px">未声明却被 <code>var()</code> 引用：${data.inventory.undeclaredRefs.length ? data.inventory.undeclaredRefs.map(item => `<code>${esc(item.name)}</code>`).join('、') : '无'}</div>
    </div>
  </div>
</section>

<section class="chapter" id="tokens">
  <div class="chapter-head"><span class="num">12</span><h2>Token 总表</h2></div>
  <p class="lede">全部颜色 token，支持按名称、色值或分组过滤。</p>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
    <input class="search" id="token-search" type="search" placeholder="搜索 token / 色值 / 分组…" aria-label="搜索 token">
    <span class="tiny nowrap" id="token-count">${data.colors.light.length} / ${data.colors.light.length}</span>
  </div>
  ${renderTokenTable(data)}
  <h3>非颜色 token</h3>
  ${renderNonColorTable(data)}
  <p class="tiny" style="margin-top:16px">生成命令：<code>node scripts/design-system/extract-tokens.mjs</code> · 源：<code>${esc(data.meta.source)}</code> · SHA-256 <code>${data.meta.sourceSha256.slice(0, 16)}</code></p>
</section>`
}

const varBlock = (data, mode) => data.colors[mode]
  .map(item => `  --ds-${item.name.replace(/^--/, '')}: ${item.hex ?? 'transparent'};`)
  .join('\n')

const shadowValue = (data, name, mode) => {
  const shadow = data.shadows.find(item => item.name === name)
  if (!shadow) return 'none'
  const value = mode === 'dark' ? shadow.dark : shadow.light
  return value ? value.replace(/\s*\n\s*/g, ' ') : 'none'
}


/** 组件规格行：数字来自 specs.mjs 对 class 串的解析，行尾给出来源文件与行号。 */
const specLine = (data, id) => {
  const component = data.components.find(item => item.id === id)
  if (!component) return ''
  const values = Object.fromEntries(component.specs.map(item => [item.key, item.value]))
  const parts = []
  if (values.height !== undefined) parts.push(`高 ${values.height}`)
  if (values.padding !== undefined) parts.push(`内边距 ${values.padding}`)
  if (values.paddingX !== undefined) parts.push(`水平 ${values.paddingX}`)
  if (values.paddingY !== undefined) parts.push(`垂直 ${values.paddingY}`)
  if (values.gap !== undefined) parts.push(`间距 ${values.gap}`)
  if (values.radius !== undefined) parts.push(`圆角 ${values.radius}`)
  if (values.fontSize !== undefined) parts.push(`字号 ${values.fontSize}/${values.lineHeight ?? '—'}`)
  if (values.borderWidth !== undefined) parts.push(`描边 ${values.borderWidth}`)
  const lines = component.anchors.map(anchor => anchor.line).join(',')
  return `<p class="spec">规格 ${parts.join(' · ')}<span class="spec-src">${esc(component.file)}:${lines}</span></p>`
}

const radiusValue = (data, name) => {
  const radius = data.radii.find(item => item.name === name)
  return radius && radius.px !== null ? `${Number(radius.px.toFixed(2))}px` : '0px'
}

export const renderPage = data => {
  // 模板统一按 LF 读入，否则 Windows 工作区（CRLF checkout）会产出与 CI 不同的字节。
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n')
  const body = renderBody(data)
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const failed = data.contrast.filter(pair => pair.light.pass === false || pair.dark.pass === false).length

  const replacements = {
    __DS_LIGHT_VARS__: varBlock(data, 'light'),
    __DS_DARK_VARS__: varBlock(data, 'dark'),
    __DS_RADIUS_SM__: radiusValue(data, '--radius-sm'),
    __DS_RADIUS_MD__: radiusValue(data, '--radius-md'),
    __DS_RADIUS_LG__: radiusValue(data, '--radius-lg'),
    __DS_RADIUS_XL__: radiusValue(data, '--radius-xl'),
    __DS_SHADOW_LIGHT__: shadowValue(data, '--shadow-card', 'light'),
    __DS_SHADOW_DARK__: shadowValue(data, '--shadow-card', 'dark'),
    __DS_SHADOW_HOVER_LIGHT__: shadowValue(data, '--shadow-card-hover', 'light'),
    __DS_SHADOW_HOVER_DARK__: shadowValue(data, '--shadow-card-hover', 'dark'),
    __DS_HERO_STAT__: `${data.meta.counts.colorTokens} 色 · ${data.issues.length} 问题 · ${failed} 组对比度未达标`,
    __DS_COLOR_COUNT__: String(data.meta.counts.colorTokens),
    __DS_SPACING_COUNT__: String(data.spacing.steps.length),
    __DS_TYPE_COUNT__: String(data.typography.length),
    __DS_ISSUE_COUNT__: String(data.issues.length),
    __DS_JSON__: json,
    __DS_BODY__: body,
  }
  return Object.entries(replacements).reduce((output, [key, value]) => output.split(key).join(value), template)
}
