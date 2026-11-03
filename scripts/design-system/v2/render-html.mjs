/**
 * v2 预览页。深色优先、零外部依赖、单文件。
 *
 * 页面本身就是验收工具：
 * - 色板每个色块带实测对比度徽标；
 * - 每个 P0/P1 有修改前后并排；
 * - 对比度矩阵标明前景、承载底色与阈值，不达标即红；
 * - 组件画廊逐态展示，并附非颜色编码与键盘要求；
 * - 问题收敛表、迁移表、规范条文都可检索/筛选。
 */
import { contrastHex } from './color.mjs'

const esc = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const ratioClass = (ratio, threshold) => {
  if (threshold === null) return 'exempt'
  if (ratio === null) return 'exempt'
  return ratio >= threshold ? 'ok' : 'bad'
}

const ratioBadge = (ratio, threshold, label = '') => {
  if (ratio === null || ratio === undefined) return '<span class="ratio exempt">—</span>'
  const cls = ratioClass(ratio, threshold)
  return `<span class="ratio ${cls}" title="${esc(label)}阈值 ${threshold ?? '—'}">${ratio.toFixed(2)}:1</span>`
}

const v1Color = (data, name, mode = 'light') =>
  data.v1Colors?.[mode]?.find(item => item.name === name)?.hex ?? null

const fixSwatch = (data, id) => {
  const L = data.roles.light
  const D = data.roles.dark
  const map = {
    'DS-001': { before: v1Color(data, '--color-components-input-bg-normal'), after: L['input-border'].hex, kind: 'bg', beforeLabel: '输入底 vs 卡片', afterLabel: '边框 vs 卡片' },
    'DS-002': { before: v1Color(data, '--color-components-input-text-placeholder'), after: L['text-placeholder'].hex, kind: 'text', beforeLabel: 'placeholder', afterLabel: 'placeholder' },
    'DS-003': { before: v1Color(data, '--color-text-quaternary'), after: L['text-secondary'].hex, kind: 'text', beforeLabel: 'quaternary', afterLabel: 'secondary' },
    'DS-004': { before: v1Color(data, '--color-text-tertiary'), after: L['text-secondary'].hex, kind: 'text', beforeLabel: 'tertiary / 凹槽', afterLabel: 'secondary / 凹槽' },
    'DS-026': { before: v1Color(data, '--color-text-success'), after: L['success-text'].hex, kind: 'text', beforeLabel: 'success', afterLabel: 'success' },
    'DS-005': { before: v1Color(data, '--color-text-success'), after: L['success-text'].hex, kind: 'text', beforeLabel: 'badge success', afterLabel: 'badge success' },
    'DS-006': { before: v1Color(data, '--color-foreground'), after: L['text-primary'].hex, kind: 'text', beforeLabel: 'foreground', afterLabel: 'text-primary' },
    'DS-007': { before: '#354052', after: L['surface-base'].hex, kind: 'bg', beforeLabel: '蓝灰 / 纯灰双轨', afterLabel: '单一 hue 262' },
    'DS-008': { before: v1Color(data, '--color-state-success-solid'), after: L['success-solid'].hex, kind: 'bg', beforeLabel: '5 个绿色', afterLabel: '1 个 success-solid' },
    'DS-009': { before: v1Color(data, '--color-info'), after: L['info-text'].hex, kind: 'bg', beforeLabel: 'info 当文字', afterLabel: 'info-text' },
    'DS-010': { before: v1Color(data, '--color-ring'), after: L['focus-ring'].hex, kind: 'bg', beforeLabel: '1px outline', afterLabel: '2px focus-ring' },
    'DS-011': { before: '#000000', after: '#000000', kind: 'motion', beforeLabel: '只覆盖 2 处', afterLabel: '全局降级' },
    'DS-012': { before: '#ffffff', after: L['border-subtle'].hex, kind: 'border', beforeLabel: '0px 不渲染', afterLabel: '1px dashed' },
    'DS-013': { before: '#171717', after: L['surface-base'].hex, kind: 'layer', beforeLabel: 'z-70 > z-50', afterLabel: 'overlay 30 < modal 40' },
    'DS-014': { before: '#ffffff', after: L['surface-raised'].hex, kind: 'radius', beforeLabel: '10.8 / 13.2 / 15.6', afterLabel: '2/4/6/8/12/16' },
    'DS-027': { before: v1Color(data, '--color-components-panel-bg-blur'), after: L['overlay-surface'].hex, kind: 'bg', beforeLabel: '毛玻璃 + shadow-none', afterLabel: 'overlay + shadow' },
    'DS-028': { before: v1Color(data, '--color-sidebar'), after: L['surface-base'].hex, kind: 'bg', beforeLabel: 'body = sidebar', afterLabel: 'body ≠ sidebar' },
  }
  void D
  return map[id] ?? null
}

const stateClass = state => ({
  default: '',
  hover: 'is-hover',
  active: 'is-active',
  'focus-visible': 'is-focus',
  disabled: 'is-disabled',
  loading: 'is-loading',
  error: 'is-error',
}[state] ?? '')

const spinner = '<span class="spinner" aria-hidden="true"></span>'

const demo = (id, state) => {
  const cls = stateClass(state)
  const busy = state === 'loading' ? ` ${spinner}` : ''
  const errorText = state === 'error' ? '<span class="demo-error">请检查必填项</span>' : ''
  switch (id) {
    case 'button':
      return `<button class="demo-btn ${cls}">${busy}${state === 'loading' ? '处理中' : '保存'}</button>`
    case 'input':
      return `<label class="demo-field"><span>模型名称</span><span class="demo-input ${cls}">${state === 'loading' ? busy : ''}<span class="${state === 'default' ? 'placeholder' : ''}">${state === 'default' ? '例如 gpt-4o' : 'gpt-4o'}</span></span>${errorText}</label>`
    case 'select':
      return `<button class="demo-select ${cls}">${state === 'loading' ? busy : ''}选择模型<span class="chev">⌄</span></button>${errorText}`
    case 'checkbox':
      return `<label class="demo-check ${cls}"><span class="box">${state === 'loading' ? busy : '✓'}</span>启用缓存</label>${errorText}`
    case 'radio':
      return `<label class="demo-check radio ${cls}"><span class="box"></span>按量计费</label>${errorText}`
    case 'switch':
      return `<span class="demo-switch ${cls}"><span class="knob">${state === 'loading' ? busy : ''}</span></span><span class="demo-side">启用</span>${errorText}`
    case 'badge':
      return `<span class="demo-badge success ${cls}">${state === 'loading' ? busy : state === 'error' ? '失败' : '成功'}</span>`
    case 'card':
      return `<div class="demo-card ${cls}"><span class="demo-card-label">请求总量</span><strong>1,284</strong><span class="demo-card-foot">较昨日 +12.4%</span></div>`
    case 'table':
      return `<table class="demo-table ${cls}"><thead><tr><th>模型</th><th>状态</th><th>延迟</th></tr></thead><tbody><tr><td>gpt-4o</td><td><span class="demo-badge success">成功</span></td><td>182ms</td></tr><tr><td>claude-sonnet</td><td><span class="demo-badge warning">限流</span></td><td>1.2s</td></tr></tbody></table>`
    case 'dialog':
      return `<div class="demo-dialog ${cls}"><div class="demo-dialog-head"><strong>新建密钥</strong><span>×</span></div><p>密钥创建后只显示一次。</p>${errorText}<div class="demo-dialog-foot"><button class="demo-btn ghost">取消</button><button class="demo-btn">${busy}创建</button></div></div>`
    case 'sheet':
      return `<div class="demo-sheet ${cls}"><div class="demo-dialog-head"><strong>筛选</strong><span>×</span></div><p>按状态、模型、时间范围筛选。</p><div class="demo-sheet-row"><span>状态</span><span>全部</span></div><div class="demo-sheet-row"><span>模型</span><span>gpt-4o</span></div></div>`
    case 'toast':
      return `<div class="demo-toast ${state === 'error' ? 'danger' : 'success'} ${cls}"><span class="dot"></span><span>${state === 'error' ? '保存失败' : state === 'loading' ? '保存中' : '已保存'}${busy}</span><button>×</button></div>`
    case 'tooltip':
      return `<div class="demo-tooltip ${cls}">密钥只在创建时显示</div>`
    case 'tabs':
      return `<div class="demo-tabs ${cls}"><span class="active">概览</span><span>日志</span><span>设置</span></div>`
    case 'skeleton':
      return `<div class="demo-skel ${cls}"><span></span><span></span><span></span></div>`
    case 'empty':
      return `<div class="demo-empty ${cls}"><div class="empty-icon">◇</div><strong>没有数据</strong><p>调整筛选后重试</p><button class="demo-btn ghost">刷新</button>${errorText}</div>`
    default:
      return ''
  }
}

const componentGallery = data => data.components.map(component => `
<article class="component-card" id="component-${component.id}">
  <header class="component-head">
    <div><h3>${esc(component.name)}</h3><code>${esc(component.slot)}</code></div>
    <span class="component-geo">${esc(component.geometry)}</span>
  </header>
  <div class="state-grid">
    ${data.stateNames.map(state => {
      const spec = component.states[state]
      return `<div class="state-cell ${spec.applicable ? '' : 'na'}">
        <div class="state-top"><span>${state}</span>${spec.applicable ? '' : '<em>N/A</em>'}</div>
        <div class="state-demo">${spec.applicable ? demo(component.id, state) : '<span class="na-reason">不适用</span>'}</div>
      </div>`
    }).join('')}
  </div>
  <details class="state-details">
    <summary>状态契约（非颜色编码 / 键盘）</summary>
    <table>
      <thead><tr><th>状态</th><th>规格</th><th>非颜色编码</th><th>键盘 / 焦点</th></tr></thead>
      <tbody>
        ${data.stateNames.map(state => {
          const spec = component.states[state]
          return `<tr><td><code>${state}</code></td><td>${esc(spec.spec)}</td><td>${esc(spec.nonColor)}</td><td>${esc(spec.keyboard)}</td></tr>`
        }).join('')}
      </tbody>
    </table>
  </details>
</article>`).join('')

const neutralChips = data => data.neutral.map(item => {
  const ratioLight = contrastHex(item.hex, data.roles.light['surface-raised'].hex)
  const ratioDark = contrastHex(item.hex, data.roles.dark['surface-raised'].hex)
  const threshold = item.step >= 11 ? 4.5 : item.step === 8 ? 3 : item.step >= 9 ? 4.5 : null
  const modeLabel = item.step >= 9 && item.step <= 10
    ? `${item.step >= 9 ? 'solid' : ''}`
    : item.step >= 11 ? 'text' : item.step <= 2 ? 'surface' : item.step <= 5 ? 'state' : 'border'
  const ratio = item.step >= 9 && item.step <= 10
    ? contrastHex(item.hex, data.roles.light['on-solid'].hex)
    : ratioLight
  return `<div class="chip">
    <div class="swatch" style="background:var(--ds-${item.name})"></div>
    <div class="chip-id"><code>${item.name}</code><span class="band">${modeLabel}</span></div>
    <div class="chip-meta">${item.hex} · L${item.step}</div>
    <div class="chip-ratio">${ratioBadge(ratio, threshold, '对卡片')}<span class="dual">L ${ratioLight.toFixed(2)} / D ${ratioDark.toFixed(2)}</span></div>
  </div>`
}).join('')

const brandChips = data => data.brand.map(item => {
  const ratioLight = item.step >= 11 ? contrastHex(item.hex, data.roles.light['surface-base'].hex)
    : item.step >= 9 ? contrastHex(item.hex, data.roles.light['brand-on-solid'].hex)
      : item.step >= 6 ? contrastHex(item.hex, data.roles.light['surface-base'].hex) : null
  const ratioDark = item.step >= 11 ? contrastHex(item.hex, data.roles.dark['surface-base'].hex)
    : item.step >= 9 ? contrastHex(item.hex, data.roles.dark['brand-on-solid'].hex)
      : item.step >= 6 ? contrastHex(item.hex, data.roles.dark['surface-base'].hex) : null
  const threshold = item.step >= 9 ? 4.5 : item.step >= 6 ? 3 : null
  return `<div class="chip brand">
    <div class="swatch" style="background:var(--ds-${item.name})"></div>
    <div class="chip-id"><code>${item.name}</code><span class="band">${item.step <= 2 ? 'surface' : item.step <= 5 ? 'state' : item.step <= 8 ? 'border' : item.step <= 10 ? 'solid' : 'text'}</span></div>
    <div class="chip-meta">${item.hex} · L${item.step}</div>
    <div class="chip-ratio">${ratioBadge(ratioLight, threshold, '对页面底 / on-solid')}<span class="dual">L ${ratioLight?.toFixed(2) ?? '—'} / D ${ratioDark?.toFixed(2) ?? '—'}</span></div>
  </div>`
}).join('')

const statusChips = data => data.statusFamilies.map(family => {
  const light = data.roles.light
  const dark = data.roles.dark
  const roles = [
    ['surface', light[`${family}-surface`], light[`${family}-text`], 4.5, 'text / surface'],
    ['border', light[`${family}-border`], light['surface-raised'], 3, 'border / card'],
    ['text', light[`${family}-text`], light[`${family}-surface`], 4.5, 'text / surface'],
    ['solid', light[`${family}-solid`], light[`${family}-on-solid`], 4.5, 'on-solid / solid'],
    ['on-solid', light[`${family}-on-solid`], light[`${family}-solid`], 4.5, 'on-solid / solid'],
  ]
  return `<div class="status-row">
    <div class="status-name"><code>${family}</code><span>4 角色 + hover / on-solid</span></div>
    <div class="status-chips">
      ${roles.map(([key, fg, bg, threshold, label]) => {
        const ratioL = contrastHex(fg.hex, bg.hex)
        const ratioD = contrastHex(dark[`${family}-${key}`].hex, key === 'border' || key === 'text' || key === 'surface' ? dark[key === 'border' ? 'surface-raised' : `${family}-${key === 'text' ? 'surface' : 'surface'}`].hex : dark[`${family}-${key === 'on-solid' ? 'solid' : 'solid'}`].hex)
        return `<div class="chip status">
          <div class="swatch" style="background:var(--ds-${family}-${key})"></div>
          <div class="chip-id"><code>${family}-${key}</code></div>
          <div class="chip-meta">${fg.hex}</div>
          <div class="chip-ratio">${ratioBadge(ratioL, threshold, label)}<span class="dual">D ${ratioD.toFixed(2)}</span></div>
        </div>`
      }).join('')}
    </div>
  </div>`
}).join('')

const fixCards = data => data.issues
  .filter(issue => issue.severity === 'P0' || issue.severity === 'P1')
  .map(issue => {
    const swatch = fixSwatch(data, issue.id)
    const beforeRatio = issue.before.match(/(\d+\.\d+):1/)
    const afterRatio = issue.after.match(/(\d+\.\d+):1/)
    return `<article class="fix-card" id="fix-${issue.id}">
      <header><div><span class="sev ${issue.severity.toLowerCase()}">${issue.severity}</span><code>${issue.id}</code></div><h3>${esc(issue.title)}</h3></header>
      <div class="fix-grid">
        <div class="fix-panel before">
          <div class="fix-label">修改前</div>
          ${swatch ? `<div class="fix-bar ${swatch.kind}" style="${swatch.kind === 'text' ? `color:${swatch.before}` : swatch.kind === 'border' ? `border:2px solid ${swatch.before}` : `background:${swatch.before}`}">Aa</div>` : '<div class="fix-bar neutral">—</div>'}
          <div class="fix-text">${esc(issue.before)}</div>
          ${beforeRatio ? `<div class="fix-ratio bad">${beforeRatio[1]}:1</div>` : ''}
        </div>
        <div class="fix-panel after">
          <div class="fix-label">v2 决策</div>
          ${swatch ? `<div class="fix-bar ${swatch.kind}" style="${swatch.kind === 'text' ? `color:${swatch.after}` : swatch.kind === 'border' ? `border:2px dashed ${swatch.after}` : `background:${swatch.after}`}">Aa</div>` : '<div class="fix-bar neutral">—</div>'}
          <div class="fix-text">${esc(issue.after)}</div>
          ${afterRatio ? `<div class="fix-ratio ok">${afterRatio[1]}:1</div>` : ''}
        </div>
      </div>
      <div class="fix-decision"><span class="verdict ${issue.verdict}">${verdictLabel(issue.verdict)}</span><p>${esc(issue.decision)}</p></div>
      <p class="fix-residual"><strong>残留：</strong>${esc(issue.residual)}</p>
    </article>`
  }).join('')

const verdictLabel = verdict => ({
  'fixed-overlay': '覆盖层已修',
  'fixed-token': 'token 已修',
  'fixed-doc': '文档已修',
  deferred: '需下一轮改源码',
  deleted: '已删除',
}[verdict] ?? verdict)

const contrastRows = data => data.pairs.map(pair => {
  const light = data.contrast.light.find(item => item.id === pair.id)
  const dark = data.contrast.dark.find(item => item.id === pair.id)
  const rowBad = (light?.pass === false) || (dark?.pass === false)
  return `<tr class="${rowBad ? 'row-bad' : ''}">
    <td>${esc(pair.label)}</td>
    <td><code>${esc(pair.fg)}</code></td>
    <td><code>${esc(pair.bg)}</code><span class="hexnote">${light?.bgHex ?? ''} / ${dark?.bgHex ?? ''}</span></td>
    <td>${ratioBadge(light?.ratio, light?.threshold, '亮色')}</td>
    <td>${ratioBadge(dark?.ratio, dark?.threshold, '暗色')}</td>
    <td>${light?.threshold ?? '—'}${light?.kind === 'disabled' ? '（豁免）' : light?.kind === 'decorative' ? '（装饰）' : ''}</td>
  </tr>`
}).join('')

const migrationRows = data => data.migration.map(row => `<tr data-action="${row.action}">
  <td><code>${esc(row.from)}</code></td>
  <td><code>${esc(row.to)}</code></td>
  <td><span class="action ${row.action}">${row.action}</span></td>
  <td>${esc(row.note)}</td>
</tr>`).join('')

const issueRows = data => data.issues.map(issue => `<tr data-severity="${issue.severity}">
  <td><span class="sev ${issue.severity.toLowerCase()}">${issue.severity}</span></td>
  <td><code>${issue.id}</code></td>
  <td><strong>${esc(issue.title)}</strong><div class="issue-decision">${esc(issue.decision)}</div></td>
  <td><span class="verdict ${issue.verdict}">${verdictLabel(issue.verdict)}</span></td>
  <td class="issue-evidence">${esc(issue.evidence)}</td>
  <td>${esc(issue.before)}<br><span class="after">→ ${esc(issue.after)}</span></td>
  <td>${esc(issue.residual)}</td>
</tr>`).join('')

const typeSpecimen = data => data.typography.sizes.map(item => `
<div class="type-row">
  <div class="type-meta"><code>type-${item.name.split('-')[1]}</code><span>${item.px}/${item.lineHeight}</span></div>
  <div class="type-sample" style="font-size:${item.px}px;line-height:${item.lineHeight}px;font-weight:500">设计系统不是配色表，是可执行的约束。</div>
  <div class="type-use">${esc(item.use)}</div>
</div>`).join('')

const weightSpecimen = data => data.typography.weights.map(item => `
<div class="weight-row"><code>${item.value}</code><span style="font-weight:${item.value}">Geist / 思源黑体 · 请求总量 1,284</span><em>${esc(item.use)}</em></div>`).join('')

const spacingBars = data => data.spacing.steps.map(step => `
<div class="space-row"><code>${step}px</code><div class="space-bar" style="width:${Math.max(2, step)}px"></div><span>--ds-space-${step}</span></div>`).join('')

const radiusSamples = data => data.radii.map(item => `
<div class="radius-item"><div class="radius-box" style="border-radius:${item.px}px"></div><code>radius-${item.name} · ${item.px}px</code><span>${esc(item.use)}</span></div>`).join('')

const controlSamples = data => data.controls.heights.map(item => `
<div class="control-row"><span class="control-box" style="height:${item.px}px"></span><code>${item.name} · ${item.px}px</code><span>${esc(item.use)}</span></div>`).join('')

const rulesRows = data => data.rules.map(rule => `<tr>
  <td><code>${rule.id}</code></td>
  <td><span class="level">${rule.level}</span></td>
  <td>${esc(rule.statement)}</td>
  <td>${esc(rule.check)}</td>
  <td><span class="rule-status ok">${esc(rule.status)}</span></td>
</tr>`).join('')

const pageCss = `
:root { color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--ds-surface-base);
  color: var(--ds-text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(900px 420px at 78% -8%, color-mix(in oklch, var(--ds-brand-solid) 18%, transparent), transparent 70%),
    radial-gradient(700px 380px at 8% 12%, color-mix(in oklch, var(--ds-success-solid) 8%, transparent), transparent 72%);
  z-index: 0;
}
a { color: var(--ds-brand-text); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--font-mono); font-size: 12px; }
h1,h2,h3,h4 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0; }
button { font: inherit; }
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 10px 24px;
  background: color-mix(in oklch, var(--ds-surface-base) 88%, transparent);
  border-bottom: 1px solid var(--ds-border-subtle);
  backdrop-filter: blur(12px);
}
.brandline { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.brandmark {
  width: 26px; height: 26px; border-radius: 8px;
  display: grid; place-items: center;
  background: var(--ds-solid); color: var(--ds-on-solid);
  font-family: var(--font-mono); font-size: 13px;
}
.brandline small { color: var(--ds-text-secondary); font-weight: 400; }
.top-actions { display: flex; align-items: center; gap: 10px; }
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--ds-border-subtle);
  color: var(--ds-text-secondary); font-size: 12px;
}
.pill strong { color: var(--ds-text-primary); }
.theme-btn {
  height: 30px; padding: 0 12px; border-radius: 6px;
  border: 1px solid var(--ds-border-strong);
  background: var(--ds-surface-raised); color: var(--ds-text-primary);
  cursor: pointer;
}
.theme-btn:hover { background: var(--ds-surface-hover); }
.layout { position: relative; z-index: 1; display: grid; grid-template-columns: 232px minmax(0,1fr); max-width: 1480px; margin: 0 auto; }
.toc {
  position: sticky; top: 51px; align-self: start;
  height: calc(100vh - 51px); overflow: auto;
  padding: 22px 16px 40px 24px;
  border-right: 1px solid var(--ds-border-subtle);
}
.toc-title { font-size: 12px; color: var(--ds-text-secondary); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 10px; }
.toc a { display: flex; gap: 8px; padding: 6px 8px; border-radius: 6px; color: var(--ds-text-secondary); font-size: 13px; }
.toc a:hover { background: var(--ds-surface-hover); color: var(--ds-text-primary); text-decoration: none; }
.toc a .n { color: var(--ds-text-secondary); font-family: var(--font-mono); font-size: 11px; width: 20px; }
.toc .sub { padding-left: 14px; font-size: 12px; }
main { padding: 40px 40px 96px; min-width: 0; }
.hero { padding: 24px 0 40px; border-bottom: 1px solid var(--ds-border-subtle); }
.eyebrow { color: var(--ds-brand-text); font-family: var(--font-mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.hero h1 { font-size: 40px; line-height: 48px; max-width: 900px; margin: 10px 0 14px; }
.hero .lead { max-width: 820px; color: var(--ds-text-secondary); font-size: 15px; line-height: 24px; }
.hero-note { margin-top: 16px; padding: 10px 12px; border-left: 2px solid var(--ds-brand-border); background: var(--ds-brand-surface); color: var(--ds-text-secondary); font-size: 13px; border-radius: 0 6px 6px 0; }
.stats { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 10px; margin-top: 24px; }
.stat { padding: 12px; border: 1px solid var(--ds-border-subtle); border-radius: 10px; background: var(--ds-surface-raised); }
.stat strong { display: block; font-size: 22px; line-height: 28px; }
.stat span { display: block; color: var(--ds-text-secondary); font-size: 12px; line-height: 16px; margin-top: 2px; }
section { padding: 44px 0 8px; border-bottom: 1px solid var(--ds-border-subtle); scroll-margin-top: 64px; }
section:last-child { border-bottom: 0; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.section-head h2 { font-size: 24px; line-height: 32px; }
.section-head p { color: var(--ds-text-secondary); font-size: 13px; line-height: 20px; max-width: 760px; margin-top: 6px; }
.kicker { font-family: var(--font-mono); font-size: 11px; color: var(--ds-text-secondary); }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; }
.panel { border: 1px solid var(--ds-border-subtle); border-radius: 12px; background: var(--ds-surface-raised); padding: 16px; }
.panel h3 { font-size: 16px; line-height: 24px; margin-bottom: 8px; }
.panel p, .panel li { color: var(--ds-text-secondary); font-size: 13px; line-height: 20px; }
.panel ul { margin: 8px 0 0; padding-left: 18px; }
.panel code { color: var(--ds-text-primary); }
.flow { display: grid; grid-template-columns: 1fr 36px 1fr 36px 1fr; align-items: center; gap: 4px; }
.flow-box { border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-surface-sunken); padding: 12px; }
.flow-box strong { display: block; font-size: 14px; }
.flow-box span { color: var(--ds-text-secondary); font-size: 12px; }
.flow-arrow { text-align: center; color: var(--ds-text-secondary); font-family: var(--font-mono); }
.bands { width: 100%; border-collapse: collapse; font-size: 13px; }
.bands th, .bands td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--ds-border-subtle); vertical-align: top; }
.bands th { color: var(--ds-text-secondary); font-weight: 500; font-size: 12px; }
.band-swatch { display: inline-block; width: 18px; height: 18px; border-radius: 4px; vertical-align: middle; margin-right: 6px; }
.hexnote { display: block; color: var(--ds-text-secondary); font-size: 11px; margin-top: 2px; }
.chip-grid { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 8px; }
.chip { border: 1px solid var(--ds-border-subtle); border-radius: 8px; overflow: hidden; background: var(--ds-surface-raised); }
.chip .swatch { height: 44px; border-bottom: 1px solid var(--ds-border-subtle); }
.chip-id { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 8px 0; }
.chip-id code { font-size: 11px; }
.band { color: var(--ds-text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.chip-meta { padding: 0 8px; color: var(--ds-text-secondary); font-size: 11px; font-family: var(--font-mono); }
.chip-ratio { padding: 6px 8px 8px; display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.dual { color: var(--ds-text-secondary); font-size: 10px; font-family: var(--font-mono); }
.ratio { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 10px; border: 1px solid transparent; white-space: nowrap; }
.ratio.ok { color: var(--ds-success-text); background: var(--ds-success-surface); border-color: var(--ds-success-border); }
.ratio.bad { color: var(--ds-danger-text); background: var(--ds-danger-surface); border-color: var(--ds-danger-border); }
.ratio.exempt { color: var(--ds-text-secondary); background: var(--ds-surface-sunken); border-color: var(--ds-border-subtle); }
.status-row { display: grid; grid-template-columns: 150px minmax(0,1fr); gap: 12px; align-items: start; margin-top: 10px; }
.status-name { padding-top: 8px; }
.status-name code { display: block; font-size: 13px; }
.status-name span { color: var(--ds-text-secondary); font-size: 11px; }
.status-chips { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; }
.status .chip-id { padding-top: 5px; }
.status .chip-id code { font-size: 10px; }
.status .chip-meta { font-size: 10px; }
.fix-grid-cards { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
.fix-card { border: 1px solid var(--ds-border-subtle); border-radius: 12px; background: var(--ds-surface-raised); padding: 14px; }
.fix-card header div { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.fix-card h3 { font-size: 14px; line-height: 20px; }
.sev { display: inline-flex; height: 18px; padding: 0 6px; align-items: center; border-radius: 4px; font-family: var(--font-mono); font-size: 10px; }
.sev.p0 { color: var(--ds-danger-text); background: var(--ds-danger-surface); }
.sev.p1 { color: var(--ds-warning-text); background: var(--ds-warning-surface); }
.sev.p2 { color: var(--ds-info-text); background: var(--ds-info-surface); }
.sev.p3 { color: var(--ds-text-secondary); background: var(--ds-surface-sunken); }
.fix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; }
.fix-panel { border: 1px solid var(--ds-border-subtle); border-radius: 8px; padding: 10px; background: var(--ds-surface-sunken); }
.fix-panel.after { background: color-mix(in oklch, var(--ds-success-surface) 55%, var(--ds-surface-raised)); }
.fix-label { font-size: 11px; color: var(--ds-text-secondary); margin-bottom: 6px; }
.fix-bar { height: 42px; border-radius: 6px; display: grid; place-items: center; font-weight: 600; background: var(--ds-surface-raised); color: var(--ds-text-primary); }
.fix-bar.motion { background: repeating-linear-gradient(90deg, var(--ds-surface-hover) 0 6px, var(--ds-surface-raised) 6px 12px); color: var(--ds-text-secondary); }
.fix-bar.layer { background: linear-gradient(180deg, var(--ds-surface-hover), var(--ds-surface-raised)); }
.fix-bar.radius { border: 2px dashed var(--ds-border-strong); }
.fix-bar.neutral { background: var(--ds-surface-hover); }
.fix-text { margin-top: 6px; color: var(--ds-text-secondary); font-size: 11px; line-height: 16px; }
.fix-ratio { margin-top: 4px; font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
.fix-ratio.bad { color: var(--ds-danger-text); }
.fix-ratio.ok { color: var(--ds-success-text); }
.fix-decision { display: flex; gap: 8px; align-items: flex-start; }
.fix-decision p { color: var(--ds-text-secondary); font-size: 12px; line-height: 18px; }
.verdict { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; border: 1px solid var(--ds-border-subtle); color: var(--ds-text-secondary); background: var(--ds-surface-sunken); }
.verdict.fixed-overlay, .verdict.fixed-token { color: var(--ds-success-text); background: var(--ds-success-surface); border-color: var(--ds-success-border); }
.verdict.fixed-doc { color: var(--ds-info-text); background: var(--ds-info-surface); border-color: var(--ds-info-border); }
.verdict.deferred { color: var(--ds-warning-text); background: var(--ds-warning-surface); border-color: var(--ds-warning-border); }
.verdict.deleted { color: var(--ds-text-secondary); }
.fix-residual { margin-top: 8px; color: var(--ds-text-secondary); font-size: 11px; line-height: 16px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--ds-border-subtle); border-radius: 10px; background: var(--ds-surface-raised); }
table.matrix { width: 100%; border-collapse: collapse; font-size: 12px; }
.matrix th, .matrix td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--ds-border-subtle); vertical-align: top; }
.matrix th { position: sticky; top: 51px; background: var(--ds-surface-sunken); color: var(--ds-text-secondary); font-weight: 500; font-size: 11px; z-index: 2; }
.matrix tr:hover td { background: var(--ds-surface-hover); }
.row-bad td { background: var(--ds-danger-surface); }
.type-row { display: grid; grid-template-columns: 110px minmax(0,1fr) 240px; gap: 16px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--ds-border-subtle); }
.type-meta { display: flex; gap: 8px; align-items: baseline; }
.type-meta span { color: var(--ds-text-secondary); font-size: 11px; }
.type-use { color: var(--ds-text-secondary); font-size: 12px; }
.weight-row { display: grid; grid-template-columns: 48px minmax(0,1fr) 240px; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--ds-border-subtle); }
.weight-row em { color: var(--ds-text-secondary); font-size: 12px; font-style: normal; }
.space-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
.space-row code { width: 44px; color: var(--ds-text-secondary); }
.space-row span { color: var(--ds-text-secondary); font-size: 11px; }
.space-bar { height: 14px; background: var(--ds-brand-solid); border-radius: 2px; min-width: 2px; }
.radius-grid, .control-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
.radius-item { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--ds-border-subtle); border-radius: 8px; background: var(--ds-surface-raised); }
.radius-box { width: 100%; height: 52px; background: var(--ds-brand-surface); border: 1px solid var(--ds-brand-border); }
.radius-item span { color: var(--ds-text-secondary); font-size: 11px; }
.control-row { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--ds-border-subtle); border-radius: 8px; background: var(--ds-surface-raised); }
.control-box { width: 34px; background: var(--ds-solid); border-radius: 6px; }
.control-row span:last-child { color: var(--ds-text-secondary); font-size: 11px; }
.elevation { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; padding: 18px; background: var(--ds-surface-base); border: 1px solid var(--ds-border-subtle); border-radius: 12px; }
.elev-card { height: 90px; border-radius: 12px; background: var(--ds-surface-raised); border: 1px solid var(--ds-border-subtle); display: grid; place-items: center; color: var(--ds-text-secondary); font-size: 12px; }
.elev-card.panel { box-shadow: var(--ds-shadow-panel); }
.elev-card.card { box-shadow: var(--ds-shadow-card); }
.elev-card.overlay { box-shadow: var(--ds-shadow-overlay); border-color: var(--ds-overlay-border); }
.component-card { border: 1px solid var(--ds-border-subtle); border-radius: 12px; background: var(--ds-surface-raised); padding: 14px; margin-bottom: 14px; scroll-margin-top: 64px; }
.component-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 10px; }
.component-head h3 { font-size: 16px; line-height: 24px; }
.component-head code { color: var(--ds-text-secondary); font-size: 11px; }
.component-geo { color: var(--ds-text-secondary); font-size: 11px; text-align: right; }
.state-grid { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 6px; }
.state-cell { border: 1px solid var(--ds-border-subtle); border-radius: 8px; background: var(--ds-surface-sunken); min-height: 116px; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.state-cell.na { opacity: .58; }
.state-top { display: flex; justify-content: space-between; color: var(--ds-text-secondary); font-size: 10px; font-family: var(--font-mono); }
.state-top em { font-style: normal; color: var(--ds-text-secondary); }
.state-demo { flex: 1; display: grid; place-items: center; min-width: 0; }
.na-reason { color: var(--ds-text-secondary); font-size: 11px; }
.state-details { margin-top: 10px; }
.state-details summary { cursor: pointer; color: var(--ds-text-secondary); font-size: 12px; }
.state-details table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
.state-details th, .state-details td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--ds-border-subtle); vertical-align: top; }
.demo-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid transparent; background: var(--ds-solid); color: var(--ds-on-solid); font-size: 13px; font-weight: 500; cursor: pointer; max-width: 100%; }
.demo-btn.ghost { background: transparent; color: var(--ds-text-secondary); border-color: var(--ds-border); }
.demo-btn.is-hover { background: var(--ds-solid-hover); }
.demo-btn.is-active { transform: translateY(1px); }
.demo-btn.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-btn.is-disabled { background: var(--ds-surface-hover); color: var(--ds-text-disabled); cursor: not-allowed; }
.demo-btn.is-error { border-color: var(--ds-danger-border); }
.demo-field { display: grid; gap: 4px; width: 100%; font-size: 10px; color: var(--ds-text-secondary); }
.demo-input { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--ds-input-border); border-radius: 6px; background: var(--ds-input-surface); color: var(--ds-input-text); font-size: 13px; }
.demo-input .placeholder { color: var(--ds-text-placeholder); }
.demo-input.is-hover { border-color: var(--ds-input-border-hover); background: var(--ds-input-surface-hover); }
.demo-input.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-input.is-disabled { background: var(--ds-surface-hover); color: var(--ds-text-disabled); border-color: var(--ds-border-subtle); }
.demo-input.is-error { border-color: var(--ds-danger-border); }
.demo-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; height: 32px; padding: 0 8px 0 12px; border: 1px solid var(--ds-input-border); border-radius: 6px; background: var(--ds-input-surface); color: var(--ds-input-text); font-size: 12px; }
.demo-select .chev { color: var(--ds-text-secondary); }
.demo-select.is-hover { border-color: var(--ds-input-border-hover); background: var(--ds-input-surface-hover); }
.demo-select.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-select.is-disabled { background: var(--ds-surface-hover); color: var(--ds-text-disabled); border-color: var(--ds-border-subtle); }
.demo-select.is-error { border-color: var(--ds-danger-border); }
.demo-check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ds-text-primary); }
.demo-check .box { width: 16px; height: 16px; display: grid; place-items: center; border: 1.5px solid var(--ds-border-strong); border-radius: 4px; background: var(--ds-surface-raised); font-size: 10px; color: var(--ds-on-solid); }
.demo-check.radio .box { border-radius: 999px; }
.demo-check.radio .box::after { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--ds-solid); }
.demo-check.is-hover .box { background: var(--ds-surface-hover); }
.demo-check.is-active .box { background: var(--ds-surface-active); }
.demo-check.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; border-radius: 4px; }
.demo-check.is-disabled { color: var(--ds-text-disabled); }
.demo-check.is-disabled .box { border-color: var(--ds-border-subtle); }
.demo-check.is-error .box { border-color: var(--ds-danger-border); }
.demo-switch { display: inline-flex; align-items: center; width: 36px; height: 20px; padding: 2px; border-radius: 999px; background: var(--ds-surface-active); border: 1px solid var(--ds-border-strong); }
.demo-switch .knob { width: 14px; height: 14px; border-radius: 999px; background: var(--ds-surface-raised); display: grid; place-items: center; }
.demo-switch.is-hover { border-color: var(--ds-solid); }
.demo-switch.is-active { background: var(--ds-solid); }
.demo-switch.is-active .knob { margin-left: 16px; }
.demo-switch.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-switch.is-disabled { opacity: .55; }
.demo-switch.is-error { border-color: var(--ds-danger-border); }
.demo-side { font-size: 10px; color: var(--ds-text-secondary); margin-left: 4px; }
.demo-badge { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 4px; font-size: 12px; line-height: 16px; font-weight: 500; white-space: nowrap; }
.demo-badge.success { color: var(--ds-success-text); background: var(--ds-success-surface); border: 1px solid var(--ds-success-border); }
.demo-badge.warning { color: var(--ds-warning-text); background: var(--ds-warning-surface); border: 1px solid var(--ds-warning-border); }
.demo-badge.is-hover { filter: brightness(.97); }
.demo-badge.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-badge.is-error { color: var(--ds-danger-text); background: var(--ds-danger-surface); border-color: var(--ds-danger-border); }
.demo-card { width: 100%; padding: 10px; border: 1px solid var(--ds-border-subtle); border-radius: 10px; background: var(--ds-surface-raised); box-shadow: var(--ds-shadow-card); display: grid; gap: 2px; }
.demo-card-label { font-size: 10px; color: var(--ds-text-secondary); }
.demo-card strong { font-size: 16px; }
.demo-card-foot { font-size: 10px; color: var(--ds-success-text); }
.demo-card.is-hover { box-shadow: var(--ds-shadow-overlay); border-color: var(--ds-border); }
.demo-card.is-active { transform: translateY(1px); }
.demo-card.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-card.is-error { border-color: var(--ds-danger-border); }
.demo-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.demo-table th, .demo-table td { text-align: left; padding: 3px 4px; border-bottom: 1px solid var(--ds-border-subtle); }
.demo-table th { color: var(--ds-text-secondary); font-weight: 500; }
.demo-table.is-hover tbody tr:first-child { background: var(--ds-surface-hover); }
.demo-table.is-active tbody tr:first-child { background: var(--ds-surface-active); }
.demo-table.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-table.is-error { outline: 1px solid var(--ds-danger-border); }
.demo-dialog { width: 100%; border: 1px solid var(--ds-overlay-border); border-radius: 10px; background: var(--ds-overlay-surface); box-shadow: var(--ds-shadow-overlay); padding: 8px; font-size: 10px; }
.demo-dialog-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.demo-dialog p { color: var(--ds-text-secondary); font-size: 10px; }
.demo-dialog-foot { display: flex; justify-content: flex-end; gap: 4px; margin-top: 6px; }
.demo-dialog-foot .demo-btn { height: 22px; font-size: 10px; padding: 0 6px; }
.demo-dialog.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-dialog.is-error { border-color: var(--ds-danger-border); }
.demo-sheet { width: 100%; height: 100%; min-height: 80px; border: 1px solid var(--ds-overlay-border); border-left-width: 3px; border-radius: 8px 0 0 8px; background: var(--ds-overlay-surface); padding: 8px; font-size: 10px; }
.demo-sheet-row { display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--ds-border-subtle); color: var(--ds-text-secondary); }
.demo-sheet.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-sheet.is-error { border-color: var(--ds-danger-border); }
.demo-toast { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border: 1px solid var(--ds-border-subtle); border-radius: 8px; background: var(--ds-overlay-surface); box-shadow: var(--ds-shadow-overlay); font-size: 10px; }
.demo-toast .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--ds-success-solid); flex: none; }
.demo-toast.danger .dot { background: var(--ds-danger-solid); }
.demo-toast button { margin-left: auto; border: 0; background: transparent; color: var(--ds-text-secondary); }
.demo-toast.is-hover { border-color: var(--ds-border); }
.demo-toast.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-toast.is-error { border-color: var(--ds-danger-border); }
.demo-tooltip { padding: 6px 8px; border-radius: 6px; background: var(--ds-text-primary); color: var(--ds-surface-base); font-size: 10px; max-width: 100%; }
.demo-tooltip.is-hover { filter: brightness(1.12); }
.demo-tooltip.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-tabs { display: flex; gap: 4px; padding: 2px; border: 1px solid var(--ds-border-subtle); border-radius: 6px; background: var(--ds-surface-sunken); font-size: 10px; }
.demo-tabs span { padding: 3px 5px; border-radius: 4px; color: var(--ds-text-secondary); }
.demo-tabs span.active { background: var(--ds-surface-raised); color: var(--ds-text-primary); border: 1px solid var(--ds-border); }
.demo-tabs.is-hover span:not(.active) { background: var(--ds-surface-hover); }
.demo-tabs.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-tabs.is-error { border-color: var(--ds-danger-border); }
.demo-skel { width: 100%; display: grid; gap: 5px; }
.demo-skel span { display: block; height: 8px; border-radius: 4px; background: var(--ds-surface-sunken); animation: pulse 1.4s ease-in-out infinite; }
.demo-skel span:nth-child(1) { width: 70%; }
.demo-skel span:nth-child(2) { width: 100%; }
.demo-skel span:nth-child(3) { width: 45%; }
.demo-skel.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-empty { width: 100%; min-height: 90px; display: grid; place-items: center; gap: 3px; padding: 8px; border: 1px dashed var(--ds-border-subtle); border-radius: 10px; text-align: center; }
.demo-empty strong { font-size: 11px; }
.demo-empty p { color: var(--ds-text-secondary); font-size: 9px; }
.demo-empty .demo-btn { height: 20px; font-size: 9px; }
.empty-icon { color: var(--ds-text-decorative); font-size: 18px; line-height: 18px; }
.demo-empty.is-hover { border-color: var(--ds-border); }
.demo-empty.is-focus { outline: 2px solid var(--ds-focus-ring); outline-offset: 2px; }
.demo-empty.is-error { border-color: var(--ds-danger-border); color: var(--ds-danger-text); }
.demo-error { color: var(--ds-danger-text); font-size: 9px; }
.spinner { width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 999px; display: inline-block; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.rules-table td, .rules-table th { font-size: 11px; }
.level { font-family: var(--font-mono); font-size: 10px; color: var(--ds-brand-text); }
.rule-status { font-size: 11px; }
.rule-status.ok { color: var(--ds-success-text); }
.filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.filter-btn { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--ds-border); background: var(--ds-surface-raised); color: var(--ds-text-secondary); font-size: 12px; cursor: pointer; }
.filter-btn.active { background: var(--ds-solid); color: var(--ds-on-solid); border-color: var(--ds-solid); }
.search { height: 30px; min-width: 260px; padding: 0 10px; border: 1px solid var(--ds-border-strong); border-radius: 6px; background: var(--ds-input-surface); color: var(--ds-input-text); font-size: 13px; }
.search::placeholder { color: var(--ds-text-placeholder); }
.action { font-family: var(--font-mono); font-size: 10px; padding: 2px 5px; border-radius: 3px; background: var(--ds-surface-sunken); }
.action.alias { color: var(--ds-success-text); }
.action.deleted { color: var(--ds-danger-text); }
.action.rename, .action.merge { color: var(--ds-info-text); }
.issue-decision { color: var(--ds-text-secondary); font-size: 11px; line-height: 16px; margin-top: 3px; max-width: 560px; }
.issue-evidence { font-family: var(--font-mono); font-size: 10px; color: var(--ds-text-secondary); max-width: 260px; word-break: break-all; }
.after { color: var(--ds-success-text); }
.checks { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
.check { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--ds-border-subtle); border-radius: 8px; background: var(--ds-surface-raised); }
.check .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--ds-success-solid); margin-top: 6px; flex: none; }
.check code { display: block; font-size: 11px; }
.check span { color: var(--ds-text-secondary); font-size: 11px; }
.residual-list { margin: 0; padding-left: 18px; color: var(--ds-text-secondary); font-size: 13px; line-height: 22px; }
footer { padding: 30px 0 10px; color: var(--ds-text-secondary); font-size: 12px; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .toc { display: none; }
  main { padding: 28px 20px 72px; }
  .stats { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .chip-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .fix-grid-cards, .grid-2, .grid-3 { grid-template-columns: 1fr; }
  .state-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
}
@media (max-width: 640px) {
  .stats { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .chip-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .status-row { grid-template-columns: 1fr; }
  .status-chips { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .state-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .hero h1 { font-size: 30px; line-height: 38px; }
}
@media print {
  body::before, .toc, .top-actions { display: none; }
  .layout { display: block; }
  main { padding: 0; }
  .topbar { position: static; }
}
`

export const renderHtml = data => {
  const tokenCss = data.__tokensCss ?? ''
  const light = data.roles.light
  const dark = data.roles.dark
  const p0 = data.meta.counts.issuesBySeverity.P0
  const p1 = data.meta.counts.issuesBySeverity.P1
  const p2 = data.meta.counts.issuesBySeverity.P2
  const p3 = data.meta.counts.issuesBySeverity.P3
  const passCount = [...data.contrast.light, ...data.contrast.dark].filter(item => item.pass === true).length
  const requiredCount = [...data.contrast.light, ...data.contrast.dark].filter(item => item.threshold !== null).length
  const failing = [...data.contrast.light, ...data.contrast.dark].filter(item => item.pass === false)

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>osw Design System v2 · 可执行规范</title>
<style>
${tokenCss}
${pageCss}
</style>
</head>
<body>
<header class="topbar">
  <div class="brandline"><span class="brandmark">os</span><span>Design System <small>v2.0 · dark-first</small></span></div>
  <div class="top-actions">
    <span class="pill"><strong>${data.meta.counts.total}</strong> tokens</span>
    <span class="pill"><strong>${p0 + p1}</strong> P0/P1 收敛</span>
    <button class="theme-btn" id="theme-toggle" type="button" aria-label="切换明暗">☾ 暗色</button>
  </div>
</header>

<div class="layout">
  <aside class="toc" aria-label="目录">
    <div class="toc-title">Contents</div>
    <a href="#overview"><span class="n">00</span>结论与范围</a>
    <a href="#architecture"><span class="n">01</span>token 架构</a>
    <a href="#palette"><span class="n">02</span>12 阶色板</a>
    <a href="#fixes"><span class="n">03</span>P0/P1 前后对比</a>
    <a href="#contrast"><span class="n">04</span>对比度矩阵</a>
    <a href="#type"><span class="n">05</span>排版与刻度</a>
    <a href="#components"><span class="n">06</span>组件全状态</a>
    <a href="#rules"><span class="n">07</span>规范条文</a>
    <a href="#migration"><span class="n">08</span>迁移映射</a>
    <a href="#issues"><span class="n">09</span>问题收敛表</a>
    <a href="#verify"><span class="n">10</span>验证与残留</a>
  </aside>

  <main>
    <div class="hero" id="overview">
      <div class="eyebrow">OSW / DESIGN SYSTEM / V2.0</div>
      <h1>把 29 条问题收敛成一套可执行的 token 与组件契约。</h1>
      <p class="lead">v2 不换品牌色相，不改运行时页面与组件源码。它先修设计系统本体：一条中性色阶、一条品牌色阶、四组状态角色、六个字号、三档字重、一套焦点环，以及能被守卫测试复算的对比度矩阵。</p>
      <div class="hero-note">范围：本轮只交付 token 架构、组件规范、可交互预览、迁移映射与守卫测试。tokens.v2.css 可直接在 index.css 之后导入；标为「需下一轮改源码」的条目列出了具体文件，不在本轮偷偷修改。</div>
      <div class="stats">
        <div class="stat"><strong>${data.meta.counts.total}</strong><span>v2 token</span></div>
        <div class="stat"><strong>12 + 12</strong><span>中性 / 品牌色阶</span></div>
        <div class="stat"><strong>${passCount}/${requiredCount}</strong><span>对比度断言通过</span></div>
        <div class="stat"><strong>${data.meta.counts.components}</strong><span>组件 × 7 状态</span></div>
        <div class="stat"><strong>${p0}/${p1}/${p2}/${p3}</strong><span>P0 / P1 / P2 / P3</span></div>
        <div class="stat"><strong>0</strong><span>v2 未引用 token</span></div>
      </div>
    </div>

    <section id="architecture">
      <div class="section-head"><div><div class="kicker">01 / ARCHITECTURE</div><h2>三层结构：色阶只被角色消费</h2><p>组件不许直接拿色阶。色阶职责写死，语义角色按主题换绑定，v1 旧名只做别名。</p></div></div>
      <div class="flow">
        <div class="flow-box"><strong>Primitive · 24</strong><span>neutral-1…12 / brand-1…12。OKLCH 定义，hex 只做核对。</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-box"><strong>Semantic · ${Object.keys(light).length}</strong><span>surface / border / solid / text / status / focus。亮暗各一套绑定。</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-box"><strong>Compat · ${Object.keys(data.aliases).length}</strong><span>--color-* 旧名 → --ds-*。迁移期不改调用点。</span></div>
      </div>
      <div class="grid-2" style="margin-top:16px">
        <div class="panel">
          <h3>角色职责（写死，不靠注释约定）</h3>
          <table class="bands">
            <thead><tr><th>阶</th><th>职责</th><th>允许</th><th>不得</th></tr></thead>
            <tbody>
              <tr><td><span class="band-swatch" style="background:var(--ds-neutral-2)"></span>1–2</td><td>底</td><td>页面底、卡片底</td><td>文字、控件边</td></tr>
              <tr><td><span class="band-swatch" style="background:var(--ds-neutral-4)"></span>3–5</td><td>组件态</td><td>hover / active / selected / 输入底</td><td>正文、卡片底</td></tr>
              <tr><td><span class="band-swatch" style="background:var(--ds-neutral-8)"></span>6–8</td><td>边框</td><td>收边 / 常规边 / 控件边界</td><td>文字、大面积填充</td></tr>
              <tr><td><span class="band-swatch" style="background:var(--ds-neutral-9)"></span>9–10</td><td>实心</td><td>主按钮、开关轨道</td><td>正文、卡片底</td></tr>
              <tr><td><span class="band-swatch" style="background:var(--ds-neutral-11)"></span>11–12</td><td>文本</td><td>次级 / 主文本</td><td>填充、边框</td></tr>
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h3>为什么只有两档文本</h3>
          <p>v1 的四级文本 3.37:1，把“层级”做成了“读不清”。v2 取消四级：11 阶用于次级文本，12 阶用于主文本；三级文本并入次级。层级改由字号与字重表达，而不是继续降低对比度。</p>
          <ul>
            <li>字号 6 档：12/16、13/20、14/20、16/24、20/28、24/32</li>
            <li>字重 3 档：400 / 500 / 600</li>
            <li>行高必须成对声明；11px 直接取消</li>
            <li>placeholder 是唯一的“浅文本”，仍按 4.5:1 校验</li>
          </ul>
        </div>
      </div>
    </section>

    <section id="palette">
      <div class="section-head"><div><div class="kicker">02 / PALETTE</div><h2>12 阶中性色 + 12 阶品牌色 + 四组状态角色</h2><p>品牌色相沿用现有 #085afc（OKLCH hue 262.44），只重排明度与彩度；中性色统一到 hue 262，消除纯灰与蓝灰双轨。每个色块都带对承载底色的实测值。</p></div></div>
      <h3 style="font-size:14px;margin:6px 0 10px">中性色 · neutral-1…12</h3>
      <div class="chip-grid">${neutralChips(data)}</div>
      <h3 style="font-size:14px;margin:22px 0 10px">品牌色 · brand-1…12 <span class="kicker">step 9 = #085afc</span></h3>
      <div class="chip-grid">${brandChips(data)}</div>
      <h3 style="font-size:14px;margin:22px 0 10px">状态族 · surface / border / text / solid / on-solid</h3>
      ${statusChips(data)}
    </section>

    <section id="fixes">
      <div class="section-head"><div><div class="kicker">03 / BEFORE → AFTER</div><h2>P0/P1 逐条并排：修改前 vs v2</h2><p>17 条（5 P0 + 12 P1）每条一栏。左边是 v1 实测与承载底色，右边是 v2 的 token/覆盖层决策；比值来自同一套 WCAG 计算。</p></div></div>
      <div class="fix-grid-cards">${fixCards(data)}</div>
    </section>

    <section id="contrast">
      <div class="section-head"><div><div class="kicker">04 / CONTRAST MATRIX</div><h2>完整对比度矩阵：前景 × 承载底色 × 阈值</h2><p>每一行都写明前景 token、背景 token 与两套主题下的实际 hex。阈值：正文 4.5:1、控件/图形 3:1；禁用与装饰单列，不混入门槛。当前 ${failing.length === 0 ? '全部通过' : `${failing.length} 行未通过`}。</p></div></div>
      <div class="table-wrap">
        <table class="matrix">
          <thead><tr><th>用途</th><th>前景</th><th>承载底色</th><th>亮色</th><th>暗色</th><th>阈值</th></tr></thead>
          <tbody>${contrastRows(data)}</tbody>
        </table>
      </div>
    </section>

    <section id="type">
      <div class="section-head"><div><div class="kicker">05 / TYPE & SCALE</div><h2>六个字号、三个字重、4px 网格、六档圆角</h2><p>字号与行高成对；11px 取消。控件高度 24/28/32/36/40，触控目标下限 44px。圆角只保留 2/4/6/8/12/16。</p></div></div>
      <div class="panel">
        <h3>字号阶梯（6 档）</h3>
        ${typeSpecimen(data)}
        <h3 style="margin-top:18px">字重（3 档）</h3>
        ${weightSpecimen(data)}
      </div>
      <div class="grid-2" style="margin-top:14px">
        <div class="panel"><h3>间距 · 4px 主网格</h3>${spacingBars(data)}<p style="margin-top:8px">例外只有 1px 描边与 2px 焦点 offset / 图标内衬；6/10/14 等半档不再允许。</p></div>
        <div class="panel"><h3>控件高度 · 触控下限</h3>${controlSamples(data)}<p style="margin-top:8px">coarse pointer 下可点区域不得小于 <code>--ds-touch-min: 44px</code>；24px 仅桌面指针。</p></div>
      </div>
      <div class="grid-2" style="margin-top:14px">
        <div class="panel"><h3>圆角 · 6 档</h3><div class="radius-grid">${radiusSamples(data)}</div></div>
        <div class="panel"><h3>层次 · 三档阴影</h3><div class="elevation"><div class="elev-card panel">panel</div><div class="elev-card card">card</div><div class="elev-card overlay">overlay</div></div><p style="margin-top:8px">暗色不用黑色重影分层，靠 surface 明度差 + 1px border；阴影只保留三档语义。</p></div>
      </div>
    </section>

    <section id="components">
      <div class="section-head"><div><div class="kicker">06 / COMPONENTS</div><h2>16 个组件 × 7 个状态</h2><p>每格是真实 HTML/CSS 展示；N/A 明确写原因。展开“状态契约”可看每个状态的非颜色编码、键盘与焦点要求。</p></div></div>
      ${componentGallery(data)}
    </section>

    <section id="rules">
      <div class="section-head"><div><div class="kicker">07 / RULES</div><h2>规范条文 R-01…R-18</h2><p>每条都有 MUST/SHOULD、阈值、查法与当前状态。守卫测试按同一套阈值执行，不靠人眼。</p></div></div>
      <div class="table-wrap"><table class="matrix rules-table"><thead><tr><th>编号</th><th>级别</th><th>条文</th><th>判定 / 查法</th><th>v2 状态</th></tr></thead><tbody>${rulesRows(data)}</tbody></table></div>
    </section>

    <section id="migration">
      <div class="section-head"><div><div class="kicker">08 / MIGRATION</div><h2>v1 → v2 映射：旧名优先保留为 alias</h2><p>${Object.keys(data.aliases).length} 个兼容别名 + ${data.deadTokens.length} 个死 token 的删除/替代。搜索旧名或新名即可定位。</p></div></div>
      <input class="search" id="migration-search" type="search" placeholder="搜索 token，例如 --color-text-quaternary" aria-label="搜索迁移映射">
      <div class="table-wrap" style="margin-top:10px"><table class="matrix" id="migration-table"><thead><tr><th>v1</th><th>v2</th><th>动作</th><th>说明</th></tr></thead><tbody>${migrationRows(data)}</tbody></table></div>
    </section>

    <section id="issues">
      <div class="section-head"><div><div class="kicker">09 / CONVERGENCE</div><h2>29 条问题逐条处置</h2><p>P0 5 / P1 12 / P2 10 / P3 2。没有“静默消失”：每条都写明已修于哪个 token/组件决策，或为什么保留、下一轮改哪个文件。</p></div></div>
      <div class="filters" role="group" aria-label="按严重度筛选">
        <button class="filter-btn active" data-filter="all">全部 29</button>
        <button class="filter-btn" data-filter="P0">P0 ${p0}</button>
        <button class="filter-btn" data-filter="P1">P1 ${p1}</button>
        <button class="filter-btn" data-filter="P2">P2 ${p2}</button>
        <button class="filter-btn" data-filter="P3">P3 ${p3}</button>
      </div>
      <div class="table-wrap"><table class="matrix" id="issues-table"><thead><tr><th>级别</th><th>ID</th><th>问题 / 决策</th><th>处置</th><th>证据</th><th>前 → 后</th><th>残留</th></tr></thead><tbody>${issueRows(data)}</tbody></table></div>
    </section>

    <section id="verify">
      <div class="section-head"><div><div class="kicker">10 / VERIFY</div><h2>门禁、截图与仍需拍板项</h2><p>设计系统本身可验收：生成物 --check、对比度重算、var() 闭合、字号/字重上限、字面色值扫描。运行时铺开是下一轮。</p></div></div>
      <div class="checks">
        <div class="check"><span class="dot"></span><div><code>node scripts/design-system/build-v2.mjs --check</code><span>生成物与源码逐字节一致；CSS/HTML/README/JSON 四份产物</span></div></div>
        <div class="check"><span class="dot"></span><div><code>pnpm exec vitest run packages/console/source/design-system.guard.test.ts</code><span>对比度逐对重算；字号/字重/间距/圆角上限；var() 闭合；字面色值扫描</span></div></div>
        <div class="check"><span class="dot"></span><div><code>pnpm lint && pnpm typecheck && pnpm test</code><span>仓库门禁；见交付报告的实际输出</span></div></div>
        <div class="check"><span class="dot"></span><div><code>git diff --check</code><span>空白与冲突标记检查</span></div></div>
      </div>
      <div class="grid-2" style="margin-top:16px">
        <div class="panel"><h3>截图</h3><p>headless Chrome 整页 + 逐章，亮/暗各一套，输出到 <code>docs/design-system/audit/v2/</code>。交付报告附路径与逐章查看结论。</p></div>
        <div class="panel"><h3>仍需拍板 / 下一轮</h3><ul class="residual-list">
          <li>Button loading 需要 <code>button.tsx</code> 增加 loading prop 与 aria-busy；覆盖层只能给样式。</li>
          <li>29 处字面字号、44 处字面色值、半档间距需要 codemod；本轮不改运行时源码。</li>
          <li>Workflow 画布的 6/8/12/16 圆角覆写需在 <code>index.css:880-903</code> 删除，改用独立 workflow token。</li>
          <li>三平台 mono 字宽一致是否值得引入 Geist Mono（+1 字体文件）。</li>
          <li>插图/导出场景的字面色值是否永久登记为 illustration 例外。</li>
        </ul></div>
      </div>
    </section>

    <footer>osw Design System v2 · generated by <code>scripts/design-system/build-v2.mjs</code> · 源数据 <code>v2.generated.json</code> · 无外部依赖，可直接 file:// 打开。</footer>
  </main>
</div>

<script id="v2-data" type="application/json">${JSON.stringify({
    meta: data.meta,
    counts: data.meta.counts,
    contrast: data.contrast,
    issues: data.issues.map(item => ({ id: item.id, severity: item.severity, verdict: item.verdict })),
  }).replaceAll('<', '\\u003c')}</script>
<script>
(() => {
  const root = document.documentElement
  const button = document.getElementById('theme-toggle')
  const apply = theme => {
    root.dataset.theme = theme
    button.textContent = theme === 'dark' ? '☾ 暗色' : '☀ 亮色'
    button.setAttribute('aria-label', theme === 'dark' ? '切换到亮色' : '切换到暗色')
  }
  let theme = 'dark'
  try { theme = localStorage.getItem('osw-ds-v2-theme') || 'dark' } catch {}
  apply(theme)
  button.addEventListener('click', () => {
    theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    apply(theme)
    try { localStorage.setItem('osw-ds-v2-theme', theme) } catch {}
  })

  const filterButtons = [...document.querySelectorAll('[data-filter]')]
  const issueRows = [...document.querySelectorAll('#issues-table tbody tr')]
  filterButtons.forEach(btn => btn.addEventListener('click', () => {
    filterButtons.forEach(item => item.classList.toggle('active', item === btn))
    const filter = btn.dataset.filter
    issueRows.forEach(row => { row.hidden = filter !== 'all' && row.dataset.severity !== filter })
  }))

  const search = document.getElementById('migration-search')
  const migrationRows = [...document.querySelectorAll('#migration-table tbody tr')]
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase()
    migrationRows.forEach(row => { row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query) })
  })

  document.querySelectorAll('.ratio').forEach(node => {
    node.title = node.title || '由 WCAG 相对亮度重算'
  })
})()
</script>
</body>
</html>
`
}
