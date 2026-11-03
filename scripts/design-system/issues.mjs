/**
 * 问题清单与未决项。
 *
 * 数值一律从抽取结果里取（`contrast` / `colorByName` / `unreferenced`），
 * 不在这里手抄，避免文档与实现漂移。
 */

const ratioOf = (contrast, id, mode) => {
  const pair = contrast.find(item => item.id === id)
  return pair ? pair[mode].ratio : null
}

const passOf = (contrast, id, mode) => {
  const pair = contrast.find(item => item.id === id)
  return pair ? pair[mode].pass : null
}

const fmt = value => (value === null || value === undefined ? '?' : String(value))

const hexOf = (colorByName, token, mode) => colorByName[token]?.[mode]?.hex ?? '?'

export const buildIssues = context => {
  const { loc, colorByName, contrast, unreferenced, undeclaredRefs, cssUndeclared, typography, radii, spacing, zIndex, literalColorSites } = context

  const inputBoundary = ratioOf(contrast, 'input-boundary/card', 'light')
  const placeholder = ratioOf(contrast, 'input-placeholder/input', 'light')
  const placeholderDark = ratioOf(contrast, 'input-placeholder/input', 'dark')
  const quaternary = ratioOf(contrast, 'text-quaternary/card', 'light')
  const quaternaryDark = ratioOf(contrast, 'text-quaternary/card', 'dark')
  const tertiaryBody = ratioOf(contrast, 'text-tertiary/body', 'light')
  const tertiaryInset = ratioOf(contrast, 'text-tertiary/inset', 'light')
  const successText = ratioOf(contrast, 'text-success/card', 'light')
  const warningText = ratioOf(contrast, 'text-warning/card', 'light')
  const badgeSuccess = ratioOf(contrast, 'badge-success', 'light')
  const badgeWarning = ratioOf(contrast, 'badge-warning', 'light')
  const badgeInfo = ratioOf(contrast, 'badge-info', 'light')
  const badgeDestructive = ratioOf(contrast, 'badge-destructive', 'light')
  const destructiveButton = ratioOf(contrast, 'btn-destructive-text/card', 'light')
  const moduleBorder = ratioOf(contrast, 'module-border/card', 'light')
  const inputHoverBorder = ratioOf(contrast, 'input-border-hover/input', 'light')
  const darkInputBoundary = ratioOf(contrast, 'input-boundary/card', 'dark')
  const darkPlaceholder = placeholderDark

  const textPrimary = hexOf(colorByName, '--color-text-primary', 'light')
  const foreground = hexOf(colorByName, '--color-foreground', 'light')
  const textPrimaryDark = hexOf(colorByName, '--color-text-primary', 'dark')
  const foregroundDark = hexOf(colorByName, '--color-foreground', 'dark')

  const successVariants = ['--color-text-success', '--color-text-success-secondary', '--color-state-success-solid', '--color-success', '--color-util-colors-green-green-500']
  const warningVariants = ['--color-text-warning', '--color-text-warning-secondary', '--color-state-warning-solid', '--color-warning']
  const destructiveVariants = ['--color-text-destructive', '--color-state-destructive-solid', '--color-destructive']

  const offGrid = spacing.filter(item => !item.onFourGrid)
  const halfSteps = spacing.filter(item => item.step % 1 !== 0)

  return [
    {
      id: 'DS-001',
      severity: 'P0',
      category: '对比度 · 控件边界',
      title: '输入框静止态没有可见边界',
      evidence: `packages/console/source/components/ui/input.tsx:15,17（border-transparent；hover 边框才显形）+ ${loc('--color-components-input-bg-normal')} / ${loc('--color-components-input-border-hover')}`,
      impact: `输入底叠在白卡上实测 ${fmt(inputBoundary)}:1（暗色 ${fmt(darkInputBoundary)}:1），低于非文字控件要求的 3:1。页面里输入框只剩占位符提示位置，低视力或强光下找不到控件。`,
      fix: '补一个静止态描边 token（与卡片 ≥3:1），或用更深的输入底；暗色同步。不要只靠 placeholder 承担定位。',
    },
    {
      id: 'DS-002',
      severity: 'P0',
      category: '对比度 · 文本',
      title: '输入框占位符对比度不足',
      evidence: `packages/console/source/components/ui/input.tsx:16 + ${loc('--color-components-input-text-placeholder')}`,
      impact: `占位符在输入底上亮色 ${fmt(placeholder)}:1、暗色 ${fmt(darkPlaceholder)}:1，均低于正文 4.5:1。占位符是用户判断“这里填什么”的唯一线索。`,
      fix: '把 placeholder 提到与三级文本同档并实测 ≥4.5:1；若只想做“淡提示”，应同时提供可见 label。',
    },
    {
      id: 'DS-003',
      severity: 'P0',
      category: '对比度 · 文本',
      title: '四级文本被当作可读文本使用',
      evidence: `${loc('--color-text-quaternary')} + packages/console/source/components/ui/empty-state.tsx:27、packages/console/source/components/ui/table.tsx:58（行分隔语境）`,
      impact: `四级文本亮色 ${fmt(quaternary)}:1、暗色 ${fmt(quaternaryDark)}:1，低于 4.5:1；它被用于时间戳、空值占位与空态图标，属于要读的信息而不是装饰。`,
      fix: '正文/时间戳改用三级文本，或把 quaternary 加深到 ≥4.5:1；仅图标与分隔符保留低对比并改名表达“装饰”。',
    },
    {
      id: 'DS-004',
      severity: 'P1',
      category: '对比度 · 文本',
      title: '三级文本在凹槽/页面底上只剩临界余量',
      evidence: `${loc('--color-text-tertiary')} + packages/console/source/components/ui/table.tsx:45（tfoot bg-inset）`,
      impact: `三级文本对白卡达标，但对页面底 ${fmt(tertiaryBody)}:1、对凹槽 ${fmt(tertiaryInset)}:1。凹槽上的 4.22 已低于 4.5；页面底的 4.56 只剩 0.06 余量，任何一次调色都会跌破。`,
      fix: '页面级说明文字改用二级文本；三级文本按最深的背景（凹槽）校准到 ≥4.5:1，而不是只对白卡校准。',
    },
    {
      id: 'DS-026',
      severity: 'P0',
      category: '对比度 · 状态文本',
      title: '成功/警告文本在白卡上不达标',
      evidence: `${loc('--color-text-success')} / ${loc('--color-text-warning')} + packages/console/source/components/metric-card.tsx:30、packages/console/source/components/form-kit.tsx:35`,
      impact: `成功文本 ${fmt(successText)}:1、警告文本 ${fmt(warningText)}:1（亮色，阈值 4.5），用于指标卡涨跌、表单校验提示与复制成功反馈。暗色反而达标（5.98 / 7.02），说明亮色档单独偏浅。`,
      fix: '把亮色 success/warning 文本各加深一档（保持与实心色同色相），或用 500/600 两档分别承担“实心/文字”。',
    },
    {
      id: 'DS-005',
      severity: 'P0',
      category: '对比度 · 状态徽标',
      title: '11px 状态徽标文本有未达标档位',
      evidence: `packages/console/source/components/ui/badge.tsx:8,21-23 + ${loc('--color-text-success')} / ${loc('--color-text-warning')} / ${loc('--color-text-destructive')} / ${loc('--color-info')}`,
      impact: `success ${fmt(badgeSuccess)}:1、warning ${fmt(badgeWarning)}:1、info ${fmt(badgeInfo)}:1、destructive ${fmt(badgeDestructive)}:1（亮色，阈值 4.5）。徽标是 11px 小字，达标线没有“大字号”折扣。`,
      fix: '为状态徽标单独取更深的文本档（或加深底 tint），并补齐 `--color-text-info`；不要直接用实心状态色当文字色。',
    },
    {
      id: 'DS-006',
      severity: 'P1',
      category: '一致性 · 文本主色',
      title: '“主文本”有两个值：foreground 与 text-primary',
      evidence: `${loc('--color-foreground')} / ${loc('--color-text-primary')}`,
      impact: `亮色 ${foreground} vs ${textPrimary}，暗色 ${foregroundDark} vs ${textPrimaryDark}。两套 token 都表示最高层级文本，页面标题与正文并排时会呈现轻微冷暖差；主题切换时两套各自变化，无法用一个值校准。`,
      fix: '保留一套作为唯一主文本 token，另一套改成别名（相同的值），或明确分层（正文 vs 标题）并写进规范。',
    },
    {
      id: 'DS-007',
      severity: 'P1',
      category: '一致性 · 中性色族',
      title: '纯灰与蓝灰两套中性色并存',
      evidence: `${loc('--color-text-secondary')}（#354052 蓝灰）vs ${loc('--color-background-body')}（#f2f4f7）；HSL 侧 ${loc('--color-sidebar')}（0 0%）`,
      impact: '卡片/画布/侧栏来自纯灰 HSL 阶梯，文本/边框/状态来自蓝灰（Untitled UI 系）。同一屏里“灰”有两种色相，深浅台阶也不是同一条曲线。',
      fix: '选一套作为基准色族（建议保留蓝灰，纯灰只做过渡别名），把背景/边框/文本的台阶重排到同一色相与同一明度序列。',
    },
    {
      id: 'DS-008',
      severity: 'P1',
      category: '一致性 · 状态色',
      title: '成功/警告/危险各有 3-5 个“同角色”色值',
      evidence: `success: ${successVariants.map(token => `${token}=${hexOf(colorByName, token, 'light')}`).join(' / ')}；warning: ${warningVariants.map(token => hexOf(colorByName, token, 'light')).join(' / ')}；destructive: ${destructiveVariants.map(token => hexOf(colorByName, token, 'light')).join(' / ')}（声明行 ${loc('--color-text-success')} / ${loc('--color-text-warning')} / ${loc('--color-text-destructive')}）`,
      impact: '同一语义在文本、实心、浅底、图表中取不同红/绿/黄，跨组件并排时能看出色差；对比度也随所选档位漂移。',
      fix: '每个状态定义一条色阶（text / solid / tint / border），组件只能引用角色档位，不允许直接拿 solid 当 text。',
    },
    {
      id: 'DS-009',
      severity: 'P1',
      category: '完整性 · 状态族缺档',
      title: 'info 没有文本档，直接拿实心色当文字',
      evidence: `packages/console/source/components/ui/badge.tsx:23 + packages/console/source/pages/request-logs/components/request-log-detail-row.tsx:86 + ${loc('--color-info')}`,
      impact: 'success/warning 有 `--color-text-*`，info 缺 `--color-text-info`，于是 `text-info` 解析成实心蓝。状态族不对称，新增组件时只能复制这个例外。',
      fix: '补 `--color-text-info`（与 success/warning 同档对比度）与 `--color-info-border`，徽标改用文本档。',
    },
    {
      id: 'DS-010',
      severity: 'P1',
      category: '可访问性 · 焦点',
      title: '焦点指示器有四套写法',
      evidence: `${loc('--color-ring')}（base 的 1px outline）/ packages/console/source/components/ui/button.tsx:8（ring-2 state-accent-solid）/ packages/console/source/components/ui/select.tsx:48（focus:bg 改底色）/ packages/console/source/components/ui/input.tsx:18（focus:border 改边框，使用 ${loc('--color-components-input-border-active')}）`,
      impact: '键盘用户在不同控件上看到不同宽度、不同颜色、不同位置的焦点；输入框聚焦时甚至只改底色，没有可见环。',
      fix: '统一一个 `--focus-ring-width` / `--focus-ring-color` / `--focus-ring-offset` 三件套，所有可聚焦控件只引用它；底色变化作为附加而不是替代。',
    },
    {
      id: 'DS-011',
      severity: 'P1',
      category: '可访问性 · 动效降级',
      title: '动效降级只覆盖了少数动画',
      evidence: 'packages/console/source/components/ui/skeleton.tsx:7（animate-pulse 无降级）/ packages/console/source/components/ui/dialog.tsx:71（Radix data-open 动画无降级）/ packages/console/source/styles/index.css:698-711（只有 pulse 与 log-row 有 reduced-motion）',
      impact: '开启“减少动态效果”的用户仍会看到骨架呼吸、浮层缩放、列表滑入；前庭敏感用户无法关闭。',
      fix: '在 base 层统一 `@media (prefers-reduced-motion: reduce)` 关闭 animation/transition（保留 opacity 的即时切换），并为 Skeleton 提供静态占位样式。',
    },
    {
      id: 'DS-012',
      severity: 'P1',
      category: '视觉 · 空态',
      title: '空态容器的虚线边框没有宽度，实际不渲染',
      evidence: 'packages/console/source/components/ui/empty.tsx:10（`border-dashed`，无 `border` / `border-*` 宽度）',
      impact: 'Tailwind preflight 把所有元素 border-width 置 0；只写 border-style 不会画出线。空态因此变成一个没有边界的留白块，和“内容缺失”难以区分。',
      fix: '补 `border border-border`（或 `border-module-border`），并确认暗色下的对比度；若本来不想画边框，删掉 `border-dashed` 以免误导。',
    },
    {
      id: 'DS-013',
      severity: 'P1',
      category: '体系 · 层级',
      title: 'z-index 没有标度，浮层顺序靠数字大小猜',
      evidence: `z-index 使用值：${zIndex.map(item => `${item.value}(${item.count})`).join(' / ')}；packages/console/source/pages/overview/components/receipt-controls.tsx:78（z-70）高于 dialog 的 z-50`,
      impact: '没有“base / sticky / sidebar / overlay / modal / toast”的命名层，新增浮层只能比大小；z-70 的收据控件会盖住 z-50 的对话框。',
      fix: '在 `@theme` 定义 `--z-*` 六档并只允许引用 token；收据全屏场景单独一档（如 z-80）并在文档登记。',
    },
    {
      id: 'DS-014',
      severity: 'P1',
      category: '体系 · 圆角',
      title: '圆角刻度出现非整数与作用域覆写',
      evidence: `${radii.map(item => `${item.name}=${item.px}px`).join(' / ')}；packages/console/source/styles/index.css:880-903（workflow-ui-surface 覆写为 6/8/12/16）`,
      impact: 'xl=10px 与 2xl=10.8px 肉眼无差别却占两档；同一 `rounded-2xl` 在主界面是 10.8px、在工作流画布是 16px。组件无法预测“大圆角”到底多大。',
      fix: '把刻度收成整数阶（2/4/6/8/12/16），删除 10.8/13.2/15.6；工作流若必须还原上游，使用独立命名（`--radius-workflow-*`）而不是覆写通用类。',
    },
    {
      id: 'DS-015',
      severity: 'P2',
      category: '卫生 · 未引用 token',
      title: `${unreferenced.length} 个已声明 token 在源码里找不到引用`,
      evidence: unreferenced.slice(0, 12).map(token => loc(token)).join('；') + (unreferenced.length > 12 ? ` 等 ${unreferenced.length} 处` : ''),
      impact: '读者无法区分“预留的语义档”与“改名后忘了删的死 token”；守卫也无法判断新增 token 是否真的被使用。',
      fix: '逐个确认：删除死 token，或加 `reserved` 注释并进白名单；白名单必须写理由。',
    },
    {
      id: 'DS-016',
      severity: 'P2',
      category: '卫生 · 字面字号',
      title: '13px/12px 字号在 29 处绕过排版 utility',
      evidence: 'packages/console/source/components/ui/button.tsx:8、input.tsx:15、select.tsx:48、tabs.tsx:66、dropdown-menu.tsx:46 等',
      impact: '`system-sm-regular` 已经定义了 13px/16px，但组件直接写 `text-[13px] leading-4`。字号阶梯的权威从 token 变成散落的字面值，改一档要改几十处。',
      fix: '把组件里的字面字号替换为 `system-*` utility；确实需要新档位时先加到 `@utility` 再引用。',
    },
    {
      id: 'DS-017',
      severity: 'P2',
      category: '卫生 · 字面色值',
      title: '非插图场景仍有字面色值与影子',
      evidence: 'packages/console/source/components/layout.tsx:69（`shadow-[0_1px_3px_rgb(0_0_0/0.06)]`）/ packages/console/source/pages/overview/components/trend-chart.tsx:14-18（4 个系列色）/ packages/console/source/pages/overview/components/bill-content.tsx:92（印章 #e23f35）/ packages/console/source/pages/tray/page.tsx:88（窗口阴影）',
      impact: `共 ${literalColorSites.length} 处字面颜色出现点（含插图/注释）。非插图处无法跟随主题，也无法被对比度守卫覆盖；趋势图 5 条线里 1 条用 token、4 条用字面值。`,
      fix: '趋势图迁到 `--color-chart-*`（当前 0 引用）；主内容卡片删除影子或登记 `--shadow-*`；印章改用 destructive；托盘窗口影子保留为已登记例外。',
    },
    {
      id: 'DS-029',
      severity: 'P2',
      category: '卫生 · 死 token',
      title: 'tooltip 与 hover 阴影 token 声明了但没人用',
      evidence: `${loc('--color-components-tooltip-bg')} / ${loc('--shadow-card-hover')}`,
      impact: 'Tooltip 实际用 `bg-foreground`（反色黑底），白色 tooltip 底 token 从未生效；Card 也没有 hover 抬升，`shadow-card-hover` 是死档。规范里会写出“tooltip 是白底”“卡片可悬浮”的错误结论。',
      fix: '删除两个 token，或在实现里真正接上（tooltip 若要反色，就删白底 token 并改名为 `tooltip-inverse-*`）。',
    },
    {
      id: 'DS-018',
      severity: 'P2',
      category: '体系 · 阴影',
      title: '阴影只有卡片两档，其余用 Tailwind 默认值',
      evidence: `${loc('--shadow-card')} / ${loc('--shadow-card-hover')}；packages/console/source/components/model-test-panel.tsx:727（shadow-lg）、:1052（shadow-2xl）`,
      impact: '卡片有专门 token，浮层/面板却用 Tailwind 默认 lg/2xl；暗色只覆盖了 card，其他影子在暗色下仍是黑色重影，或干脆 shadow-none 靠边框。',
      fix: '定义 `--shadow-overlay` / `--shadow-panel` 两档并给暗色值；组件只允许引用这两档或 card 档。',
    },
    {
      id: 'DS-019',
      severity: 'P2',
      category: '体系 · 间距',
      title: '间距大量落在 2px 网格而不是 4/8 网格',
      evidence: `0.5(2px)×${spacing.find(item => item.step === 0.5)?.count ?? 0}、1.5(6px)×${spacing.find(item => item.step === 1.5)?.count ?? 0}、2.5(10px)×${spacing.find(item => item.step === 2.5)?.count ?? 0}、3.5(14px)×${spacing.find(item => item.step === 3.5)?.count ?? 0}；例：packages/console/source/components/ui/tabs.tsx:66（gap-1.5 / px-1.5 / py-0.5）、packages/console/source/components/ui/alert-dialog.tsx:76（gap-1.5）`,
      impact: `4px 网格上只有 ${spacing.filter(item => item.onFourGrid).length} 个刻度，另 ${offGrid.length} 个是 2px 半档（${halfSteps.map(item => item.step).join(' / ')}）。半档不是错，但没有登记为“hairline 例外”，无法机器校验，组件对齐只能靠人眼。`,
      fix: '明确两档网格：4px 主网格 + 2px 仅用于描边/图标内衬；把例外写进规范并让 lint 只允许白名单。',
    },
    {
      id: 'DS-020',
      severity: 'P2',
      category: '体系 · 字体',
      title: 'mono 字体声明了但没有随包提供',
      evidence: `${loc('--font-mono')} + package.json:54（只安装 「@fontsource-variable/geist」）`,
      impact: '`Source Code Pro` 未随应用分发；Linux 上回落到 DejaVu Sans Mono，代码块字宽、行高与 macOS 不一致，截图对比会出现“同一段代码换行不同”。',
      fix: '安装并引入 Geist Mono（与 sans 同族），或把 `ui-monospace` 放到声明首位并接受平台差异。',
    },
    {
      id: 'DS-021',
      severity: 'P2',
      category: '卫生 · 状态构造',
      title: '禁用态亮色用实色、暗色用 alpha，跨背景不一致',
      evidence: `${loc('--color-text-disabled')} + ${loc('--color-components-input-text-filled-disabled')}`,
      impact: '亮色禁用文本是固定 #d0d5dc；暗色是 30% alpha。禁用态虽豁免对比度，但同一条“禁用”规则在卡片、凹槽、浮层上会呈现不同深浅，暗色尤其明显。',
      fix: '两套都用 alpha 或都用实色，并固定在“对卡片”的基准上；文档写明禁用态不参与对比度门槛。',
    },
    {
      id: 'DS-022',
      severity: 'P2',
      category: '卫生 · 重复 token',
      title: '两个底色 token 在一种模式下与相邻档完全相同',
      evidence: `${loc('--color-background-default-subtle')}（暗色 #222225 = default）、${loc('--color-background-default-dodge')}（亮色 #ffffff = default）`,
      impact: '`subtle` 在暗色没有更“微妙的底”，`dodge` 在亮色没有“提亮”；调用方以为换了一档，实际颜色不变。',
      fix: '要么给出真实的相邻明度值，要么删除并在规范里说明该档不存在。',
    },
    {
      id: 'DS-023',
      severity: 'P2',
      category: '完整性 · 组件状态',
      title: 'Button 没有 loading 档，disabled 会连 spinner 一起变淡',
      evidence: 'packages/console/source/components/ui/button.tsx:29-39（只有尺寸档）+ packages/console/source/components/ui/spinner.tsx:9',
      impact: '加载中只能由调用方塞 Spinner；`disabled:opacity-50` 会把 spinner 与文字一起降到 50%，在浅底上几乎看不见，也没有 `aria-busy` 约定。',
      fix: '增加 `loading` prop（内部渲染 Spinner、设置 aria-busy、保留按钮宽度）；loading 态不要套用 disabled 的透明度。',
    },
    {
      id: 'DS-027',
      severity: 'P1',
      category: '一致性 · 浮层',
      title: '浮层有两套视觉：毛玻璃细边 vs 实底阴影',
      evidence: 'packages/console/source/components/ui/select.tsx:82、dropdown-menu.tsx:46、popover.tsx:31（0.5px 边 + blur + shadow-none）vs packages/console/source/components/ui/combobox.tsx:115（bg-popover + shadow-md + ring-1）',
      impact: '同一层级的浮层，Select/Dropdown/Popover 靠半透明毛玻璃，Combobox 靠实底与阴影；并排打开时高度、边界、背景都不同，暗色下毛玻璃还会透出下层文字。',
      fix: '选定一套浮层外观（建议统一到 `bg-components-panel-bg-blur` + 1px 边 + 一档 `--shadow-overlay`），Combobox 改为同一套。',
    },
    {
      id: 'DS-028',
      severity: 'P1',
      category: '完整性 · 页面底色',
      title: '页面底色 token 全部零引用，body 实际用侧栏色',
      evidence: `${loc('--color-background-body')}、${loc('--color-background-default')} 等 6 个 background token；packages/console/source/styles/index.css:691（body 使用 bg-sidebar）`,
      impact: '`background-body` 看起来是“页面底色”的权威 token，但 0 引用；页面实际底色来自 `--color-sidebar`（96% 纯灰）。读者会引错 token，且页面底色与侧栏永远同色，无法独立调整。',
      fix: '把 body 改为 `bg-background-body`，侧栏单独用 sidebar token；删除或改名其余未采用的 background-default 系列。',
    },
    {
      id: 'DS-024',
      severity: 'P3',
      category: '文档 · 漂移',
      title: '既有规格文档的行号与 token 计数已过期',
      evidence: 'apps/docs/specs/design/design-system-tokens.md:107-108（引用 index.css:64/66，实际为 65/67）',
      impact: '读者按行号跳转会落在 `@theme` 外；文档声称的 token 计数与当前抽取结果不一致，无法作为验收依据。',
      fix: '规格文档改为引用 token 名而非行号，或由本抽取脚本生成行号表；把计数交给 `tokens.generated.json`。',
    },
    {
      id: 'DS-025',
      severity: 'P3',
      category: '命名 · 语义',
      title: '`text-inverted` 与 `primary-foreground` 语义重叠',
      evidence: `${loc('--color-text-inverted')} + ${loc('--color-primary-foreground')}`,
      impact: '两者都表示“反色文本”，亮色一个 #000、一个 #fff，方向相反；调用方很难判断该用哪个。',
      fix: '删除 `text-inverted` 或在规范里定义它只用于“反色块上的文字”，并与 primary-foreground 保持同值。',
    },
  ].filter(Boolean)
}

export const buildOpenQuestions = ({ colorByName, spacing }) => ({
  unverified: [
    {
      item: '上游工作流设计系统的版本与来源',
      detail: 'index.css 注释称色板/排版“取自上游工作流编辑器”，仓库内没有 vendored 源或版本号；无法核对 6/8/12/16 圆角覆写是否仍与上游一致。',
      howToVerify: '找到上游包与 commit，或删除“逐字落地”表述。',
    },
    {
      item: '暗色四级文本的实际背景分布',
      detail: '抽取脚本按“对卡片”计算对比度；暗色下四级文本也出现在 canvas/inset/浮层上，未逐处实测。',
      howToVerify: '对每个使用点取实际父层背景重算，或统一限制在卡片上使用。',
    },
    {
      item: '系统字体在 Windows/Linux 的最终回落',
      detail: '本机 headless Chrome 只能验证容器内字体；`Source Code Pro`、`SF Mono` 在目标机器上是否存在未核实。',
      howToVerify: '在三平台各跑一次 document.fonts.check 与截图对比。',
    },
    {
      item: '图表配色的色盲可辨性',
      detail: `trend-chart 的 5 条系列里 4 条是字面色值（${['#0891b2', '#64748b', '#14b8a6', '#f59e0b'].join(' / ')}），未做 CVD 模拟；chart-1..5 目前 0 引用。`,
      howToVerify: '用 deuteranopia/protanopia 模拟，或直接采用已做无障碍校验的图表色板。',
    },
    {
      item: '触控目标在真机上的可点性',
      detail: '按钮最小档 h-6（24px）刚好等于 WCAG 2.5.8 的最小值；实际触摸热区、间距是否足够未在真机验证。',
      howToVerify: '在 iOS/Android 真机用 24px 图标按钮做点按测试。',
    },
    {
      item: '对比度计算的色彩空间',
      detail: '全部按 sRGB 相对亮度计算，未考虑 OS 级对比度增强、P3 广色域与半透明叠层的实际合成差异。',
      howToVerify: '在目标显示器与系统设置下抽样复核。',
    },
  ],
  decisions: [
    {
      item: '中性色族选哪一套',
      options: 'A. 蓝灰（#101828 系，现状文本/边框）为准，纯灰 HSL 降级别名；B. 纯灰为准，重做文本/边框；C. 保留双轨但明确分层。',
      why: '同一屏出现两种灰，且台阶曲线不同；不拍板就无法统一对比度基线。',
    },
    {
      item: '主文本 token 归并到哪一个',
      options: '`--color-foreground`（当前 #171717）或 `--color-text-primary`（当前 #101828）。',
      why: '两者都是“最高层级文本”，必须留一个权威值，另一个做别名。',
    },
    {
      item: '工作流圆角是否继续覆写通用刻度',
      options: 'A. 保留独立 `--radius-workflow-*`；B. 并入主刻度并接受与上游的视觉差；C. 整个画布隔离为独立主题。',
      why: '当前 `rounded-2xl` 在画布内外是 16px 与 10.8px 两个值，组件无法预测。',
    },
    {
      item: '是否为 info 补齐完整状态族',
      options: '补 `text-info` / `info-border` / `info-tint`，或把 info 降级为“仅实心提示”并禁止当文字。',
      why: '当前 badge 与请求详情直接拿实心 info 当文字，对比度与语义都不稳定。',
    },
    {
      item: '是否引入 Geist Mono',
      options: '随包引入（体积 +1 字体文件），或接受平台 mono 差异。',
      why: '代码块跨平台字宽不一致，影响截图对比与对齐。',
    },
    {
      item: '2px 半档是否合法化',
      options: 'A. 登记为 hairline 例外（描边/图标内衬）；B. 全部收敛到 4px；C. 只在密度更高的表格区允许。',
      why: `当前 ${spacing.filter(item => !item.onFourGrid).length} 个刻度落在 2px 网格，不登记就无法自动校验。`,
    },
    {
      item: '插图/导出场景的字面色值是否永久例外',
      options: 'A. 保留并登记（收据、账单导出、品牌 logo）；B. 抽成 `--color-illustration-*`。',
      why: '这些值不跟随主题是有理由的，但目前只存在于评论与旧文档，守卫无法区分“例外”与“漏改”。',
    },
    {
      item: 'z-index 是否 token 化',
      options: '定义六档（base/sticky/sidebar/overlay/modal/toast）并全量替换。',
      why: '当前 z-70 高于 dialog z-50，层级冲突只能靠读代码发现。',
    },
    {
      item: 'chart-1..5 保留还是删除',
      options: '迁移趋势图到 chart token，或删除 5 个死 token。',
      why: '声明了 5 个图表色但 0 引用，趋势图另有一套字面色。',
    },
  ],
})
