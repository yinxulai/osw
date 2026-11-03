/**
 * v2 token 定义。
 *
 * 结构只有三层，任何组件只能消费「语义角色」，不能直接消费「色阶」：
 *
 *   色阶（primitive） → 语义角色（semantic） → 组件别名（compat）
 *
 * 色阶职责写死：1–2 底、3–5 组件态、6–8 边框、9–10 实心、11–12 文本。
 * 状态族没有 12 阶：它只需要 surface / border / text / solid 四个角色，
 * 多出来的档位正是 v1 里「同一个绿色有 5 个值」的来源。
 */
import { hex, mix, token } from './color.mjs'

export const HUE_NEUTRAL = 262
export const HUE_BRAND = 262.44

const NEUTRAL_STEPS = [
  [0.985, 0.002],
  [0.966, 0.004],
  [0.945, 0.006],
  [0.918, 0.008],
  [0.882, 0.01],
  [0.83, 0.012],
  [0.75, 0.016],
  [0.62, 0.022],
  [0.53, 0.018],
  [0.43, 0.018],
  [0.28, 0.012],
  [0.18, 0.008],
]

const BRAND_STEPS = [
  [0.985, 0.012],
  [0.96, 0.024],
  [0.93, 0.045],
  [0.89, 0.075],
  [0.84, 0.11],
  [0.78, 0.145],
  [0.7, 0.19],
  [0.62, 0.225],
  [0.5397, 0.2501],
  [0.48, 0.225],
  [0.42, 0.19],
  [0.35, 0.16],
]

export const neutral = NEUTRAL_STEPS.map(([l, c], index) => token(`neutral-${index + 1}`, l, c, HUE_NEUTRAL, {
  layer: 'primitive',
  family: 'neutral',
  step: index + 1,
  allowed: index <= 1
    ? '页面底、卡片底；只能作为 surface 角色被消费'
    : index <= 4
      ? '组件 hover / active / selected 等瞬时态；不得当文字色'
      : index <= 7
        ? '边框、分隔线、焦点外圈；6 为弱收边，7 为常规边框，8 为控件边界'
        : index <= 9
          ? '实心填充（主按钮、开关轨道）；9 为常态，10 为 hover'
          : '文本；11 为次级，12 为主文本。不得用于大面积填充',
  forbidden: index <= 7 ? '文本色、图标主色、大块填充' : index <= 9 ? '正文文本、卡片底' : '填充、边框',
  threshold: index <= 7 ? '作为控件边界时 ≥ 3:1' : index <= 9 ? '与 on-solid 文本 ≥ 4.5:1' : '对承载底 ≥ 4.5:1',
}))

export const brand = BRAND_STEPS.map(([l, c], index) => token(`brand-${index + 1}`, l, c, HUE_BRAND, {
  layer: 'primitive',
  family: 'brand',
  step: index + 1,
  allowed: index <= 1
    ? '品牌浅底；只作 surface 角色'
    : index <= 4
      ? '品牌 hover/active/选中态、暗色文本；不得当大面积填充'
      : index <= 7
        ? '品牌边框、焦点外圈；6 为细边，8 为强边'
        : index <= 9
          ? '品牌实心；9 为常态，10 为 hover'
          : '品牌文本；11 为亮色文本，12 为暗色品牌底',
  forbidden: index <= 4 ? '正文文本、主按钮实心' : index <= 7 ? '正文文本、大面积填充' : index <= 9 ? '正文文本（除大字号）' : '填充、边框',
  threshold: index <= 7 ? '作为边框/焦点时 ≥ 3:1' : index <= 9 ? '与 on-solid 文本 ≥ 4.5:1' : '对承载底 ≥ 4.5:1',
}))

const byStep = (list, step) => list.find(item => item.step === step)

export const neutralStep = step => byStep(neutral, step)
export const brandStep = step => byStep(brand, step)

/* -------------------------------------------------------------------------- */
/* 状态族：只保留四个角色，色相沿用 v1 的实现色                                  */
/* -------------------------------------------------------------------------- */

const STATUS = {
  success: { h: 155.2, c: 0.143, lightText: 0.5, lightSolid: 0.53, darkText: 0.74, darkSolid: 0.7, darkC: 0.16, onSolid: '#ffffff', darkOnSolid: '#08130f' },
  warning: { h: 62.1, c: 0.17, lightText: 0.55, lightSolid: 0.747, darkText: 0.78, darkSolid: 0.747, darkC: 0.17, onSolid: '#1a1200', darkOnSolid: '#1a1200' },
  danger: { h: 29.5, c: 0.209, lightText: 0.53, lightSolid: 0.576, darkText: 0.74, darkSolid: 0.576, darkC: 0.209, onSolid: '#ffffff', darkOnSolid: '#ffffff' },
  info: { h: 252.2, c: 0.146, lightText: 0.5, lightSolid: 0.55, darkText: 0.74, darkSolid: 0.68, darkC: 0.15, onSolid: '#ffffff', darkOnSolid: '#06131f' },
}

const statusOf = (family, mode) => {
  const spec = STATUS[family]
  const surface = mode === 'light'
    ? token(`${family}-surface`, 0.965, 0.022, spec.h)
    : token(`${family}-surface`, 0.3, 0.045, spec.h)
  const border = mode === 'light'
    ? token(`${family}-border`, 0.86, 0.06, spec.h)
    : token(`${family}-border`, 0.46, 0.07, spec.h)
  const text = mode === 'light'
    ? token(`${family}-text`, spec.lightText, spec.c, spec.h)
    : token(`${family}-text`, spec.darkText, spec.darkC, spec.h)
  const solid = mode === 'light'
    ? token(`${family}-solid`, spec.lightSolid, spec.c, spec.h)
    : token(`${family}-solid`, spec.darkSolid, spec.darkC, spec.h)
  const onSolid = mode === 'light' ? spec.onSolid : spec.darkOnSolid
  return { surface, border, text, solid, onSolid }
}

export const statusRoles = {
  light: Object.fromEntries(Object.keys(STATUS).map(family => [family, statusOf(family, 'light')])),
  dark: Object.fromEntries(Object.keys(STATUS).map(family => [family, statusOf(family, 'dark')])),
}

/* -------------------------------------------------------------------------- */
/* 语义角色                                                                    */
/* -------------------------------------------------------------------------- */

const N = step => neutralStep(step).hex
const B = step => brandStep(step).hex

const role = (name, hexValue, meta) => ({ name, hex: hexValue, layer: 'semantic', ...meta })

const light = {
  'surface-base': role('surface-base', N(2), {
    allowed: '应用页面底、内容画布；body / main 的唯一底色',
    forbidden: '卡片、浮层、按钮底',
    threshold: '其上的 11–12 阶文本 ≥ 4.5:1',
  }),
  'surface-raised': role('surface-raised', N(1), {
    allowed: '卡片、表格容器、对话框内容面',
    forbidden: '页面底（会造成层级反转）',
    threshold: '其上的 11–12 阶文本 ≥ 4.5:1',
  }),
  'surface-sunken': role('surface-sunken', N(3), {
    allowed: '凹槽、表尾、输入框底、侧栏',
    forbidden: '卡片底、浮层底；嵌套链只允许一层凹槽',
    threshold: '其上的 11–12 阶文本 ≥ 4.5:1',
  }),
  'surface-hover': role('surface-hover', N(4), {
    allowed: '行 hover、列表项 hover、次级按钮 hover',
    forbidden: '静止态底色、文本色',
    threshold: '其上文本 ≥ 4.5:1',
  }),
  'surface-active': role('surface-active', N(5), {
    allowed: '按下态、选中态、开关轨道',
    forbidden: '大面积静态底',
    threshold: '其上文本 ≥ 4.5:1',
  }),
  'border-subtle': role('border-subtle', N(6), {
    allowed: '卡片收边、表格分隔线、静态装饰线',
    forbidden: '输入框/复选框等需要 3:1 的控件边界',
    threshold: '装饰用途，不设硬阈值；不得单独承担控件可辨识性',
  }),
  border: role('border', N(7), {
    allowed: '常规边框、浮层外圈、分隔线',
    forbidden: '文本、填充',
    threshold: '装饰用途不设阈值；控件边界改用 border-strong',
  }),
  'border-strong': role('border-strong', N(8), {
    allowed: '输入框、Select、Checkbox、Switch 等控件边界；卡片选中边',
    forbidden: '正文文本、大面积填充',
    threshold: '与相邻表面 ≥ 3:1（R-02）',
  }),
  solid: role('solid', N(9), {
    allowed: '主按钮、开关选中轨道、中性实心标记',
    forbidden: '正文文本、卡片底',
    threshold: '与 on-solid 文本 ≥ 4.5:1',
  }),
  'solid-hover': role('solid-hover', N(10), {
    allowed: '主按钮 hover',
    forbidden: '静止态、文本',
    threshold: '与 on-solid 文本 ≥ 4.5:1',
  }),
  'on-solid': role('on-solid', N(1), {
    allowed: '实心填充上的文字与图标',
    forbidden: '普通表面上的正文（应使用 text-primary）',
    threshold: '对 solid / solid-hover ≥ 4.5:1',
  }),
  'text-primary': role('text-primary', N(12), {
    allowed: '标题、正文、表格主列',
    forbidden: '大面积填充、边框',
    threshold: '对 base / raised / sunken / hover ≥ 4.5:1',
  }),
  'text-secondary': role('text-secondary', N(11), {
    allowed: '说明、时间戳、表头、次级标签；三级文本统一并入此档',
    forbidden: '标题（用 text-primary）；装饰图标（用 text-decorative）',
    threshold: '对 base / raised / sunken / hover ≥ 4.5:1',
  }),
  'text-tertiary': role('text-tertiary', N(11), {
    allowed: '兼容别名：等同于 text-secondary。层级靠字号/字重，不靠继续降对比度',
    forbidden: '不得再声明更浅的“四级文本”',
    threshold: '对 base / raised / sunken ≥ 4.5:1',
  }),
  'text-placeholder': role('text-placeholder', mix(N(11), N(3), 0.72), {
    allowed: '仅输入框 placeholder；必须同时有可见 label 或 aria-label',
    forbidden: '正文、提示文案、禁用文本',
    threshold: '对 input-surface ≥ 4.5:1',
  }),
  'text-disabled': role('text-disabled', mix(N(7), N(1), 0.6), {
    allowed: '禁用控件的文字与图标；必须配合 disabled / aria-disabled',
    forbidden: '任何可交互文本',
    threshold: 'WCAG 1.4.3 豁免；仍要求与底可分辨（≥ 1.5:1）',
  }),
  'text-decorative': role('text-decorative', N(7), {
    allowed: '纯装饰图标、分隔符、空值点；不承载信息',
    forbidden: '正文、时间戳、空值说明、placeholder',
    threshold: '不设文字阈值；若承载信息则改用 text-secondary',
  }),
  'text-on-solid': role('text-on-solid', N(1), {
    allowed: 'solid / status-solid 上的文字',
    forbidden: '普通表面正文',
    threshold: '对 solid ≥ 4.5:1',
  }),
  'focus-ring': role('focus-ring', B(11), {
    allowed: '键盘焦点环；所有可聚焦控件共用',
    forbidden: '静态边框、装饰',
    threshold: '对相邻表面 ≥ 3:1（R-03）',
  }),
  'input-surface': role('input-surface', N(3), {
    allowed: 'Input / Select / Textarea 静止底',
    forbidden: '卡片、页面底',
    threshold: '与 input-border 组成控件边界',
  }),
  'input-surface-hover': role('input-surface-hover', N(4), {
    allowed: '输入控件 hover 底',
    forbidden: '静止态',
    threshold: '不单独承担边界',
  }),
  'input-border': role('input-border', N(8), {
    allowed: '输入控件静止边框；替代 v1 的 transparent',
    forbidden: '装饰线',
    threshold: '与卡片底 / 页面底 ≥ 3:1（R-02）',
  }),
  'input-border-hover': role('input-border-hover', N(9), {
    allowed: '输入控件 hover 边框',
    forbidden: '静止态',
    threshold: '与 input-surface-hover ≥ 3:1',
  }),
  'input-text': role('input-text', N(12), {
    allowed: '输入框已填文本',
    forbidden: 'placeholder',
    threshold: '对 input-surface ≥ 4.5:1',
  }),
  'overlay-surface': role('overlay-surface', N(1), {
    allowed: 'Dialog / Sheet / Popover / Select 内容面',
    forbidden: '卡片底、页面底',
    threshold: '其上文本 ≥ 4.5:1',
  }),
  'overlay-border': role('overlay-border', N(6), {
    allowed: '浮层外圈、浮层内分隔线',
    forbidden: '控件边界',
    threshold: '装饰；浮层与底之间还需 shadow 或明度差',
  }),
  'brand-surface': role('brand-surface', B(2), {
    allowed: '品牌浅底、选中项底色',
    forbidden: '正文底、大面积页面底',
    threshold: '其上 brand-text ≥ 4.5:1',
  }),
  'brand-surface-strong': role('brand-surface-strong', B(1), {
    allowed: '品牌浅底 hover',
    forbidden: '静止态',
    threshold: '其上 brand-text ≥ 4.5:1',
  }),
  'brand-border-subtle': role('brand-border-subtle', B(6), {
    allowed: '品牌弱边、选中卡片的次级收边（不承担控件边界）',
    forbidden: '输入框/复选框等需要 3:1 的控件边界',
    threshold: '装饰用途；控件边界用 brand-border',
  }),
  'brand-border': role('brand-border', B(8), {
    allowed: '品牌描边、选中卡片边',
    forbidden: '控件焦点环（用 focus-ring）',
    threshold: '与相邻表面 ≥ 3:1',
  }),
  'brand-border-strong': role('brand-border-strong', B(9), {
    allowed: '品牌强边、图表线',
    forbidden: '正文',
    threshold: '与相邻表面 ≥ 3:1',
  }),
  'brand-solid': role('brand-solid', B(9), {
    allowed: '品牌主按钮、品牌实心标记',
    forbidden: '正文文本',
    threshold: '与 brand-on-solid ≥ 4.5:1',
  }),
  'brand-solid-hover': role('brand-solid-hover', B(10), {
    allowed: '品牌主按钮 hover',
    forbidden: '静止态',
    threshold: '与 brand-on-solid ≥ 4.5:1',
  }),
  'brand-on-solid': role('brand-on-solid', '#ffffff', {
    allowed: 'brand-solid 上的文字',
    forbidden: '普通表面正文',
    threshold: '对 brand-solid / hover ≥ 4.5:1',
  }),
  'brand-text': role('brand-text', B(11), {
    allowed: '品牌链接、品牌说明文字',
    forbidden: '大面积填充',
    threshold: '对 base / raised ≥ 4.5:1',
  }),
  'brand-text-muted': role('brand-text-muted', B(10), {
    allowed: '品牌次要文字、图标',
    forbidden: '正文主体',
    threshold: '对 base / raised ≥ 4.5:1',
  }),
  'chart-1': role('chart-1', B(8), { allowed: '图表系列 1', forbidden: '文本', threshold: '与卡片底 ≥ 3:1（图形对象）' }),
  'chart-2': role('chart-2', statusOf('success', 'light').solid.hex, { allowed: '图表系列 2', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-3': role('chart-3', statusOf('warning', 'light').text.hex, { allowed: '图表系列 3', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-4': role('chart-4', statusOf('info', 'light').solid.hex, { allowed: '图表系列 4', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-5': role('chart-5', statusOf('danger', 'light').solid.hex, { allowed: '图表系列 5', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
}

const dark = {
  'surface-base': role('surface-base', N(12), { allowed: '应用页面底、内容画布', forbidden: '卡片、浮层', threshold: '其上的 11–12 阶文本 ≥ 4.5:1' }),
  'surface-raised': role('surface-raised', N(11), { allowed: '卡片、表格容器、对话框内容面', forbidden: '页面底', threshold: '其上的 11–12 阶文本 ≥ 4.5:1' }),
  'surface-sunken': role('surface-sunken', N(12), { allowed: '凹槽、输入框底、侧栏', forbidden: '卡片底；嵌套链只允许一层凹槽', threshold: '其上的 11–12 阶文本 ≥ 4.5:1' }),
  'surface-hover': role('surface-hover', N(10), { allowed: '行 hover、列表项 hover', forbidden: '静止态、文本', threshold: '其上文本 ≥ 4.5:1' }),
  'surface-active': role('surface-active', N(9), { allowed: '按下态、选中态', forbidden: '大面积静态底', threshold: '其上文本 ≥ 4.5:1' }),
  'border-subtle': role('border-subtle', N(10), { allowed: '卡片收边、表格分隔线', forbidden: '控件边界', threshold: '装饰；控件边界用 border-strong' }),
  border: role('border', N(9), { allowed: '常规边框、浮层外圈', forbidden: '文本、填充', threshold: '装饰；控件边界用 border-strong' }),
  'border-strong': role('border-strong', N(8), { allowed: '输入框、Select、Checkbox、Switch 边界', forbidden: '正文文本', threshold: '与相邻表面 ≥ 3:1' }),
  solid: role('solid', N(2), { allowed: '主按钮、开关选中轨道', forbidden: '正文、卡片底', threshold: '与 on-solid 文本 ≥ 4.5:1' }),
  'solid-hover': role('solid-hover', N(3), { allowed: '主按钮 hover', forbidden: '静止态', threshold: '与 on-solid 文本 ≥ 4.5:1' }),
  'on-solid': role('on-solid', N(12), { allowed: '实心填充上的文字与图标', forbidden: '普通表面正文', threshold: '对 solid / solid-hover ≥ 4.5:1' }),
  'text-primary': role('text-primary', N(1), { allowed: '标题、正文、表格主列', forbidden: '填充、边框', threshold: '对 base / raised / sunken / hover ≥ 4.5:1' }),
  'text-secondary': role('text-secondary', N(2), { allowed: '说明、时间戳、表头、次级标签；三级文本并入此档', forbidden: '标题、装饰图标', threshold: '对 base / raised / sunken / hover ≥ 4.5:1' }),
  'text-tertiary': role('text-tertiary', N(2), { allowed: '兼容别名：等同 text-secondary', forbidden: '再声明更浅的四级文本', threshold: '对 base / raised / sunken ≥ 4.5:1' }),
  'text-placeholder': role('text-placeholder', mix(N(2), N(12), 0.72), { allowed: '仅输入框 placeholder；需配 label', forbidden: '正文、提示、禁用文本', threshold: '对 input-surface ≥ 4.5:1' }),
  'text-disabled': role('text-disabled', mix(N(9), N(12), 0.6), { allowed: '禁用控件文字；需 disabled / aria-disabled', forbidden: '可交互文本', threshold: '豁免；仍要求 ≥ 1.5:1' }),
  'text-decorative': role('text-decorative', N(9), { allowed: '纯装饰图标、分隔符', forbidden: '正文、时间戳、空值说明', threshold: '不设文字阈值；承载信息则用 text-secondary' }),
  'text-on-solid': role('text-on-solid', N(12), { allowed: 'solid 上的文字', forbidden: '普通表面正文', threshold: '对 solid ≥ 4.5:1' }),
  'focus-ring': role('focus-ring', B(3), { allowed: '键盘焦点环；全控件共用', forbidden: '静态边框、装饰', threshold: '对相邻表面 ≥ 3:1' }),
  'input-surface': role('input-surface', N(12), { allowed: 'Input / Select / Textarea 静止底', forbidden: '卡片、页面底', threshold: '与 input-border 组成控件边界' }),
  'input-surface-hover': role('input-surface-hover', N(11), { allowed: '输入控件 hover 底', forbidden: '静止态', threshold: '不单独承担边界' }),
  'input-border': role('input-border', N(8), { allowed: '输入控件静止边框', forbidden: '装饰线', threshold: '与卡片底 / 页面底 ≥ 3:1' }),
  'input-border-hover': role('input-border-hover', N(7), { allowed: '输入控件 hover 边框', forbidden: '静止态', threshold: '与 input-surface-hover ≥ 3:1' }),
  'input-text': role('input-text', N(1), { allowed: '输入框已填文本', forbidden: 'placeholder', threshold: '对 input-surface ≥ 4.5:1' }),
  'overlay-surface': role('overlay-surface', N(11), { allowed: 'Dialog / Sheet / Popover / Select 内容面', forbidden: '卡片底、页面底', threshold: '其上文本 ≥ 4.5:1' }),
  'overlay-border': role('overlay-border', N(8), { allowed: '浮层外圈、浮层内分隔线', forbidden: '控件边界', threshold: '装饰；浮层还需 shadow 或明度差' }),
  'brand-surface': role('brand-surface', B(12), { allowed: '品牌浅底、选中项底色', forbidden: '正文底', threshold: '其上 brand-text ≥ 4.5:1' }),
  'brand-surface-strong': role('brand-surface-strong', B(11), { allowed: '品牌浅底 hover', forbidden: '静止态', threshold: '其上 brand-text ≥ 4.5:1' }),
  'brand-border-subtle': role('brand-border-subtle', B(9), { allowed: '品牌弱边、选中卡片的次级收边', forbidden: '控件边界', threshold: '装饰用途' }),
  'brand-border': role('brand-border', B(7), { allowed: '品牌描边、选中卡片边', forbidden: '控件焦点环', threshold: '与相邻表面 ≥ 3:1' }),
  'brand-border-strong': role('brand-border-strong', B(6), { allowed: '品牌强边、图表线', forbidden: '正文', threshold: '与相邻表面 ≥ 3:1' }),
  'brand-solid': role('brand-solid', B(5), { allowed: '品牌主按钮、品牌实心标记', forbidden: '正文文本', threshold: '与 brand-on-solid ≥ 4.5:1' }),
  'brand-solid-hover': role('brand-solid-hover', B(4), { allowed: '品牌主按钮 hover', forbidden: '静止态', threshold: '与 brand-on-solid ≥ 4.5:1' }),
  'brand-on-solid': role('brand-on-solid', N(12), { allowed: 'brand-solid 上的文字', forbidden: '普通表面正文', threshold: '对 brand-solid / hover ≥ 4.5:1' }),
  'brand-text': role('brand-text', B(3), { allowed: '品牌链接、品牌说明文字', forbidden: '大面积填充', threshold: '对 base / raised ≥ 4.5:1' }),
  'brand-text-muted': role('brand-text-muted', B(4), { allowed: '品牌次要文字、图标', forbidden: '正文主体', threshold: '对 base / raised ≥ 4.5:1' }),
  'chart-1': role('chart-1', B(5), { allowed: '图表系列 1', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-2': role('chart-2', statusOf('success', 'dark').solid.hex, { allowed: '图表系列 2', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-3': role('chart-3', statusOf('warning', 'dark').solid.hex, { allowed: '图表系列 3', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-4': role('chart-4', statusOf('info', 'dark').solid.hex, { allowed: '图表系列 4', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
  'chart-5': role('chart-5', statusOf('danger', 'dark').solid.hex, { allowed: '图表系列 5', forbidden: '文本', threshold: '与卡片底 ≥ 3:1' }),
}

const statusRoleTokens = mode => {
  const out = {}
  for (const [family, roles] of Object.entries(statusRoles[mode])) {
    for (const [key, value] of Object.entries(roles)) {
      if (key === 'onSolid') {
        out[`${family}-on-solid`] = role(`${family}-on-solid`, value, {
          allowed: `${family}-solid 上的文字与图标`,
          forbidden: '普通表面正文',
          threshold: `对 ${family}-solid ≥ 4.5:1`,
        })
        continue
      }
      const suffix = key
      out[`${family}-${suffix}`] = role(`${family}-${suffix}`, value.hex, {
        oklch: value.oklch,
        l: value.l,
        c: value.c,
        h: value.h,
        allowed: suffix === 'surface'
          ? '状态徽标底、状态提示块底、状态行 hover 底'
          : suffix === 'border'
            ? '状态徽标边、提示块边'
            : suffix === 'text'
              ? '状态文字、徽标文字、校验提示'
              : '状态实心：Toast 图标底、危险按钮底',
        forbidden: suffix === 'text'
          ? '大面积填充、按钮底'
          : suffix === 'solid'
            ? '正文文本、页面底'
            : '正文文本',
        threshold: suffix === 'text'
          ? '对 card 与其自身 surface ≥ 4.5:1'
          : suffix === 'border'
            ? '与 card 与 surface ≥ 3:1'
            : suffix === 'solid'
              ? '与 on-solid ≥ 4.5:1'
              : '其上 text ≥ 4.5:1',
      })
    }
  }
  return out
}

export const roles = {
  light: { ...light, ...statusRoleTokens('light') },
  dark: { ...dark, ...statusRoleTokens('dark') },
}

/* -------------------------------------------------------------------------- */
/* v1 → v2 兼容别名                                                            */
/* -------------------------------------------------------------------------- */

export const aliases = {
  '--color-background': '--ds-surface-base',
  '--color-foreground': '--ds-text-primary',
  '--color-card': '--ds-surface-raised',
  '--color-card-foreground': '--ds-text-primary',
  '--color-canvas': '--ds-surface-base',
  '--color-popover': '--ds-overlay-surface',
  '--color-popover-foreground': '--ds-text-primary',
  '--color-primary': '--ds-solid',
  '--color-primary-foreground': '--ds-on-solid',
  '--color-secondary': '--ds-surface-hover',
  '--color-secondary-foreground': '--ds-text-primary',
  '--color-muted': '--ds-surface-sunken',
  '--color-muted-foreground': '--ds-text-secondary',
  '--color-accent': '--ds-surface-hover',
  '--color-accent-foreground': '--ds-text-primary',
  '--color-destructive': '--ds-danger-solid',
  '--color-destructive-foreground': '--ds-danger-on-solid',
  '--color-border': '--ds-border-subtle',
  '--color-input': '--ds-input-border',
  '--color-ring': '--ds-focus-ring',
  '--color-inset': '--ds-surface-sunken',
  '--color-sidebar': '--ds-surface-sunken',
  '--color-sidebar-foreground': '--ds-text-secondary',
  '--color-sidebar-primary': '--ds-solid',
  '--color-sidebar-primary-foreground': '--ds-on-solid',
  '--color-sidebar-accent': '--ds-surface-hover',
  '--color-sidebar-accent-foreground': '--ds-text-primary',
  '--color-sidebar-border': '--ds-border-subtle',
  '--color-sidebar-ring': '--ds-focus-ring',
  '--color-text-primary': '--ds-text-primary',
  '--color-text-secondary': '--ds-text-secondary',
  '--color-text-tertiary': '--ds-text-secondary',
  '--color-text-quaternary': '--ds-text-secondary',
  '--color-text-destructive': '--ds-danger-text',
  '--color-text-success': '--ds-success-text',
  '--color-text-warning': '--ds-warning-text',
  '--color-text-info': '--ds-info-text',
  '--color-text-disabled': '--ds-text-disabled',
  '--color-text-inverted': '--ds-text-on-solid',
  '--color-text-accent': '--ds-brand-text',
  '--color-text-accent-secondary': '--ds-brand-text-muted',
  '--color-text-success-secondary': '--ds-success-text',
  '--color-text-warning-secondary': '--ds-warning-text',
  '--color-success': '--ds-success-solid',
  '--color-success-foreground': '--ds-success-on-solid',
  '--color-warning': '--ds-warning-solid',
  '--color-warning-foreground': '--ds-warning-on-solid',
  '--color-info': '--ds-info-solid',
  '--color-info-foreground': '--ds-info-on-solid',
  '--color-module-border': '--ds-border-subtle',
  '--color-components-panel-bg': '--ds-overlay-surface',
  '--color-components-panel-bg-blur': '--ds-overlay-surface',
  '--color-components-panel-border': '--ds-overlay-border',
  '--color-components-tooltip-bg': '--ds-text-primary',
  '--color-components-input-bg-normal': '--ds-input-surface',
  '--color-components-input-bg-hover': '--ds-input-surface-hover',
  '--color-components-input-bg-active': '--ds-input-surface-hover',
  '--color-components-input-bg-disabled': '--ds-surface-hover',
  '--color-components-input-text-filled': '--ds-input-text',
  '--color-components-input-text-filled-disabled': '--ds-text-disabled',
  '--color-components-input-text-placeholder': '--ds-text-placeholder',
  '--color-components-input-border-hover': '--ds-input-border-hover',
  '--color-components-input-border-active': '--ds-input-border-hover',
  '--color-components-button-primary-bg': '--ds-solid',
  '--color-components-button-primary-bg-hover': '--ds-solid-hover',
  '--color-components-button-primary-text': '--ds-on-solid',
  '--color-components-button-primary-border': '--ds-border-subtle',
  '--color-components-button-secondary-bg': '--ds-surface-raised',
  '--color-components-button-secondary-bg-hover': '--ds-surface-hover',
  '--color-components-button-secondary-text': '--ds-text-secondary',
  '--color-components-button-secondary-accent-text': '--ds-brand-text',
  '--color-components-button-secondary-border': '--ds-border',
  '--color-components-button-secondary-border-hover': '--ds-border-strong',
  '--color-components-button-tertiary-bg': '--ds-surface-sunken',
  '--color-components-button-tertiary-bg-hover': '--ds-surface-hover',
  '--color-components-button-tertiary-text': '--ds-text-secondary',
  '--color-components-button-ghost-text': '--ds-text-secondary',
  '--color-components-button-ghost-bg-hover': '--ds-surface-hover',
  '--color-components-button-destructive-ghost-text': '--ds-danger-text',
  '--color-components-button-destructive-ghost-bg-hover': '--ds-danger-surface',
  '--color-state-base-hover': '--ds-surface-hover',
  '--color-state-base-hover-alt': '--ds-surface-active',
  '--color-state-base-active': '--ds-surface-active',
  '--color-state-base-handle': '--ds-border-strong',
  '--color-state-base-handle-hover': '--ds-border-strong',
  '--color-state-accent-solid': '--ds-focus-ring',
  '--color-state-accent-hover': '--ds-brand-surface',
  '--color-state-accent-active': '--ds-brand-surface',
  '--color-state-success-solid': '--ds-success-solid',
  '--color-state-warning-solid': '--ds-warning-solid',
  '--color-state-destructive-solid': '--ds-danger-solid',
  '--color-state-destructive-hover': '--ds-danger-surface',
  '--color-state-warning-hover': '--ds-warning-surface',
  '--color-chart-1': '--ds-chart-1',
  '--color-chart-2': '--ds-chart-2',
  '--color-chart-3': '--ds-chart-3',
  '--color-chart-4': '--ds-chart-4',
  '--color-chart-5': '--ds-chart-5',
  '--color-heat-0': '--ds-surface-sunken',
  '--color-heat-1': '--ds-success-surface',
  '--color-heat-2': '--ds-success-border',
  '--color-heat-3': '--ds-success-solid',
  '--color-heat-4': '--ds-success-text',
  '--color-workflow-block-bg': '--ds-surface-raised',
  '--color-workflow-block-bg-hover': '--ds-surface-hover',
  '--color-workflow-block-parma-bg': '--ds-surface-sunken',
  '--color-workflow-canvas-workflow-bg': '--ds-surface-base',
  '--color-workflow-link-line-normal': '--ds-border-strong',
  '--color-workflow-link-line-active': '--ds-brand-solid',
  '--color-workflow-link-line-error-active': '--ds-danger-solid',
  '--color-workflow-link-line-failure-active': '--ds-warning-solid',
  '--color-workflow-link-line-success-active': '--ds-success-solid',
}

/* -------------------------------------------------------------------------- */
/* 排版 / 间距 / 控件 / 圆角 / 阴影 / 层级 / 动效                               */
/* -------------------------------------------------------------------------- */

export const typography = {
  sizes: [
    { name: 'type-1', px: 12, lineHeight: 16, use: '徽标、Kbd、表格密集元信息', forbidden: '正文段落' },
    { name: 'type-2', px: 13, lineHeight: 20, use: '控件文字、次级正文', forbidden: '页面标题' },
    { name: 'type-3', px: 14, lineHeight: 20, use: '正文默认、表格正文', forbidden: '展示型标题' },
    { name: 'type-4', px: 16, lineHeight: 24, use: '区内标题、Dialog 标题', forbidden: '长正文' },
    { name: 'type-5', px: 20, lineHeight: 28, use: '页面标题', forbidden: '表格单元格' },
    { name: 'type-6', px: 24, lineHeight: 32, use: '首屏/空态主标题', forbidden: '控件内文字' },
  ],
  weights: [
    { name: 'regular', value: 400, use: '正文、输入值' },
    { name: 'medium', value: 500, use: '控件文字、表头、强调标签' },
    { name: 'semibold', value: 600, use: '标题、关键数字' },
  ],
  banned: [10, 11, 15, 17, 18, 22, 26, 28, 30, 32],
}

export const spacing = {
  steps: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
  exceptions: [
    { px: 1, use: '1px 描边（border / outline 宽度），不计入 spacing' },
    { px: 2, use: '焦点环 offset、图标光学内衬；必须用 --ds-focus-offset / --ds-icon-inset，不得写 gap-0.5' },
  ],
  forbidden: [6, 10, 14, 18, 22, 26, 30, 36, 44, 56],
}

export const controls = {
  heights: [
    { name: 'xs', px: 24, use: '密集表格内 icon 按钮；桌面指针限定' },
    { name: 'sm', px: 28, use: '工具栏、二次操作' },
    { name: 'md', px: 32, use: '默认表单控件、默认按钮' },
    { name: 'lg', px: 36, use: '页头主操作、Dialog 主按钮' },
    { name: 'xl', px: 40, use: '触控/首屏 CTA' },
  ],
  touchMin: 44,
}

export const radii = [
  { name: 'xs', px: 2, use: 'Kbd、微型标记' },
  { name: 'sm', px: 4, use: 'Badge、Checkbox' },
  { name: 'md', px: 6, use: 'Button、Input、Select、Tabs' },
  { name: 'lg', px: 8, use: '小卡片、Toast' },
  { name: 'xl', px: 12, use: 'Card、Popover、Sheet' },
  { name: '2xl', px: 16, use: 'Dialog、全屏 Sheet' },
]

export const shadows = {
  card: {
    light: '0 1px 2px -1px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.06)',
    dark: '0 1px 2px -1px rgb(0 0 0 / 0.55), 0 2px 4px -2px rgb(0 0 0 / 0.4)',
  },
  overlay: {
    light: '0 8px 24px -8px rgb(16 24 40 / 0.18), 0 2px 6px -2px rgb(16 24 40 / 0.10)',
    dark: '0 8px 24px -8px rgb(0 0 0 / 0.65), 0 2px 6px -2px rgb(0 0 0 / 0.45)',
  },
  panel: {
    light: '0 1px 3px -1px rgb(16 24 40 / 0.10)',
    dark: '0 1px 3px -1px rgb(0 0 0 / 0.45)',
  },
}

export const zIndex = [
  { name: 'base', value: 0, use: '普通文档流' },
  { name: 'sticky', value: 10, use: '表头、页头 sticky' },
  { name: 'sidebar', value: 20, use: '应用侧栏' },
  { name: 'overlay', value: 30, use: 'Popover / Select / Dropdown / 收据控件' },
  { name: 'modal', value: 40, use: 'Dialog / Sheet / Drawer' },
  { name: 'toast', value: 50, use: 'Toast，永远最上层' },
]

export const motion = [
  { name: 'fast', ms: 100, use: '颜色、hover' },
  { name: 'base', ms: 150, use: '浮层淡入、焦点' },
  { name: 'slow', ms: 200, use: '侧栏宽度、Sheet' },
  { name: 'deliberate', ms: 300, use: '页面级转场' },
]

export const tokenCount = () =>
  neutral.length + brand.length + Object.keys(roles.light).length + Object.keys(aliases).length
