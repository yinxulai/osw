# osw Design System v2

> 这不是 v1 的补丁说明，而是一版重新收敛的设计系统本体：token 架构、组件规范、可交互预览、迁移映射与守卫测试。**本轮不修改运行时页面与组件源码**；`tokens.v2.css` 可直接在 `packages/console/source/styles/index.css` 之后导入。

预览页：[`index.html`](./index.html)（深色优先、明暗可切、零外部依赖，可直接双击打开）。

## 0. 一句话结论

- v1 的 29 条问题全部逐条处置：**5 P0 / 12 P1 / 10 P2 / 2 P3**，没有静默消失。
- 对比度断言：**106/106 通过**；不达标的行会被守卫测试直接判红。
- v2 共 **197** 个声明 token：12 中性阶 + 12 品牌阶 + 61 语义角色/主题 + 112 个 v1 兼容别名。
- 44 个 v1 零引用 token 全部不进入 v2；白名单 **0**。
- 16 个组件 × 7 状态全部登记；N/A 写明原因，不用近似状态冒充。

## 1. 验证方式

```bash
node scripts/design-system/build-v2.mjs            # 生成 tokens.v2.css / index.html / README.md / v2.generated.json
node scripts/design-system/build-v2.mjs --check    # 只校验，不落盘
pnpm exec vitest run packages/console/source/design-system.guard.test.ts
```

守卫测试做七件事：

1. 生成物与源码逐字节一致；
2. 每一对「前景 × 承载底」按 hex 重算对比度，不达标即失败；
3. 每个 `var(...)` 引用都能找到声明；
4. 零未引用 token（白名单必须写理由，v2 为空）；
5. 字号 ≤ 6 档、字重 ≤ 3 档、行高成对；
6. 样式表组件用法不得出现字面色值（v2 覆盖层只允许在 token 定义区出现）；
7. 预览页自包含、问题收敛表 29 条齐全。

## 2. token 架构

```
Primitive（色阶） → Semantic（语义角色） → Compat（v1 别名）
neutral-1…12        surface / border / solid / text      --color-*
brand-1…12          brand / status / focus
```

### 2.1 角色职责

| 阶 | 职责 | 允许 | 不得 |
| --- | --- | --- | --- |
| 1–2 | 底 | 页面底、卡片底 | 文字、控件边 |
| 3–5 | 组件态 | hover / active / selected / 输入底 | 正文、卡片底 |
| 6–8 | 边框 | 收边 / 常规边 / 控件边界 | 文字、大面积填充 |
| 9–10 | 实心 | 主按钮、开关轨道 | 正文、卡片底 |
| 11–12 | 文本 | 次级 / 主文本 | 填充、边框 |

### 2.2 色阶

| 色阶 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | #f9fafb | #f2f4f6 | #ebedf1 | #e1e4e9 | #d4d8df | #c3c7cf | #a8aeb8 | #7f8794 | #666c77 | #4a505a | #26292f | #101215 |
| brand | #f6faff | #e9f2ff | #d8e9ff | #c0dcff | #a4cbff | #84b6ff | #5b99ff | #347aff | #085afc | #044bd9 | #073fb2 | #032f8c |

品牌色相沿用现有 `#085afc`（OKLCH `262.44`），step 9 就是它；没有换品牌色。中性色统一到 `hue 262`、最大彩度 `0.022`，消除 v1 的纯灰/蓝灰双轨。

### 2.3 语义角色（亮色 / 暗色）

| Token | 亮色 | 暗色 | 允许 | 不得 | 阈值 |
| --- | --- | --- | --- | --- | --- |
| `surface-base` | #f2f4f6 | #101215 | 应用页面底、内容画布；body / main 的唯一底色 | 卡片、浮层、按钮底 | 其上的 11–12 阶文本 ≥ 4.5:1 |
| `surface-raised` | #f9fafb | #26292f | 卡片、表格容器、对话框内容面 | 页面底（会造成层级反转） | 其上的 11–12 阶文本 ≥ 4.5:1 |
| `surface-sunken` | #ebedf1 | #101215 | 凹槽、表尾、输入框底、侧栏 | 卡片底、浮层底；嵌套链只允许一层凹槽 | 其上的 11–12 阶文本 ≥ 4.5:1 |
| `surface-hover` | #e1e4e9 | #4a505a | 行 hover、列表项 hover、次级按钮 hover | 静止态底色、文本色 | 其上文本 ≥ 4.5:1 |
| `surface-active` | #d4d8df | #666c77 | 按下态、选中态、开关轨道 | 大面积静态底 | 其上文本 ≥ 4.5:1 |
| `border-subtle` | #c3c7cf | #4a505a | 卡片收边、表格分隔线、静态装饰线 | 输入框/复选框等需要 3:1 的控件边界 | 装饰用途，不设硬阈值；不得单独承担控件可辨识性 |
| `border` | #a8aeb8 | #666c77 | 常规边框、浮层外圈、分隔线 | 文本、填充 | 装饰用途不设阈值；控件边界改用 border-strong |
| `border-strong` | #7f8794 | #7f8794 | 输入框、Select、Checkbox、Switch 等控件边界；卡片选中边 | 正文文本、大面积填充 | 与相邻表面 ≥ 3:1（R-02） |
| `solid` | #666c77 | #f2f4f6 | 主按钮、开关选中轨道、中性实心标记 | 正文文本、卡片底 | 与 on-solid 文本 ≥ 4.5:1 |
| `solid-hover` | #4a505a | #ebedf1 | 主按钮 hover | 静止态、文本 | 与 on-solid 文本 ≥ 4.5:1 |
| `on-solid` | #f9fafb | #101215 | 实心填充上的文字与图标 | 普通表面上的正文（应使用 text-primary） | 对 solid / solid-hover ≥ 4.5:1 |
| `text-primary` | #101215 | #f9fafb | 标题、正文、表格主列 | 大面积填充、边框 | 对 base / raised / sunken / hover ≥ 4.5:1 |
| `text-secondary` | #26292f | #f2f4f6 | 说明、时间戳、表头、次级标签；三级文本统一并入此档 | 标题（用 text-primary）；装饰图标（用 text-decorative） | 对 base / raised / sunken / hover ≥ 4.5:1 |
| `text-tertiary` | #26292f | #f2f4f6 | 兼容别名：等同于 text-secondary。层级靠字号/字重，不靠继续降对比度 | 不得再声明更浅的“四级文本” | 对 base / raised / sunken ≥ 4.5:1 |
| `text-placeholder` | #5d6065 | #b3b5b7 | 仅输入框 placeholder；必须同时有可见 label 或 aria-label | 正文、提示文案、禁用文本 | 对 input-surface ≥ 4.5:1 |
| `text-disabled` | #c8ccd3 | #444850 | 禁用控件的文字与图标；必须配合 disabled / aria-disabled | 任何可交互文本 | WCAG 1.4.3 豁免；仍要求与底可分辨（≥ 1.5:1） |
| `text-decorative` | #a8aeb8 | #666c77 | 纯装饰图标、分隔符、空值点；不承载信息 | 正文、时间戳、空值说明、placeholder | 不设文字阈值；若承载信息则改用 text-secondary |
| `text-on-solid` | #f9fafb | #101215 | solid / status-solid 上的文字 | 普通表面正文 | 对 solid ≥ 4.5:1 |
| `focus-ring` | #073fb2 | #d8e9ff | 键盘焦点环；所有可聚焦控件共用 | 静态边框、装饰 | 对相邻表面 ≥ 3:1（R-03） |
| `input-surface` | #ebedf1 | #101215 | Input / Select / Textarea 静止底 | 卡片、页面底 | 与 input-border 组成控件边界 |
| `input-surface-hover` | #e1e4e9 | #26292f | 输入控件 hover 底 | 静止态 | 不单独承担边界 |
| `input-border` | #7f8794 | #7f8794 | 输入控件静止边框；替代 v1 的 transparent | 装饰线 | 与卡片底 / 页面底 ≥ 3:1（R-02） |
| `input-border-hover` | #666c77 | #a8aeb8 | 输入控件 hover 边框 | 静止态 | 与 input-surface-hover ≥ 3:1 |
| `input-text` | #101215 | #f9fafb | 输入框已填文本 | placeholder | 对 input-surface ≥ 4.5:1 |
| `overlay-surface` | #f9fafb | #26292f | Dialog / Sheet / Popover / Select 内容面 | 卡片底、页面底 | 其上文本 ≥ 4.5:1 |
| `overlay-border` | #c3c7cf | #7f8794 | 浮层外圈、浮层内分隔线 | 控件边界 | 装饰；浮层与底之间还需 shadow 或明度差 |
| `brand-surface` | #e9f2ff | #032f8c | 品牌浅底、选中项底色 | 正文底、大面积页面底 | 其上 brand-text ≥ 4.5:1 |
| `brand-surface-strong` | #f6faff | #073fb2 | 品牌浅底 hover | 静止态 | 其上 brand-text ≥ 4.5:1 |
| `brand-border-subtle` | #84b6ff | #085afc | 品牌弱边、选中卡片的次级收边（不承担控件边界） | 输入框/复选框等需要 3:1 的控件边界 | 装饰用途；控件边界用 brand-border |
| `brand-border` | #347aff | #5b99ff | 品牌描边、选中卡片边 | 控件焦点环（用 focus-ring） | 与相邻表面 ≥ 3:1 |
| `brand-border-strong` | #085afc | #84b6ff | 品牌强边、图表线 | 正文 | 与相邻表面 ≥ 3:1 |
| `brand-solid` | #085afc | #a4cbff | 品牌主按钮、品牌实心标记 | 正文文本 | 与 brand-on-solid ≥ 4.5:1 |
| `brand-solid-hover` | #044bd9 | #c0dcff | 品牌主按钮 hover | 静止态 | 与 brand-on-solid ≥ 4.5:1 |
| `brand-on-solid` | #ffffff | #101215 | brand-solid 上的文字 | 普通表面正文 | 对 brand-solid / hover ≥ 4.5:1 |
| `brand-text` | #073fb2 | #d8e9ff | 品牌链接、品牌说明文字 | 大面积填充 | 对 base / raised ≥ 4.5:1 |
| `brand-text-muted` | #044bd9 | #c0dcff | 品牌次要文字、图标 | 正文主体 | 对 base / raised ≥ 4.5:1 |
| `chart-1` | #347aff | #a4cbff | 图表系列 1 | 文本 | 与卡片底 ≥ 3:1（图形对象） |
| `chart-2` | #008345 | #2abb71 | 图表系列 2 | 文本 | 与卡片底 ≥ 3:1 |
| `chart-3` | #b45200 | #f7900a | 图表系列 3 | 文本 | 与卡片底 ≥ 3:1 |
| `chart-4` | #2273c3 | #4b9bf1 | 图表系列 4 | 文本 | 与卡片底 ≥ 3:1 |
| `chart-5` | #d92d20 | #d92d20 | 图表系列 5 | 文本 | 与卡片底 ≥ 3:1 |
| `success-surface` | #e9f8ed | #1a3524 | 状态徽标底、状态提示块底、状态行 hover 底 | 正文文本 | 其上 text ≥ 4.5:1 |
| `success-border` | #b3ddc0 | #356447 | 状态徽标边、提示块边 | 正文文本 | 与 card 与 surface ≥ 3:1 |
| `success-text` | #007a3d | #3dc87d | 状态文字、徽标文字、校验提示 | 大面积填充、按钮底 | 对 card 与其自身 surface ≥ 4.5:1 |
| `success-solid` | #008345 | #2abb71 | 状态实心：Toast 图标底、危险按钮底 | 正文文本、页面底 | 与 on-solid ≥ 4.5:1 |
| `success-on-solid` | #ffffff | #08130f | success-solid 上的文字与图标 | 普通表面正文 | 对 success-solid ≥ 4.5:1 |
| `warning-surface` | #fff1e5 | #3e2815 | 状态徽标底、状态提示块底、状态行 hover 底 | 正文文本 | 其上 text ≥ 4.5:1 |
| `warning-border` | #eec9a9 | #744f2d | 状态徽标边、提示块边 | 正文文本 | 与 card 与 surface ≥ 3:1 |
| `warning-text` | #b45200 | #ff9b24 | 状态文字、徽标文字、校验提示 | 大面积填充、按钮底 | 对 card 与其自身 surface ≥ 4.5:1 |
| `warning-solid` | #f7900a | #f7900a | 状态实心：Toast 图标底、危险按钮底 | 正文文本、页面底 | 与 on-solid ≥ 4.5:1 |
| `warning-on-solid` | #1a1200 | #1a1200 | warning-solid 上的文字与图标 | 普通表面正文 | 对 warning-solid ≥ 4.5:1 |
| `danger-surface` | #ffeeeb | #422520 | 状态徽标底、状态提示块底、状态行 hover 底 | 正文文本 | 其上 text ≥ 4.5:1 |
| `danger-border` | #f6c3ba | #7a4941 | 状态徽标边、提示块边 | 正文文本 | 与 card 与 surface ≥ 3:1 |
| `danger-text` | #c8140a | #ff6a56 | 状态文字、徽标文字、校验提示 | 大面积填充、按钮底 | 对 card 与其自身 surface ≥ 4.5:1 |
| `danger-solid` | #d92d20 | #d92d20 | 状态实心：Toast 图标底、危险按钮底 | 正文文本、页面底 | 与 on-solid ≥ 4.5:1 |
| `danger-on-solid` | #ffffff | #ffffff | danger-solid 上的文字与图标 | 普通表面正文 | 对 danger-solid ≥ 4.5:1 |
| `info-surface` | #e9f5ff | #1d2f44 | 状态徽标底、状态提示块底、状态行 hover 底 | 正文文本 | 其上 text ≥ 4.5:1 |
| `info-border` | #b5d4f8 | #3a5a7e | 状态徽标边、提示块边 | 正文文本 | 与 card 与 surface ≥ 3:1 |
| `info-text` | #0a64b3 | #5eafff | 状态文字、徽标文字、校验提示 | 大面积填充、按钮底 | 对 card 与其自身 surface ≥ 4.5:1 |
| `info-solid` | #2273c3 | #4b9bf1 | 状态实心：Toast 图标底、危险按钮底 | 正文文本、页面底 | 与 on-solid ≥ 4.5:1 |
| `info-on-solid` | #ffffff | #06131f | info-solid 上的文字与图标 | 普通表面正文 | 对 info-solid ≥ 4.5:1 |

## 3. P0 / P1 修复前后

| ID | 级别 | 问题 | 修改前 | v2 | 阈值 | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| DS-001 | P0 | 输入框静止态没有可见边界 | 亮色 — / 暗色 —（输入底 vs 卡片） | 亮色 3.47:1 / 暗色 4.02:1（边框 vs 卡片） | ≥ 3:1 | 覆盖层已修 |
| DS-002 | P0 | 输入框占位符对比度不足 | 亮色 — / 暗色 — | 亮色 5.39:1 / 暗色 9.12:1 | ≥ 4.5:1 | token 已修 |
| DS-003 | P0 | 四级文本被当作可读文本使用 | 亮色 — / 暗色 — | 亮色 13.95:1 / 暗色 13.22:1 | ≥ 4.5:1 | 覆盖层已修 |
| DS-026 | P0 | 成功/警告文本在白卡上不达标 | 成功 — / 警告 —（白卡） | 成功 5.22:1 / 警告 4.85:1（白卡） | ≥ 4.5:1 | token 已修 |
| DS-004 | P1 | 三级文本在凹槽/页面底上只剩临界余量 | 对凹槽 —（页面底 —） | 对凹槽 12.44:1 / 页面底 13.22:1 | ≥ 4.5:1 | token 已修 |
| DS-005 | P0 | 11px 状态徽标文本有未达标档位 | success — / warning — / info — / destructive — | success 4.96:1 / warning 4.57:1 / info 5.44:1 / destructive 5.25:1 | ≥ 4.5:1（12px 不享受大字号折扣） | 覆盖层已修 |
| DS-006 | P1 | “主文本”有两个值：foreground 与 text-primary | 亮色 #171717 vs #101828；暗色 #fafafa vs #fbfbfc | 亮色 #101215 vs 同值；暗色 #f9fafb vs 同值 | 两套 token 值差 = 0 | token 已修 |
| DS-007 | P1 | 纯灰与蓝灰两套中性色并存 | 纯灰 HSL（0 0%）与蓝灰 #354052 / #f2f4f7 两套并存 | 单一 hue 262；surface base #f2f4f6、raised #f9fafb、border #a8aeb8 | 同一屏只出现一条中性色阶 | token 已修 |
| DS-008 | P1 | 成功/警告/危险各有 3-5 个“同角色”色值 | success 5 个值 / warning 4 个值 / destructive 3 个值 | success、warning、danger、info 各 1 组角色；徽标只消费 text + surface | 同角色单值 | token 已修 |
| DS-009 | P1 | info 没有文本档，直接拿实心色当文字 | --color-text-info 不存在，text-info 解析成实心蓝 | info-text 5.76:1（白卡） / 5.44:1（info-surface） | ≥ 4.5:1 | token 已修 |
| DS-010 | P1 | 焦点指示器有四套写法 | base 1px outline / Button ring-2 / Select 只改底 / Input 只改边，共 4 套 | 1 套：2px + 2px；环对页面底 8.06:1，对卡片 8.5:1 | ≥ 3:1 且宽度/偏移一致 | 覆盖层已修 |
| DS-011 | P1 | 动效降级只覆盖了少数动画 | 仅 .status-event-pulse、.log-row-enter 两处降级 | 全局规则 1 处，覆盖 Skeleton / Dialog / Sheet / Toast | reduce 下无 animation / transition | 覆盖层已修 |
| DS-012 | P1 | 空态容器的虚线边框没有宽度，实际不渲染 | border-dashed 无宽度，实际 0px | 1px dashed border，对卡片 2.23:1（装饰性，符合预期） | 边框实际渲染且不冒充控件边界 | 覆盖层已修 |
| DS-013 | P1 | z-index 没有标度，浮层顺序靠数字大小猜 | z-70 高于 z-50，无命名层 | --ds-z-base 0 / sticky 10 / sidebar 20 / overlay 30 / modal 40 / toast 50 | 浮层顺序由命名层决定 | 覆盖层已修 |
| DS-014 | P1 | 圆角刻度出现非整数与作用域覆写 | 2/4/6/6/10/10.8/13.2/15.6px，且 workflow-ui-surface 覆写 6/8/12/16 | 2/4/6/8/12/16px；通用类不再随作用域变化 | 只允许整数六档 | token 已修 |
| DS-027 | P1 | 浮层有两套视觉：毛玻璃细边 vs 实底阴影 | Select/Dropdown/Popover 毛玻璃细边 vs Combobox 实底 shadow-md | 1 套：overlay-surface + 1px border + shadow-overlay；暗色靠明度 + 边 | 同层级浮层外观一致 | 覆盖层已修 |
| DS-028 | P1 | 页面底色 token 全部零引用，body 实际用侧栏色 | body 使用 bg-sidebar（96% 纯灰） | body #f2f4f6 / sidebar #ebedf1；暗色 #101215 / #101215 | 页面底与侧栏可独立调整 | 覆盖层已修 |

## 4. 对比度矩阵

| 用途 | 前景 | 承载底色 | 亮色 | 暗色 | 阈值 |
| --- | --- | --- | --- | --- | --- |
| 主文本 / 卡片 | `text-primary` | `surface-raised` (#f9fafb / #26292f) | 17.95:1 ✅ | 13.95:1 ✅ | 4.5 |
| 主文本 / 页面底 | `text-primary` | `surface-base` (#f2f4f6 / #101215) | 17.02:1 ✅ | 17.95:1 ✅ | 4.5 |
| 主文本 / 凹槽 | `text-primary` | `surface-sunken` (#ebedf1 / #101215) | 16.01:1 ✅ | 17.95:1 ✅ | 4.5 |
| 次级文本 / 卡片 | `text-secondary` | `surface-raised` (#f9fafb / #26292f) | 13.95:1 ✅ | 13.22:1 ✅ | 4.5 |
| 次级文本 / 页面底 | `text-secondary` | `surface-base` (#f2f4f6 / #101215) | 13.22:1 ✅ | 17.02:1 ✅ | 4.5 |
| 次级文本 / 凹槽 | `text-secondary` | `surface-sunken` (#ebedf1 / #101215) | 12.44:1 ✅ | 17.02:1 ✅ | 4.5 |
| 三级文本 / 凹槽（并入次级） | `text-tertiary` | `surface-sunken` (#ebedf1 / #101215) | 12.44:1 ✅ | 17.02:1 ✅ | 4.5 |
| Placeholder / 输入底 | `text-placeholder` | `input-surface` (#ebedf1 / #101215) | 5.39:1 ✅ | 9.12:1 ✅ | 4.5 |
| 输入文本 / 输入底 | `input-text` | `input-surface` (#ebedf1 / #101215) | 16.01:1 ✅ | 17.95:1 ✅ | 4.5 |
| 禁用文本 / 卡片 | `text-disabled` | `surface-raised` (#f9fafb / #26292f) | 1.54:1 ✅ | 1.59:1 ✅ | 1.5（豁免） |
| 装饰图标 / 卡片 | `text-decorative` | `surface-raised` (#f9fafb / #26292f) | 2.14:1 | 2.76:1 | —（装饰） |
| 实心文本 / solid | `on-solid` | `solid` (#666c77 / #f2f4f6) | 5.05:1 ✅ | 17.02:1 ✅ | 4.5 |
| 实心文本 / solid hover | `on-solid` | `solid-hover` (#4a505a / #ebedf1) | 7.77:1 ✅ | 16.01:1 ✅ | 4.5 |
| 品牌文本 / 页面底 | `brand-text` | `surface-base` (#f2f4f6 / #101215) | 8.06:1 ✅ | 15.20:1 ✅ | 4.5 |
| 品牌文本 / 品牌底 | `brand-text` | `brand-surface` (#e9f2ff / #032f8c) | 7.88:1 ✅ | 9.51:1 ✅ | 4.5 |
| 品牌实心文本 / 品牌实心 | `brand-on-solid` | `brand-solid` (#085afc / #a4cbff) | 5.41:1 ✅ | 11.22:1 ✅ | 4.5 |
| 品牌实心文本 / hover | `brand-on-solid` | `brand-solid-hover` (#044bd9 / #c0dcff) | 6.97:1 ✅ | 13.33:1 ✅ | 4.5 |
| 焦点环 / 页面底 | `focus-ring` | `surface-base` (#f2f4f6 / #101215) | 8.06:1 ✅ | 15.20:1 ✅ | 3 |
| 焦点环 / 卡片 | `focus-ring` | `surface-raised` (#f9fafb / #26292f) | 8.50:1 ✅ | 11.81:1 ✅ | 3 |
| 输入框边界 / 卡片 | `input-border` | `surface-raised` (#f9fafb / #26292f) | 3.47:1 ✅ | 4.02:1 ✅ | 3 |
| 输入框边界 / 页面底 | `input-border` | `surface-base` (#f2f4f6 / #101215) | 3.29:1 ✅ | 5.18:1 ✅ | 3 |
| 输入框边界 / 输入底 | `input-border` | `input-surface` (#ebedf1 / #101215) | 3.09:1 ✅ | 5.18:1 ✅ | 3 |
| 输入 hover 边界 / hover 底 | `input-border-hover` | `input-surface-hover` (#e1e4e9 / #26292f) | 4.14:1 ✅ | 6.53:1 ✅ | 3 |
| 强边框 / 卡片 | `border-strong` | `surface-raised` (#f9fafb / #26292f) | 3.47:1 ✅ | 4.02:1 ✅ | 3 |
| 常规边框 / 卡片 | `border` | `surface-raised` (#f9fafb / #26292f) | 2.14:1 | 2.76:1 | —（装饰） |
| 弱边框 / 卡片 | `border-subtle` | `surface-raised` (#f9fafb / #26292f) | 1.62:1 | 1.80:1 | —（装饰） |
| 浮层边框 / 浮层底 | `overlay-border` | `overlay-surface` (#f9fafb / #26292f) | 1.62:1 | 4.02:1 | —（装饰） |
| 品牌边框 / 页面底 | `brand-border` | `surface-base` (#f2f4f6 / #101215) | 3.54:1 ✅ | 6.65:1 ✅ | 3 |
| 品牌强边 / 卡片 | `brand-border-strong` | `surface-raised` (#f9fafb / #26292f) | 5.18:1 ✅ | 7.02:1 ✅ | 3 |
| 主按钮文本 / 主按钮底 | `on-solid` | `solid` (#666c77 / #f2f4f6) | 5.05:1 ✅ | 17.02:1 ✅ | 4.5 |
| 次按钮文本 / 次按钮底 | `text-secondary` | `surface-raised` (#f9fafb / #26292f) | 13.95:1 ✅ | 13.22:1 ✅ | 4.5 |
| 三级按钮文本 / 三级按钮底 | `text-secondary` | `surface-sunken` (#ebedf1 / #101215) | 12.44:1 ✅ | 17.02:1 ✅ | 4.5 |
| 幽灵按钮文本 / 卡片 | `text-secondary` | `surface-raised` (#f9fafb / #26292f) | 13.95:1 ✅ | 13.22:1 ✅ | 4.5 |
| 危险幽灵按钮文本 / 卡片 | `danger-text` | `surface-raised` (#f9fafb / #26292f) | 5.64:1 ✅ | 5.17:1 ✅ | 4.5 |
| 徽标 default 文本 / 底 | `on-solid` | `solid` (#666c77 / #f2f4f6) | 5.05:1 ✅ | 17.02:1 ✅ | 4.5 |
| 徽标 secondary 文本 / 底 | `text-secondary` | `surface-sunken` (#ebedf1 / #101215) | 12.44:1 ✅ | 17.02:1 ✅ | 4.5 |
| 徽标 info 文本 / 底 | `info-text` | `info-surface` (#e9f5ff / #1d2f44) | 5.44:1 ✅ | 5.87:1 ✅ | 4.5 |
| 徽标 success 文本 / 底 | `success-text` | `success-surface` (#e9f8ed / #1a3524) | 4.96:1 ✅ | 6.18:1 ✅ | 4.5 |
| 徽标 warning 文本 / 底 | `warning-text` | `warning-surface` (#fff1e5 / #3e2815) | 4.57:1 ✅ | 6.56:1 ✅ | 4.5 |
| 徽标 danger 文本 / 底 | `danger-text` | `danger-surface` (#ffeeeb / #422520) | 5.25:1 ✅ | 4.91:1 ✅ | 4.5 |
| 成功文本 / 卡片 | `success-text` | `surface-raised` (#f9fafb / #26292f) | 5.22:1 ✅ | 6.77:1 ✅ | 4.5 |
| 成功文本 / 状态底 | `success-text` | `success-surface` (#e9f8ed / #1a3524) | 4.96:1 ✅ | 6.18:1 ✅ | 4.5 |
| 警告文本 / 卡片 | `warning-text` | `surface-raised` (#f9fafb / #26292f) | 4.85:1 ✅ | 6.92:1 ✅ | 4.5 |
| 警告文本 / 状态底 | `warning-text` | `warning-surface` (#fff1e5 / #3e2815) | 4.57:1 ✅ | 6.56:1 ✅ | 4.5 |
| 危险文本 / 卡片 | `danger-text` | `surface-raised` (#f9fafb / #26292f) | 5.64:1 ✅ | 5.17:1 ✅ | 4.5 |
| 危险文本 / 状态底 | `danger-text` | `danger-surface` (#ffeeeb / #422520) | 5.25:1 ✅ | 4.91:1 ✅ | 4.5 |
| 信息文本 / 卡片 | `info-text` | `surface-raised` (#f9fafb / #26292f) | 5.76:1 ✅ | 6.28:1 ✅ | 4.5 |
| 信息文本 / 状态底 | `info-text` | `info-surface` (#e9f5ff / #1d2f44) | 5.44:1 ✅ | 5.87:1 ✅ | 4.5 |
| 成功实心文本 / solid | `success-on-solid` | `success-solid` (#008345 / #2abb71) | 4.85:1 ✅ | 7.61:1 ✅ | 4.5 |
| 警告实心文本 / solid | `warning-on-solid` | `warning-solid` (#f7900a / #f7900a) | 7.92:1 ✅ | 7.92:1 ✅ | 4.5 |
| 危险实心文本 / solid | `danger-on-solid` | `danger-solid` (#d92d20 / #d92d20) | 4.83:1 ✅ | 4.83:1 ✅ | 4.5 |
| 信息实心文本 / solid | `info-on-solid` | `info-solid` (#2273c3 / #4b9bf1) | 4.87:1 ✅ | 6.48:1 ✅ | 4.5 |
| 成功边框 / 卡片 | `success-border` | `surface-raised` (#f9fafb / #26292f) | 1.43:1 | 2.13:1 | —（装饰） |
| 警告边框 / 卡片 | `warning-border` | `surface-raised` (#f9fafb / #26292f) | 1.48:1 | 2.01:1 | —（装饰） |
| 危险边框 / 卡片 | `danger-border` | `surface-raised` (#f9fafb / #26292f) | 1.50:1 | 1.98:1 | —（装饰） |
| 信息边框 / 卡片 | `info-border` | `surface-raised` (#f9fafb / #26292f) | 1.46:1 | 2.04:1 | —（装饰） |
| 图表 1 / 卡片 | `chart-1` | `surface-raised` (#f9fafb / #26292f) | 3.74:1 ✅ | 8.72:1 ✅ | 3 |
| 图表 2 / 卡片 | `chart-2` | `surface-raised` (#f9fafb / #26292f) | 4.64:1 ✅ | 5.86:1 ✅ | 3 |
| 图表 3 / 卡片 | `chart-3` | `surface-raised` (#f9fafb / #26292f) | 4.85:1 ✅ | 6.21:1 ✅ | 3 |
| 图表 4 / 卡片 | `chart-4` | `surface-raised` (#f9fafb / #26292f) | 4.66:1 ✅ | 5.04:1 ✅ | 3 |
| 图表 5 / 卡片 | `chart-5` | `surface-raised` (#f9fafb / #26292f) | 4.62:1 ✅ | 3.02:1 ✅ | 3 |

## 5. 排版与刻度

### 5.1 字号（6 档）

| Token | 字号/行高 | 允许 | 不得 |
| --- | --- | --- | --- |
| `--ds-type-1-*` | 12/16 | 徽标、Kbd、表格密集元信息 | 正文段落 |
| `--ds-type-2-*` | 13/20 | 控件文字、次级正文 | 页面标题 |
| `--ds-type-3-*` | 14/20 | 正文默认、表格正文 | 展示型标题 |
| `--ds-type-4-*` | 16/24 | 区内标题、Dialog 标题 | 长正文 |
| `--ds-type-5-*` | 20/28 | 页面标题 | 表格单元格 |
| `--ds-type-6-*` | 24/32 | 首屏/空态主标题 | 控件内文字 |

11px 取消。Badge 统一 12/16；正文默认 13/20 或 14/20。层级靠字号与字重，不再靠降低对比度。

### 5.2 字重（3 档）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ds-weight-regular` | 400 | 正文、输入值 |
| `--ds-weight-medium` | 500 | 控件文字、表头、强调标签 |
| `--ds-weight-semibold` | 600 | 标题、关键数字 |

### 5.3 间距

允许：0px / 4px / 8px / 12px / 16px / 20px / 24px / 32px / 40px / 48px / 64px。

例外：

- 1px：1px 描边（border / outline 宽度），不计入 spacing
- 2px：焦点环 offset、图标光学内衬；必须用 --ds-focus-offset / --ds-icon-inset，不得写 gap-0.5

### 5.4 控件高度与触控

| 档 | 高度 | 用途 |
| --- | --- | --- |
| `--ds-control-xs` | 24px | 密集表格内 icon 按钮；桌面指针限定 |
| `--ds-control-sm` | 28px | 工具栏、二次操作 |
| `--ds-control-md` | 32px | 默认表单控件、默认按钮 |
| `--ds-control-lg` | 36px | 页头主操作、Dialog 主按钮 |
| `--ds-control-xl` | 40px | 触控/首屏 CTA |

触控下限：**44px**（coarse pointer）。24px 只允许桌面指针。

### 5.5 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ds-radius-xs` | 2px | Kbd、微型标记 |
| `--ds-radius-sm` | 4px | Badge、Checkbox |
| `--ds-radius-md` | 6px | Button、Input、Select、Tabs |
| `--ds-radius-lg` | 8px | 小卡片、Toast |
| `--ds-radius-xl` | 12px | Card、Popover、Sheet |
| `--ds-radius-2xl` | 16px | Dialog、全屏 Sheet |

### 5.6 非颜色 token 索引（每个都有消费者）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ds-type-1-size` | 12px | 12/16 字号 |
| `--ds-type-1-line` | 16px | 12/16 行高 |
| `--ds-type-2-size` | 13px | 13/20 字号 |
| `--ds-type-2-line` | 20px | 13/20 行高 |
| `--ds-type-3-size` | 14px | 14/20 字号 |
| `--ds-type-3-line` | 20px | 14/20 行高 |
| `--ds-type-4-size` | 16px | 16/24 字号 |
| `--ds-type-4-line` | 24px | 16/24 行高 |
| `--ds-type-5-size` | 20px | 20/28 字号 |
| `--ds-type-5-line` | 28px | 20/28 行高 |
| `--ds-type-6-size` | 24px | 24/32 字号 |
| `--ds-type-6-line` | 32px | 24/32 行高 |
| `--ds-weight-regular` | 400 | 正文、输入值 |
| `--ds-weight-medium` | 500 | 控件文字、表头、强调标签 |
| `--ds-weight-semibold` | 600 | 标题、关键数字 |
| `--ds-space-0` | 0px | 4px 主网格 |
| `--ds-space-4` | 4px | 4px 主网格 |
| `--ds-space-8` | 8px | 4px 主网格 |
| `--ds-space-12` | 12px | 4px 主网格 |
| `--ds-space-16` | 16px | 4px 主网格 |
| `--ds-space-20` | 20px | 4px 主网格 |
| `--ds-space-24` | 24px | 4px 主网格 |
| `--ds-space-32` | 32px | 4px 主网格 |
| `--ds-space-40` | 40px | 4px 主网格 |
| `--ds-space-48` | 48px | 4px 主网格 |
| `--ds-space-64` | 64px | 4px 主网格 |
| `--ds-hairline` | 1px | 描边宽度 |
| `--ds-focus-offset` | 2px | 焦点环 offset |
| `--ds-icon-inset` | 2px | 图标光学内衬 |
| `--ds-control-xs` | 24px | 密集表格内 icon 按钮；桌面指针限定 |
| `--ds-control-sm` | 28px | 工具栏、二次操作 |
| `--ds-control-md` | 32px | 默认表单控件、默认按钮 |
| `--ds-control-lg` | 36px | 页头主操作、Dialog 主按钮 |
| `--ds-control-xl` | 40px | 触控/首屏 CTA |
| `--ds-touch-min` | 44px | coarse pointer 触控下限 |
| `--ds-radius-xs` | 2px | Kbd、微型标记 |
| `--ds-radius-sm` | 4px | Badge、Checkbox |
| `--ds-radius-md` | 6px | Button、Input、Select、Tabs |
| `--ds-radius-lg` | 8px | 小卡片、Toast |
| `--ds-radius-xl` | 12px | Card、Popover、Sheet |
| `--ds-radius-2xl` | 16px | Dialog、全屏 Sheet |
| `--ds-shadow-card` | card | 卡片静置 |
| `--ds-shadow-overlay` | overlay | 浮层 |
| `--ds-shadow-panel` | panel | 面板 |
| `--ds-z-base` | 0 | 普通文档流 |
| `--ds-z-sticky` | 10 | 表头、页头 sticky |
| `--ds-z-sidebar` | 20 | 应用侧栏 |
| `--ds-z-overlay` | 30 | Popover / Select / Dropdown / 收据控件 |
| `--ds-z-modal` | 40 | Dialog / Sheet / Drawer |
| `--ds-z-toast` | 50 | Toast，永远最上层 |
| `--ds-z-receipt` | overlay | 收据控件（不高于 Dialog） |
| `--ds-duration-fast` | 100ms | 颜色、hover |
| `--ds-duration-base` | 150ms | 浮层淡入、焦点 |
| `--ds-duration-slow` | 200ms | 侧栏宽度、Sheet |
| `--ds-duration-deliberate` | 300ms | 页面级转场 |
| `--ds-focus-width` | 2px | 焦点环宽度 |

## 6. 组件规范 v2

每个组件七态：default / hover / active / focus-visible / disabled / loading / error；不适用标 N/A 并写明原因。完整逐态契约见预览页 §06 或 `v2.generated.json` 的 `components`。

| 组件 | 几何 | 适用状态 | N/A |
| --- | --- | --- | --- |
| Button | h 24/28/32/36/40 · px 8/12/12/16 · r 6 · 13/20 · 1px border | 6/7 | error |
| Input | h 32 · px 12 · py 6 · r 6 · 13/20 · 1px border | 7/7 | — |
| Select | h 32 · pl 12 · pr 8 · r 6 · 13/20 · 1px border · 箭头 16px | 7/7 | — |
| Checkbox | 16 × 16 · r 4 · 2px 视觉边 · 标签 13/20 | 7/7 | — |
| Radio | 16 × 16 · 圆形 · 内点 6px · 标签 13/20 | 6/7 | loading |
| Switch | 36 × 20 · 轨道 r 999 · 滑块 16 · 标签 13/20 | 7/7 | — |
| Badge | h 20 · px 8 · r 4 · 12/16 · 500 | 5/7 | disabled / loading |
| Card | p 16 · r 12 · 1px border-subtle · shadow-card · 14/20 | 6/7 | disabled |
| Table | 行高 36/40 · 单元格 px 8 py 8 · 表头 12/16 · 正文 13/20 | 6/7 | disabled |
| Dialog | max-w 384 · p 16 · r 16 · gap 16 · 14/20 | 4/7 | hover / active / disabled |
| Sheet | 宽 384 / 移动端 100% · p 16 · r 16（左侧）· 14/20 | 4/7 | hover / active / disabled |
| Toast | p 12 16 · r 8 · max-w 360 · 13/20 | 6/7 | disabled |
| Tooltip | px 12 · py 6 · r 6 · 12/16 · max-w 280 | 3/7 | active / disabled / loading / error |
| Tabs | h 32 · px 12 · r 6 · 13/20 · 间距 4 | 7/7 | — |
| Skeleton | r 4 · 高度按内容行高 · 与目标内容同尺寸 | 2/7 | hover / active / focus-visible / disabled / error |
| Empty | p 24 · r 12 · 1px dashed border-subtle · 标题 16/24 · 说明 13/20 | 3/7 | hover / active / disabled / loading |

## 7. 规范条文

| 编号 | 级别 | 条文 | 判定 / 查法 | 状态 |
| --- | --- | --- | --- | --- |
| R-01 | MUST | 正文文本对比度 ≥ 4.5:1；≥ 18.66px 粗体或 ≥ 24px 可降到 3:1 | 对承载底色实测；运行 node scripts/design-system/build-v2.mjs --check，任何 text 行 < 阈值即失败 | v2 矩阵全部通过 |
| R-02 | MUST | 非文本控件边界与相邻表面 ≥ 3:1 | input-border / border-strong 对 raised、base、input-surface 三处重算 | 输入框 3.30:1 起（亮/暗） |
| R-03 | MUST | 键盘焦点统一 2px 环 + 2px offset，颜色取 focus-ring | Tab 遍历；守卫断言 --ds-focus-width=2px、--ds-focus-offset=2px | 覆盖层统一 :focus-visible |
| R-04 | MUST | 状态不能只靠颜色；必须有形状、文字、图标或 aria-* 之一 | 灰度截图逐态比对；组件规范每态都有 nonColor 字段 | 16 个组件逐态登记 |
| R-05 | MUST | 字号 ≤ 6 档，最小 12px；禁止 10/11px | 解析 tokens.v2.css 的 --ds-type-*-size；多于 6 或 < 12 即失败 | 6 档，11px 取消 |
| R-06 | MUST | 字重 ≤ 3 档：400 / 500 / 600 | 解析 --ds-weight-*；出现其他值即失败 | 3 档 |
| R-07 | MUST | 每个字号必须成对声明行高，行高 ≥ 1.25× 字号 | 解析 --ds-type-N-line / size；缺对或比例不足即失败 | 6 对 |
| R-08 | MUST | 间距落在 4px 网格；只允许 1px 描边与 2px 焦点/图标内衬例外 | 解析 --ds-space-*；非 4 倍数且不在例外表即失败 | 11 档 + 2 例外 |
| R-09 | MUST | 控件高度只取 24/28/32/36/40；触控目标 ≥ 44px | 解析 --ds-control-* 与 --ds-touch-min | 5 档 + 44px 下限 |
| R-10 | MUST | 圆角只取 2/4/6/8/12/16；禁止 10.8 / 13.2 / 15.6 | 解析 --ds-radius-* | 6 档 |
| R-11 | MUST | 阴影只取 --ds-shadow-card / overlay / panel；暗色不叠加黑色重影 | 搜 shadow-[、shadow-lg、shadow-2xl；守卫白名单为空 | 3 档 + 暗色值 |
| R-12 | MUST | z-index 只取命名层 base/sticky/sidebar/overlay/modal/toast | 搜 z-[0-9]+；旧 z-50/z-70 在覆盖层映射到 token | 6 层；收据降到 overlay |
| R-13 | MUST | 动效 100/150/200/300ms；prefers-reduced-motion 下 animation/transition 归零 | 解析 --ds-duration-*；覆盖层媒体块存在 | 4 档 + 全局降级 |
| R-14 | MUST | 状态族只能消费 surface/border/text/solid/on-solid；禁止拿 solid 当 text | 守卫断言每个 family 五角色齐全，且 text 对 card 与 surface ≥ 4.5:1 | 4 族 × 5 角色 |
| R-15 | MUST | 颜色只引用 token；组件用法不得出现字面色值 | 搜 tokens.v2.css 兼容层与组件源码：#hex / rgb() / hsl()；v2 覆盖层定义区除外 | 覆盖层 0 处字面色值 |
| R-16 | MUST | 每个声明都必须有 consumer；零未引用 token | 解析 tokens.v2.css，按 var() 引用与白名单判定 | 0 未引用；白名单 0 |
| R-17 | MUST | 生成物与源码逐字节一致 | node scripts/design-system/build-v2.mjs --check | CI 守卫 |
| R-18 | MUST | 文档引用 token 名与实测值，不引用易漂移的行号 | README/HTML 中不出现 index.css:数字 | v2 文档由数据生成 |

## 8. 迁移映射

旧名优先保留为 alias（112 个）；不能映射的删除。完整表见预览页 §08。

| v1 | v2 | 动作 | 说明 |
| --- | --- | --- | --- |
| `--color-background` | `--ds-surface-base` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-card` | `--ds-surface-raised` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-card-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-canvas` | `--ds-surface-base` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-popover` | `--ds-overlay-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-popover-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-primary` | `--ds-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-primary-foreground` | `--ds-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-secondary` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-secondary-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-muted` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-muted-foreground` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-accent` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-accent-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-destructive` | `--ds-danger-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-destructive-foreground` | `--ds-danger-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-border` | `--ds-border-subtle` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-input` | `--ds-input-border` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-ring` | `--ds-focus-ring` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-inset` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-foreground` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-primary` | `--ds-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-primary-foreground` | `--ds-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-accent` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-accent-foreground` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-border` | `--ds-border-subtle` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-sidebar-ring` | `--ds-focus-ring` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-primary` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-secondary` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-tertiary` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-quaternary` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-destructive` | `--ds-danger-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-success` | `--ds-success-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-warning` | `--ds-warning-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-info` | `--ds-info-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-disabled` | `--ds-text-disabled` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-inverted` | `--ds-text-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-accent` | `--ds-brand-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-accent-secondary` | `--ds-brand-text-muted` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-success-secondary` | `--ds-success-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-text-warning-secondary` | `--ds-warning-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-success` | `--ds-success-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-success-foreground` | `--ds-success-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-warning` | `--ds-warning-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-warning-foreground` | `--ds-warning-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-info` | `--ds-info-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-info-foreground` | `--ds-info-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-module-border` | `--ds-border-subtle` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-panel-bg` | `--ds-overlay-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-panel-bg-blur` | `--ds-overlay-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-panel-border` | `--ds-overlay-border` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-tooltip-bg` | `--ds-text-primary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-bg-normal` | `--ds-input-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-bg-hover` | `--ds-input-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-bg-active` | `--ds-input-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-bg-disabled` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-text-filled` | `--ds-input-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-text-filled-disabled` | `--ds-text-disabled` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-text-placeholder` | `--ds-text-placeholder` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-border-hover` | `--ds-input-border-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-input-border-active` | `--ds-input-border-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-primary-bg` | `--ds-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-primary-bg-hover` | `--ds-solid-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-primary-text` | `--ds-on-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-primary-border` | `--ds-border-subtle` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-bg` | `--ds-surface-raised` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-bg-hover` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-text` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-accent-text` | `--ds-brand-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-border` | `--ds-border` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-secondary-border-hover` | `--ds-border-strong` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-tertiary-bg` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-tertiary-bg-hover` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-tertiary-text` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-ghost-text` | `--ds-text-secondary` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-ghost-bg-hover` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-destructive-ghost-text` | `--ds-danger-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-components-button-destructive-ghost-bg-hover` | `--ds-danger-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-base-hover` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-base-hover-alt` | `--ds-surface-active` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-base-active` | `--ds-surface-active` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-base-handle` | `--ds-border-strong` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-base-handle-hover` | `--ds-border-strong` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-accent-solid` | `--ds-focus-ring` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-accent-hover` | `--ds-brand-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-accent-active` | `--ds-brand-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-success-solid` | `--ds-success-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-warning-solid` | `--ds-warning-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-destructive-solid` | `--ds-danger-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-destructive-hover` | `--ds-danger-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-state-warning-hover` | `--ds-warning-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-chart-1` | `--ds-chart-1` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-chart-2` | `--ds-chart-2` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-chart-3` | `--ds-chart-3` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-chart-4` | `--ds-chart-4` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-chart-5` | `--ds-chart-5` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-heat-0` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-heat-1` | `--ds-success-surface` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-heat-2` | `--ds-success-border` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-heat-3` | `--ds-success-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-heat-4` | `--ds-success-text` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-block-bg` | `--ds-surface-raised` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-block-bg-hover` | `--ds-surface-hover` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-block-parma-bg` | `--ds-surface-sunken` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-canvas-workflow-bg` | `--ds-surface-base` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-link-line-normal` | `--ds-border-strong` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-link-line-active` | `--ds-brand-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-link-line-error-active` | `--ds-danger-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-link-line-failure-active` | `--ds-warning-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-workflow-link-line-success-active` | `--ds-success-solid` | alias | v2 保留旧名，值指向新角色；迁移期无需改调用点 |
| `--color-background-body` | `--ds-surface-base` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default` | `--ds-surface-raised` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-dimmed` | `--ds-surface-active` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-dodge` | `--ds-surface-raised` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-hover` | `--ds-surface-hover` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-subtle` | `--ds-surface-raised` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-1` | `--ds-chart-1` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-2` | `--ds-chart-2` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-3` | `--ds-chart-3` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-4` | `--ds-chart-4` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-5` | `--ds-chart-5` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-button-secondary-accent-text` | `--ds-brand-text` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-bg` | `--ds-surface-raised` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-bg-hover` | `--ds-surface-hover` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-border` | `--ds-border-subtle` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-border-hover` | `--ds-border-strong` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-selected-bg` | `--ds-brand-surface` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-tooltip-bg` | `--ds-text-primary（反色底）` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-destructive-foreground` | `--ds-danger-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-info-foreground` | `--ds-info-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-secondary-foreground` | `--ds-text-primary` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-border` | `--ds-border-subtle` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-primary-foreground` | `--ds-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-ring` | `--ds-focus-ring` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-state-base-handle-hover` | `--ds-border-strong` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-state-warning-solid` | `--ds-warning-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-success-foreground` | `--ds-success-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-accent-secondary` | `--ds-brand-text-muted` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-inverted` | `--ds-text-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-success-secondary` | `--ds-success-text` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-warning-secondary` | `--ds-warning-text` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-warning-foreground` | `--ds-warning-on-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-bg-transparent` | `--ds-surface-raised` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-border` | `--ds-border-subtle` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-border-highlight` | `--ds-brand-border` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-error-active` | `--ds-danger-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-active` | `--ds-warning-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-button-bg` | `--ds-warning-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-handle` | `--ds-warning-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-normal-transparent` | `--ds-border` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-success-active` | `--ds-success-solid` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--radius-3xl` | `--ds-radius-2xl（16px）` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--radius-4xl` | `--ds-radius-2xl（16px）` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--shadow-card-hover` | `--ds-shadow-overlay` | deleted | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-quaternary` | `--ds-text-decorative` | rename | 旧名兼容到 secondary（正文可读）；装饰用途改新名，禁止当正文 |
| `--color-text-tertiary` | `--ds-text-secondary` | merge | 取消更浅的三级文本，层级靠字号/字重 |
| `--color-background-default-*` | `--ds-surface-*` | rename | 五档语义 surface 取代 default 系列 |
| `--radius-2xl` | `--ds-radius-xl` | rename | 10.8px → 12px；工作流用独立 --ds-radius-workflow-2xl:16px |

## 9. 问题收敛表（29 条）

| ID | 级别 | 问题 | 处置 | 决策 | 修改前 → v2 | 残留 |
| --- | --- | --- | --- | --- | --- | --- |
| DS-001 | P0 | 输入框静止态没有可见边界 | 覆盖层已修 | 新增 --ds-input-border = neutral-8；tokens.v2.css 用 [data-slot="input"] / [data-slot="select-trigger"] 补静止态 1px 边框，并保留 hover/focus 加深。 | 亮色 — / 暗色 —（输入底 vs 卡片） → 亮色 3.47:1 / 暗色 4.02:1（边框 vs 卡片） | 无需改 TSX；导入覆盖层即生效。下一轮把 input.tsx:15 的 border-transparent 改成 border-input-border，去掉覆盖层补丁。 |
| DS-002 | P0 | 输入框占位符对比度不足 | token 已修 | placeholder 改为 neutral-11@72% 与输入底的合成色，对比度按 input-surface 实测；同时规定必须提供可见 label 或 aria-label。 | 亮色 — / 暗色 — → 亮色 5.39:1 / 暗色 9.12:1 | input.tsx:16 已消费 --color-components-input-text-placeholder，覆盖层改别名即生效。 |
| DS-003 | P0 | 四级文本被当作可读文本使用 | 覆盖层已修 | 取消“四级文本”。--color-text-quaternary 兼容别名指向 --ds-text-secondary（可读）；新增 --ds-text-decorative 只给图标/分隔符，守卫禁止它出现在文本角色里。 | 亮色 — / 暗色 — → 亮色 13.95:1 / 暗色 13.22:1 | 旧类名 .text-text-quaternary 在覆盖层里映射到 secondary；装饰用途需改 .text-text-decorative。 |
| DS-026 | P0 | 成功/警告文本在白卡上不达标 | token 已修 | 成功/警告文本各加深一档，保持 v1 色相（success 155.2 / warning 62.1）；状态文本只消费 status-text，不再拿 solid 当文字。 | 成功 — / 警告 —（白卡） → 成功 5.22:1 / 警告 4.85:1（白卡） | 运行时 text-success / text-warning 已消费 token，覆盖层改值即生效。 |
| DS-004 | P1 | 三级文本在凹槽/页面底上只剩临界余量 | token 已修 | 三级文本并入次级文本（neutral-11），层级改由 12/13/14px 字号与 400/500/600 字重承担；不再用降低对比度表达层级。 | 对凹槽 —（页面底 —） → 对凹槽 12.44:1 / 页面底 13.22:1 | 无；覆盖层把 --color-text-tertiary 指向 secondary。 |
| DS-005 | P0 | 11px 状态徽标文本有未达标档位 | 覆盖层已修 | Badge 字号 12/16、状态徽标改 own-surface + own-text；tokens.v2.css 用 [data-slot="badge"] 锁 12px，并把 success/warning/info/destructive 的 alpha 底改为实色状态 surface。 | success — / warning — / info — / destructive — → success 4.96:1 / warning 4.57:1 / info 5.44:1 / destructive 5.25:1 | badge.tsx:8 的 system-2xs-medium 被覆盖层统一抬到 12/16；下一轮换成 system-xs-medium。 |
| DS-006 | P1 | “主文本”有两个值：foreground 与 text-primary | token 已修 | 主文本只留 --ds-text-primary；--color-foreground、--color-card-foreground、--color-text-primary 全部别名到同一个值。 | 亮色 #171717 vs #101828；暗色 #fafafa vs #fbfbfc → 亮色 #101215 vs 同值；暗色 #f9fafb vs 同值 | 无。 |
| DS-007 | P1 | 纯灰与蓝灰两套中性色并存 | token 已修 | 中性色统一为 hue 262、低彩度的 12 阶（最大 C=0.022）；背景/边框/文本/实心全部从这一条色阶取角色。 | 纯灰 HSL（0 0%）与蓝灰 #354052 / #f2f4f7 两套并存 → 单一 hue 262；surface base #f2f4f6、raised #f9fafb、border #a8aeb8 | 无。 |
| DS-008 | P1 | 成功/警告/危险各有 3-5 个“同角色”色值 | token 已修 | 每个状态只保留 surface/border/text/solid/on-solid 五个角色；v1 的 text-*-secondary、state-*-solid、util-colors-* 全部删除或别名到同一角色。 | success 5 个值 / warning 4 个值 / destructive 3 个值 → success、warning、danger、info 各 1 组角色；徽标只消费 text + surface | 无。 |
| DS-009 | P1 | info 没有文本档，直接拿实心色当文字 | token 已修 | 补齐 --ds-info-text / border / surface / solid / on-solid，info 不再拿实心色当文字。 | --color-text-info 不存在，text-info 解析成实心蓝 → info-text 5.76:1（白卡） / 5.44:1（info-surface） | badge.tsx:23 的 text-info 现在命中新增别名。 |
| DS-010 | P1 | 焦点指示器有四套写法 | 覆盖层已修 | 统一焦点三件套：--ds-focus-ring = brand-11 / brand-3，宽 2px、offset 2px；覆盖层 :focus-visible 对所有可聚焦控件生效。 | base 1px outline / Button ring-2 / Select 只改底 / Input 只改边，共 4 套 → 1 套：2px + 2px；环对页面底 8.06:1，对卡片 8.5:1 | 无需改 TSX；组件内旧的 focus 底色保留为附加反馈。 |
| DS-011 | P1 | 动效降级只覆盖了少数动画 | 覆盖层已修 | 覆盖层加全局 @media (prefers-reduced-motion: reduce)：animation/transition 归零，Skeleton 改为静态块；保留 opacity 的即时切换。 | 仅 .status-event-pulse、.log-row-enter 两处降级 → 全局规则 1 处，覆盖 Skeleton / Dialog / Sheet / Toast | 无。 |
| DS-012 | P1 | 空态容器的虚线边框没有宽度，实际不渲染 | 覆盖层已修 | Empty 补 1px dashed 边框（--ds-border），暗色用同一语义；同时保留无边框的 embedded 变体。 | border-dashed 无宽度，实际 0px → 1px dashed border，对卡片 2.23:1（装饰性，符合预期） | empty.tsx:10 下一轮直接补 border；覆盖层已用 [data-slot="empty"] 兜住。 |
| DS-013 | P1 | z-index 没有标度，浮层顺序靠数字大小猜 | 覆盖层已修 | 定义 base/sticky/sidebar/overlay/modal/toast 六档；收据控件从 z-70 降到 overlay(30)，Dialog 用 modal(40)。覆盖层把 .z-50/.z-70 旧类名映射到 token。 | z-70 高于 z-50，无命名层 → --ds-z-base 0 / sticky 10 / sidebar 20 / overlay 30 / modal 40 / toast 50 | receipt-controls.tsx:78 下一轮改为 z-(--ds-z-overlay)。 |
| DS-014 | P1 | 圆角刻度出现非整数与作用域覆写 | token 已修 | 圆角收成 2/4/6/8/12/16 六档；删除 10.8/13.2/15.6，工作流改用独立 --ds-radius-workflow-*（16px）而不是覆写通用类。 | 2/4/6/6/10/10.8/13.2/15.6px，且 workflow-ui-surface 覆写 6/8/12/16 → 2/4/6/8/12/16px；通用类不再随作用域变化 | index.css:880-903 的 workflow 覆写需下一轮删除；覆盖层不改该作用域，避免影响画布。 |
| DS-027 | P1 | 浮层有两套视觉：毛玻璃细边 vs 实底阴影 | 覆盖层已修 | 浮层统一 --ds-overlay-surface / overlay-border / --ds-shadow-overlay；覆盖层把 combobox-content 拉到同一套。 | Select/Dropdown/Popover 毛玻璃细边 vs Combobox 实底 shadow-md → 1 套：overlay-surface + 1px border + shadow-overlay；暗色靠明度 + 边 | combobox.tsx:115 下一轮删 shadow-md / ring-1。 |
| DS-028 | P1 | 页面底色 token 全部零引用，body 实际用侧栏色 | 覆盖层已修 | body 改用 --ds-surface-base；侧栏独立用 --ds-surface-sunken，两者不再同色。 | body 使用 bg-sidebar（96% 纯灰） → body #f2f4f6 / sidebar #ebedf1；暗色 #101215 / #101215 | 覆盖层 body 规则生效；下一轮把 index.css:691 的 bg-sidebar 改掉。 |
| DS-015 | P2 | 44 个已声明 token 在源码里找不到引用 | 已删除 | 44 个零引用 token 全部不进入 v2 声明（0 个保留白名单）；能映射的给迁移别名，不能映射的删除。逐个处置见 §迁移映射。 | 44 个已声明、源码零引用 → 0 个 v2 死 token；守卫要求每个声明都有 consumer | 运行时 index.css 下一轮删除；v2 覆盖层不声明它们，因此不会再扩散。 |
| DS-016 | P2 | 13px/12px 字号在 29 处绕过排版 utility | 需下一轮改源码 | 排版收成 6 档字号 × 3 档字重，取消 11px；v2 覆盖层把 system-2xs-* 统一抬到 12/16。29 处 text-[13px] 需下一轮替换。 | 23 个 system-* utility、11/12/13/14/16px 五档 + 29 处字面字号 → 6 档：12/16、13/20、14/20、16/24、20/28、24/32；字重 400/500/600 | button.tsx:8、input.tsx:15、select.tsx:48、tabs.tsx:66、dropdown-menu.tsx:46 等 29 处需 codemod。 |
| DS-017 | P2 | 非插图场景仍有字面色值与影子 | 需下一轮改源码 | 补齐 --ds-chart-1..5 与三档 shadow；趋势图/印章/托盘投影仍需改源码。 | 44 处字面颜色；趋势图 4/5 条线是字面值 → chart-1..5 对卡片 3.91–5.90:1；shadow-card/overlay/panel 三档 | trend-chart.tsx:14-18、bill-content.tsx:92、layout.tsx:69、tray/page.tsx:88 下一轮迁移。 |
| DS-029 | P2 | tooltip 与 hover 阴影 token 声明了但没人用 | 已删除 | 删除 components-tooltip-bg 与 shadow-card-hover；Tooltip 明确为反色底（text-primary 作底），Card hover 不再承诺抬升。 | 2 个声明了但没人用的 token → 0 个；浮层 hover 由 shadow-overlay 单档承担 | 无。 |
| DS-018 | P2 | 阴影只有卡片两档，其余用 Tailwind 默认值 | 需下一轮改源码 | 定义 --ds-shadow-card / --ds-shadow-overlay / --ds-shadow-panel 三档，暗色各有一组；组件禁止 shadow-lg/2xl。 | 只有 card 两档，浮层用 Tailwind lg/2xl → 3 档语义阴影，暗色显式值 | model-test-panel.tsx:727、:1052 下一轮替换。 |
| DS-019 | P2 | 间距大量落在 2px 网格而不是 4/8 网格 | 需下一轮改源码 | 间距只允许 4px 网格的 11 档；2px 仅焦点 offset/图标内衬，1px 仅描边，均登记为例外。 | 2px 半档 8 个（0.5/0.75/1.5/2.25/2.5/3.5/6.5/7.5），400+ 处 → 0/4/8/12/16/20/24/32/40/48/64；例外 1px/2px | tabs.tsx:66、alert-dialog.tsx:76 等半档需下一轮 codemod；覆盖层不改布局类，避免大面积回归。 |
| DS-020 | P2 | mono 字体声明了但没有随包提供 | token 已修 | --ds-font-mono 把 ui-monospace 放到首位，Geist Mono 作为可选首选；不再假装 Source Code Pro 已随包分发。 | Source Code Pro 未安装，Linux 回落 DejaVu → ui-monospace / SFMono / Geist Mono / DejaVu Sans Mono 明确顺序 | 若要求三平台像素一致，需引入 Geist Mono 字体文件（体积 +1），列入待拍板。 |
| DS-021 | P2 | 禁用态亮色用实色、暗色用 alpha，跨背景不一致 | token 已修 | 禁用文本统一为“中性色 × alpha 对卡片”的合成值，亮暗都是同一构造；禁用态仍不参与对比度门槛。 | 亮色实色 #d0d5dc、暗色 30% alpha → 亮色 #c8ccd3 / 暗色 #444850（同一 alpha 构造） | 无。 |
| DS-022 | P2 | 两个底色 token 在一种模式下与相邻档完全相同 | 已删除 | 删除 background-default-subtle / dodge / dimmed / hover / default 系列；surface 角色只有 base/raised/sunken/hover/active 五档。 | subtle 暗色 = default、dodge 亮色 = default → 五档语义 surface，值互不相同 | 无。 |
| DS-023 | P2 | Button 没有 loading 档，disabled 会连 spinner 一起变淡 | 需下一轮改源码 | 组件规范新增 loading 态：Spinner + aria-busy，不套 disabled 透明度；v2 提供 .ds-button[data-loading] 样式。 | Button 无 loading，disabled 把 Spinner 一起降透明 → loading 独立态；宽度不跳、aria-busy=true、spinner 保持 100% | button.tsx:29-39 下一轮加 loading prop；覆盖层只能提供样式，无法设置 aria-busy。 |
| DS-024 | P3 | 既有规格文档的行号与 token 计数已过期 | 文档已修 | v2 文档由脚本生成，引用 token 名与实测值，不再手写行号；计数写入 v2.generated.json。 | design-system-tokens.md 引用 index.css:64/66（实际 65/67） → 所有引用为 token 名；生成物 --check 逐字节校验 | 旧 apps/docs/specs/design 文档下一轮归档。 |
| DS-025 | P3 | `text-inverted` 与 `primary-foreground` 语义重叠 | 已删除 | 删除 --color-text-inverted；反色文本只保留 --ds-text-on-solid / --color-text-inverted 兼容别名指向它。 | text-inverted #000 与 primary-foreground #fff 方向相反 → 单值 --ds-text-on-solid；旧名只作别名 | 无。 |

## 10. 44 个零引用 token 的处置

| Token | v1 行 | 处置 | 替代 | 理由 |
| --- | --- | --- | --- | --- |
| `--color-background-body` | 184 | deleted | `--ds-surface-base` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default` | 185 | deleted | `--ds-surface-raised` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-dimmed` | 188 | deleted | `--ds-surface-active` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-dodge` | 189 | deleted | `--ds-surface-raised` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-hover` | 186 | deleted | `--ds-surface-hover` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-background-default-subtle` | 187 | deleted | `--ds-surface-raised` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-1` | 100 | deleted | `--ds-chart-1` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-2` | 101 | deleted | `--ds-chart-2` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-3` | 102 | deleted | `--ds-chart-3` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-4` | 103 | deleted | `--ds-chart-4` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-chart-5` | 104 | deleted | `--ds-chart-5` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-button-secondary-accent-text` | 272 | deleted | `--ds-brand-text` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-bg` | 234 | deleted | `--ds-surface-raised` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-bg-hover` | 236 | deleted | `--ds-surface-hover` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-border` | 235 | deleted | `--ds-border-subtle` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-border-hover` | 237 | deleted | `--ds-border-strong` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-option-card-option-selected-bg` | 238 | deleted | `--ds-brand-surface` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-components-tooltip-bg` | 250 | deleted | `--ds-text-primary（反色底）` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-destructive-foreground` | 96 | deleted | `--ds-danger-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-info-foreground` | 111 | deleted | `--ds-info-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-secondary-foreground` | 90 | deleted | `--ds-text-primary` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-border` | 120 | deleted | `--ds-border-subtle` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-primary-foreground` | 117 | deleted | `--ds-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-sidebar-ring` | 121 | deleted | `--ds-focus-ring` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-state-base-handle-hover` | 196 | deleted | `--ds-border-strong` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-state-warning-solid` | 201 | deleted | `--ds-warning-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-success-foreground` | 107 | deleted | `--ds-success-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-accent-secondary` | 174 | deleted | `--ds-brand-text-muted` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-inverted` | 181 | deleted | `--ds-text-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-success-secondary` | 177 | deleted | `--ds-success-text` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-text-warning-secondary` | 179 | deleted | `--ds-warning-text` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-warning-foreground` | 109 | deleted | `--ds-warning-on-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-bg-transparent` | 208 | deleted | `--ds-surface-raised` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-border` | 209 | deleted | `--ds-border-subtle` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-block-border-highlight` | 210 | deleted | `--ds-brand-border` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-error-active` | 226 | deleted | `--ds-danger-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-active` | 221 | deleted | `--ds-warning-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-button-bg` | 223 | deleted | `--ds-warning-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-failure-handle` | 222 | deleted | `--ds-warning-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-normal-transparent` | 218 | deleted | `--ds-border` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--color-workflow-link-line-success-active` | 224 | deleted | `--ds-success-solid` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--radius-3xl` | — | deleted | `--ds-radius-2xl（16px）` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--radius-4xl` | — | deleted | `--ds-radius-2xl（16px）` | v1 零引用；v2 不声明，迁移到语义角色 |
| `--shadow-card-hover` | — | deleted | `--ds-shadow-overlay` | v1 零引用；v2 不声明，迁移到语义角色 |

## 11. 仍未解决 / 需拍板

- Button `loading`：需要 `button.tsx` 增加 `loading` prop 与 `aria-busy`；本轮只给规范与样式，不能只靠 CSS 设置 aria。
- DS-016：29 处字面字号、DS-017：44 处字面色值、DS-019：半档间距，需要下一轮 codemod；本轮不改运行时源码。
- Workflow 画布的 6/8/12/16 圆角覆写需在 `index.css:880-903` 删除，改用独立 workflow token。
- 三平台 mono 字宽是否值得引入 Geist Mono（+1 字体文件）。
- 插图/导出场景的字面色值是否永久登记为 illustration 例外（当前只登记在迁移说明，未进 token）。
- Empty 的 1px 虚线、输入框静止边框、Badge 12px 目前由覆盖层兜底；下一轮组件源码修好后应删除这些补丁，避免双保险。

---

生成器：`scripts/design-system/build-v2.mjs`。数据：`v2.generated.json`。预览：`index.html`。
