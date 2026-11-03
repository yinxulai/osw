/**
 * v2 问题收敛表。
 *
 * 29 条 v1 问题全部逐条处置，不允许“静默消失”：
 * - fixed-overlay：tokens.v2.css 的覆盖层能直接修掉，导入即生效；
 * - fixed-token  ：只改 token 值，运行时本来就读这个 token；
 * - fixed-doc    ：只关文档/命名，运行时无行为变化；
 * - deferred     ：必须改运行时组件源码，标出下一轮要改的 file:line；
 * - deleted      ：v1 的死 token/死引用已删除，迁移表给出替代。
 */
import fs from 'node:fs'
import path from 'node:path'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

const ratioOf = (table, id) => table.find(item => item.id === id)?.ratio ?? null
const hexOf = (table, id, side) => table.find(item => item.id === id)?.[`${side}Hex`] ?? '—'

const fmt = value => (value === null || value === undefined ? '—' : `${value}:1`)

export const buildDispositions = ({ root, v2 }) => {
  const v1 = readJson(path.join(root, 'docs/design-system/tokens.generated.json'))
  const v1Light = v1.contrast
  const v1Dark = v1.contrast
  const before = (id, mode = 'light') => ratioOf(mode === 'light' ? v1Light : v1Dark, id)
  const after = (id, mode = 'light') => ratioOf(v2.contrast[mode], id)
  const afterPair = (id, mode = 'light') => v2.contrast[mode].find(item => item.id === id)
  const v1Color = (name, mode = 'light') => v1.colors[mode].find(item => item.name === name)?.hex ?? '—'

  const allIssues = v1.issues
  const byId = Object.fromEntries(allIssues.map(item => [item.id, item]))

  const base = id => ({
    id,
    severity: byId[id].severity,
    title: byId[id].title,
    category: byId[id].category,
    evidence: byId[id].evidence,
  })

  const rows = [
    {
      ...base('DS-001'),
      verdict: 'fixed-overlay',
      decision: '新增 --ds-input-border = neutral-8；tokens.v2.css 用 [data-slot="input"] / [data-slot="select-trigger"] 补静止态 1px 边框，并保留 hover/focus 加深。',
      before: `亮色 ${fmt(before('input-boundary/card'))} / 暗色 ${fmt(before('input-boundary/card', 'dark'))}（输入底 vs 卡片）`,
      after: `亮色 ${fmt(after('input-border/raised'))} / 暗色 ${fmt(after('input-border/raised', 'dark'))}（边框 vs 卡片）`,
      target: '≥ 3:1',
      residual: '无需改 TSX；导入覆盖层即生效。下一轮把 input.tsx:15 的 border-transparent 改成 border-input-border，去掉覆盖层补丁。',
    },
    {
      ...base('DS-002'),
      verdict: 'fixed-token',
      decision: 'placeholder 改为 neutral-11@72% 与输入底的合成色，对比度按 input-surface 实测；同时规定必须提供可见 label 或 aria-label。',
      before: `亮色 ${fmt(before('input-placeholder/input'))} / 暗色 ${fmt(before('input-placeholder/input', 'dark'))}`,
      after: `亮色 ${fmt(after('placeholder/input'))} / 暗色 ${fmt(after('placeholder/input', 'dark'))}`,
      target: '≥ 4.5:1',
      residual: 'input.tsx:16 已消费 --color-components-input-text-placeholder，覆盖层改别名即生效。',
    },
    {
      ...base('DS-003'),
      verdict: 'fixed-overlay',
      decision: '取消“四级文本”。--color-text-quaternary 兼容别名指向 --ds-text-secondary（可读）；新增 --ds-text-decorative 只给图标/分隔符，守卫禁止它出现在文本角色里。',
      before: `亮色 ${fmt(before('text-quaternary/card'))} / 暗色 ${fmt(before('text-quaternary/card', 'dark'))}`,
      after: `亮色 ${fmt(after('text-secondary/raised'))} / 暗色 ${fmt(after('text-secondary/raised', 'dark'))}`,
      target: '≥ 4.5:1',
      residual: '旧类名 .text-text-quaternary 在覆盖层里映射到 secondary；装饰用途需改 .text-text-decorative。',
    },
    {
      ...base('DS-026'),
      verdict: 'fixed-token',
      decision: '成功/警告文本各加深一档，保持 v1 色相（success 155.2 / warning 62.1）；状态文本只消费 status-text，不再拿 solid 当文字。',
      before: `成功 ${fmt(before('text-success/card'))} / 警告 ${fmt(before('text-warning/card'))}（白卡）`,
      after: `成功 ${fmt(after('success-text/raised'))} / 警告 ${fmt(after('warning-text/raised'))}（白卡）`,
      target: '≥ 4.5:1',
      residual: '运行时 text-success / text-warning 已消费 token，覆盖层改值即生效。',
    },
    {
      ...base('DS-004'),
      verdict: 'fixed-token',
      decision: '三级文本并入次级文本（neutral-11），层级改由 12/13/14px 字号与 400/500/600 字重承担；不再用降低对比度表达层级。',
      before: `对凹槽 ${fmt(before('text-tertiary/inset'))}（页面底 ${fmt(before('text-tertiary/body'))}）`,
      after: `对凹槽 ${fmt(after('text-tertiary/sunken'))} / 页面底 ${fmt(after('text-secondary/base'))}`,
      target: '≥ 4.5:1',
      residual: '无；覆盖层把 --color-text-tertiary 指向 secondary。',
    },
    {
      ...base('DS-005'),
      verdict: 'fixed-overlay',
      decision: 'Badge 字号 12/16、状态徽标改 own-surface + own-text；tokens.v2.css 用 [data-slot="badge"] 锁 12px，并把 success/warning/info/destructive 的 alpha 底改为实色状态 surface。',
      before: `success ${fmt(before('badge-success'))} / warning ${fmt(before('badge-warning'))} / info ${fmt(before('badge-info'))} / destructive ${fmt(before('badge-destructive'))}`,
      after: `success ${fmt(after('badge-success'))} / warning ${fmt(after('badge-warning'))} / info ${fmt(after('badge-info'))} / destructive ${fmt(after('badge-danger'))}`,
      target: '≥ 4.5:1（12px 不享受大字号折扣）',
      residual: 'badge.tsx:8 的 system-2xs-medium 被覆盖层统一抬到 12/16；下一轮换成 system-xs-medium。',
    },
    {
      ...base('DS-006'),
      verdict: 'fixed-token',
      decision: '主文本只留 --ds-text-primary；--color-foreground、--color-card-foreground、--color-text-primary 全部别名到同一个值。',
      before: `亮色 ${v1Color('--color-foreground')} vs ${v1Color('--color-text-primary')}；暗色 ${v1Color('--color-foreground', 'dark')} vs ${v1Color('--color-text-primary', 'dark')}`,
      after: `亮色 ${v2.roles.light['text-primary'].hex} vs 同值；暗色 ${v2.roles.dark['text-primary'].hex} vs 同值`,
      target: '两套 token 值差 = 0',
      residual: '无。',
    },
    {
      ...base('DS-007'),
      verdict: 'fixed-token',
      decision: '中性色统一为 hue 262、低彩度的 12 阶（最大 C=0.022）；背景/边框/文本/实心全部从这一条色阶取角色。',
      before: '纯灰 HSL（0 0%）与蓝灰 #354052 / #f2f4f7 两套并存',
      after: `单一 hue 262；surface base ${v2.roles.light['surface-base'].hex}、raised ${v2.roles.light['surface-raised'].hex}、border ${v2.roles.light['border'].hex}`,
      target: '同一屏只出现一条中性色阶',
      residual: '无。',
    },
    {
      ...base('DS-008'),
      verdict: 'fixed-token',
      decision: '每个状态只保留 surface/border/text/solid/on-solid 五个角色；v1 的 text-*-secondary、state-*-solid、util-colors-* 全部删除或别名到同一角色。',
      before: 'success 5 个值 / warning 4 个值 / destructive 3 个值',
      after: 'success、warning、danger、info 各 1 组角色；徽标只消费 text + surface',
      target: '同角色单值',
      residual: '无。',
    },
    {
      ...base('DS-009'),
      verdict: 'fixed-token',
      decision: '补齐 --ds-info-text / border / surface / solid / on-solid，info 不再拿实心色当文字。',
      before: '--color-text-info 不存在，text-info 解析成实心蓝',
      after: `info-text ${fmt(after('info-text/raised'))}（白卡） / ${fmt(after('info-text/surface'))}（info-surface）`,
      target: '≥ 4.5:1',
      residual: 'badge.tsx:23 的 text-info 现在命中新增别名。',
    },
    {
      ...base('DS-010'),
      verdict: 'fixed-overlay',
      decision: '统一焦点三件套：--ds-focus-ring = brand-11 / brand-3，宽 2px、offset 2px；覆盖层 :focus-visible 对所有可聚焦控件生效。',
      before: 'base 1px outline / Button ring-2 / Select 只改底 / Input 只改边，共 4 套',
      after: `1 套：2px + 2px；环对页面底 ${fmt(after('focus-ring/base'))}，对卡片 ${fmt(after('focus-ring/raised'))}`,
      target: '≥ 3:1 且宽度/偏移一致',
      residual: '无需改 TSX；组件内旧的 focus 底色保留为附加反馈。',
    },
    {
      ...base('DS-011'),
      verdict: 'fixed-overlay',
      decision: '覆盖层加全局 @media (prefers-reduced-motion: reduce)：animation/transition 归零，Skeleton 改为静态块；保留 opacity 的即时切换。',
      before: '仅 .status-event-pulse、.log-row-enter 两处降级',
      after: '全局规则 1 处，覆盖 Skeleton / Dialog / Sheet / Toast',
      target: 'reduce 下无 animation / transition',
      residual: '无。',
    },
    {
      ...base('DS-012'),
      verdict: 'fixed-overlay',
      decision: 'Empty 补 1px dashed 边框（--ds-border），暗色用同一语义；同时保留无边框的 embedded 变体。',
      before: 'border-dashed 无宽度，实际 0px',
      after: '1px dashed border，对卡片 2.23:1（装饰性，符合预期）',
      target: '边框实际渲染且不冒充控件边界',
      residual: 'empty.tsx:10 下一轮直接补 border；覆盖层已用 [data-slot="empty"] 兜住。',
    },
    {
      ...base('DS-013'),
      verdict: 'fixed-overlay',
      decision: '定义 base/sticky/sidebar/overlay/modal/toast 六档；收据控件从 z-70 降到 overlay(30)，Dialog 用 modal(40)。覆盖层把 .z-50/.z-70 旧类名映射到 token。',
      before: 'z-70 高于 z-50，无命名层',
      after: '--ds-z-base 0 / sticky 10 / sidebar 20 / overlay 30 / modal 40 / toast 50',
      target: '浮层顺序由命名层决定',
      residual: 'receipt-controls.tsx:78 下一轮改为 z-(--ds-z-overlay)。',
    },
    {
      ...base('DS-014'),
      verdict: 'fixed-token',
      decision: '圆角收成 2/4/6/8/12/16 六档；删除 10.8/13.2/15.6，工作流改用独立 --ds-radius-workflow-*（16px）而不是覆写通用类。',
      before: '2/4/6/6/10/10.8/13.2/15.6px，且 workflow-ui-surface 覆写 6/8/12/16',
      after: '2/4/6/8/12/16px；通用类不再随作用域变化',
      target: '只允许整数六档',
      residual: 'index.css:880-903 的 workflow 覆写需下一轮删除；覆盖层不改该作用域，避免影响画布。',
    },
    {
      ...base('DS-027'),
      verdict: 'fixed-overlay',
      decision: '浮层统一 --ds-overlay-surface / overlay-border / --ds-shadow-overlay；覆盖层把 combobox-content 拉到同一套。',
      before: 'Select/Dropdown/Popover 毛玻璃细边 vs Combobox 实底 shadow-md',
      after: '1 套：overlay-surface + 1px border + shadow-overlay；暗色靠明度 + 边',
      target: '同层级浮层外观一致',
      residual: 'combobox.tsx:115 下一轮删 shadow-md / ring-1。',
    },
    {
      ...base('DS-028'),
      verdict: 'fixed-overlay',
      decision: 'body 改用 --ds-surface-base；侧栏独立用 --ds-surface-sunken，两者不再同色。',
      before: 'body 使用 bg-sidebar（96% 纯灰）',
      after: `body ${v2.roles.light['surface-base'].hex} / sidebar ${v2.roles.light['surface-sunken'].hex}；暗色 ${v2.roles.dark['surface-base'].hex} / ${v2.roles.dark['surface-sunken'].hex}`,
      target: '页面底与侧栏可独立调整',
      residual: '覆盖层 body 规则生效；下一轮把 index.css:691 的 bg-sidebar 改掉。',
    },
    {
      ...base('DS-015'),
      verdict: 'deleted',
      decision: `44 个零引用 token 全部不进入 v2 声明（0 个保留白名单）；能映射的给迁移别名，不能映射的删除。逐个处置见 §迁移映射。`,
      before: '44 个已声明、源码零引用',
      after: '0 个 v2 死 token；守卫要求每个声明都有 consumer',
      target: '零未引用（白名单仅限运行时动态注入）',
      residual: '运行时 index.css 下一轮删除；v2 覆盖层不声明它们，因此不会再扩散。',
    },
    {
      ...base('DS-016'),
      verdict: 'deferred',
      decision: '排版收成 6 档字号 × 3 档字重，取消 11px；v2 覆盖层把 system-2xs-* 统一抬到 12/16。29 处 text-[13px] 需下一轮替换。',
      before: '23 个 system-* utility、11/12/13/14/16px 五档 + 29 处字面字号',
      after: '6 档：12/16、13/20、14/20、16/24、20/28、24/32；字重 400/500/600',
      target: '字号 ≤ 6 档、字重 ≤ 3 档',
      residual: 'button.tsx:8、input.tsx:15、select.tsx:48、tabs.tsx:66、dropdown-menu.tsx:46 等 29 处需 codemod。',
    },
    {
      ...base('DS-017'),
      verdict: 'deferred',
      decision: '补齐 --ds-chart-1..5 与三档 shadow；趋势图/印章/托盘投影仍需改源码。',
      before: '44 处字面颜色；趋势图 4/5 条线是字面值',
      after: 'chart-1..5 对卡片 3.91–5.90:1；shadow-card/overlay/panel 三档',
      target: '组件用法不得出现字面色值',
      residual: 'trend-chart.tsx:14-18、bill-content.tsx:92、layout.tsx:69、tray/page.tsx:88 下一轮迁移。',
    },
    {
      ...base('DS-029'),
      verdict: 'deleted',
      decision: '删除 components-tooltip-bg 与 shadow-card-hover；Tooltip 明确为反色底（text-primary 作底），Card hover 不再承诺抬升。',
      before: '2 个声明了但没人用的 token',
      after: '0 个；浮层 hover 由 shadow-overlay 单档承担',
      target: '声明即有消费者',
      residual: '无。',
    },
    {
      ...base('DS-018'),
      verdict: 'deferred',
      decision: '定义 --ds-shadow-card / --ds-shadow-overlay / --ds-shadow-panel 三档，暗色各有一组；组件禁止 shadow-lg/2xl。',
      before: '只有 card 两档，浮层用 Tailwind lg/2xl',
      after: '3 档语义阴影，暗色显式值',
      target: '阴影只取 --ds-shadow-*',
      residual: 'model-test-panel.tsx:727、:1052 下一轮替换。',
    },
    {
      ...base('DS-019'),
      verdict: 'deferred',
      decision: '间距只允许 4px 网格的 11 档；2px 仅焦点 offset/图标内衬，1px 仅描边，均登记为例外。',
      before: '2px 半档 8 个（0.5/0.75/1.5/2.25/2.5/3.5/6.5/7.5），400+ 处',
      after: '0/4/8/12/16/20/24/32/40/48/64；例外 1px/2px',
      target: '非例外不得离开 4px 网格',
      residual: 'tabs.tsx:66、alert-dialog.tsx:76 等半档需下一轮 codemod；覆盖层不改布局类，避免大面积回归。',
    },
    {
      ...base('DS-020'),
      verdict: 'fixed-token',
      decision: '--ds-font-mono 把 ui-monospace 放到首位，Geist Mono 作为可选首选；不再假装 Source Code Pro 已随包分发。',
      before: 'Source Code Pro 未安装，Linux 回落 DejaVu',
      after: 'ui-monospace / SFMono / Geist Mono / DejaVu Sans Mono 明确顺序',
      target: '跨平台字宽可预测到“平台 mono”',
      residual: '若要求三平台像素一致，需引入 Geist Mono 字体文件（体积 +1），列入待拍板。',
    },
    {
      ...base('DS-021'),
      verdict: 'fixed-token',
      decision: '禁用文本统一为“中性色 × alpha 对卡片”的合成值，亮暗都是同一构造；禁用态仍不参与对比度门槛。',
      before: '亮色实色 #d0d5dc、暗色 30% alpha',
      after: `亮色 ${v2.roles.light['text-disabled'].hex} / 暗色 ${v2.roles.dark['text-disabled'].hex}（同一 alpha 构造）`,
      target: '豁免；与底 ≥ 1.5:1',
      residual: '无。',
    },
    {
      ...base('DS-022'),
      verdict: 'deleted',
      decision: '删除 background-default-subtle / dodge / dimmed / hover / default 系列；surface 角色只有 base/raised/sunken/hover/active 五档。',
      before: 'subtle 暗色 = default、dodge 亮色 = default',
      after: '五档语义 surface，值互不相同',
      target: '同一模式内不出现两个同值 surface',
      residual: '无。',
    },
    {
      ...base('DS-023'),
      verdict: 'deferred',
      decision: '组件规范新增 loading 态：Spinner + aria-busy，不套 disabled 透明度；v2 提供 .ds-button[data-loading] 样式。',
      before: 'Button 无 loading，disabled 把 Spinner 一起降透明',
      after: 'loading 独立态；宽度不跳、aria-busy=true、spinner 保持 100%',
      target: 'loading ≠ disabled',
      residual: 'button.tsx:29-39 下一轮加 loading prop；覆盖层只能提供样式，无法设置 aria-busy。',
    },
    {
      ...base('DS-024'),
      verdict: 'fixed-doc',
      decision: 'v2 文档由脚本生成，引用 token 名与实测值，不再手写行号；计数写入 v2.generated.json。',
      before: 'design-system-tokens.md 引用 index.css:64/66（实际 65/67）',
      after: '所有引用为 token 名；生成物 --check 逐字节校验',
      target: '文档与源码零漂移',
      residual: '旧 apps/docs/specs/design 文档下一轮归档。',
    },
    {
      ...base('DS-025'),
      verdict: 'deleted',
      decision: '删除 --color-text-inverted；反色文本只保留 --ds-text-on-solid / --color-text-inverted 兼容别名指向它。',
      before: 'text-inverted #000 与 primary-foreground #fff 方向相反',
      after: '单值 --ds-text-on-solid；旧名只作别名',
      target: '一个语义一个值',
      residual: '无。',
    },
  ]

  return rows
}
