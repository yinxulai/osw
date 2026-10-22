# 语义 token 清单与归位规则

> 本文是 [`design-system.md`](./design-system.md) 第二层与第三层的**执行细则**，覆盖 issue #124 的两项缺口：
> **语义 token 全清单 + 归位规则**、**圆角体系**。
>
> 它回答三个问题：
> 1. **现在有哪些 token**（全清单，按用途分类，标出谁可以用）。
> 2. **我手上这个字面值该归到哪**（44 处字面色值 + 17 处任意圆角，逐条给出落点）。
> 3. **什么情况下才允许新增 token**（门槛，不是原则口号）。
>
> 上游数值与刻度映射不在本文——那是 [`design-token-mapping.md`](./design-token-mapping.md)。

## 范围与不做什么

- 本文**只做清单与归位**：不改任何 token 的值、不动组件、不新增依赖、不碰 `styles/index.css`。
- 工作对象是 `packages/console/source/styles/index.css` 与 `packages/console/source/**`。
- **本文不写入任何未经核实的数值**；核实不到的一律标 `[未核实]` 并列进 §8。
- 归位表的每一行都标了**出处**（文件 + 行号），可用 §8 的命令复现。

## 0. 证据规则

沿用 [`design-token-mapping.md`](./design-token-mapping.md) §0 的三档标签：

| 标签 | 含义 |
| --- | --- |
| `[源码]` | 从本仓库或上游包的文件里读出的**原文** |
| `[文档]` | 上游官网文档页原文 |
| `[未核实]` | 抓不到、或上游已删除的概念——**不作为结论依据** |

---

## 1. token 定义在四个地方，不是一个

**这是最容易搞错的一点**：`styles/index.css` 里存在**四个**互不相同的定义层，
一处改动只影响它那一层。判断"这个 token 明暗会不会自动切"必须先看它在哪一层。

| 层 | 位置（行号） | 内容 | 明暗行为 |
| --- | --- | --- | --- |
| **A. `@theme inline`** | `index.css:63-127` | shadcn 语义色（39 个）+ 字体（3）+ 圆角（7）+ `--button-radius` | **反向依赖** B 层的 HSL 通道，自身不含具体色值 |
| **B. HSL 通道 `:root` / `.dark`** | `:root` `541-595`、`.dark` `597-641` | 39 个 HSL 通道变量（`--background: 0 0% 98%` 这种裸通道） | **这里才是明暗切换真正发生的地方**；两套 key 集合完全一致（实测，见 §7） |
| **C. `@theme`** | `index.css:137-287` | 104 个颜色 token + `--text-2xs`（编号、状态、工作流、组件级） | **不自动切**：必须在 `.dark` 里逐条同名覆盖 |
| **D. `.dark`** | `index.css:291-386` | C 层的 82 个同名覆盖 | 未覆盖的 22 个颜色 token 分两类，见 §7 |

**A 层与 B 层的关系**：

```css
--color-background: hsl(var(--background));   /* A 层：只做引用 */
--background: 0 0% 98%;                        /* B 层：真正的值，:root */
--background: 0 0% 7%;                         /* B 层：真正的值，.dark */
```

所以 A 层的 39 个 token **天生明暗双全，不需要也不应该在 D 层重复**。

**C 层是手工维护的**：新增一个 C 层颜色 token 而忘记在 D 层覆盖，会得到一个
"亮色下正确、暗色下沿用亮色值"的静默缺陷。完整机制与 checklist 见
[`design-system-theming.md`](./design-system-theming.md)。

---

## 2. 全清单：143 个颜色 token

### 2.1 A + B 层：shadcn 语义色（39 个）

用途：**应用骨架层**。页面容器、卡片、浮层、边框、默认文字色都走这一组。
新增组件时应**优先**在这里找，找不到再往 C 层看。

| 类别 | token（去掉 `--color-` 前缀） | 个数 |
| --- | --- | --- |
| 基础面 | `background` `foreground` `card` `card-foreground` `popover` `popover-foreground` | 6 |
| 主/次/静音 | `primary` `primary-foreground` `secondary` `secondary-foreground` `muted` `muted-foreground` `accent` `accent-foreground` | 8 |
| 危险 | `destructive` `destructive-foreground` | 2 |
| 描边与焦点 | `border` `input` `ring` | 3 |
| 状态色 | `success` `success-foreground` `warning` `warning-foreground` `info` `info-foreground` | 6 |
| 凹槽 | `inset` | 1 |
| 侧栏 | `sidebar` `sidebar-foreground` `sidebar-primary` `sidebar-primary-foreground` `sidebar-accent` `sidebar-accent-foreground` `sidebar-border` `sidebar-ring` | 8 |
| 图表 | `chart-1` `chart-2` `chart-3` `chart-4` `chart-5` | 5 |

> ⚠️ **`chart-1..5` 目前 0 处使用**（实测：`rg 'chart-[1-5]'` 在 `packages/console/source` 无命中）。
> 唯一的趋势图 `pages/overview/components/trend-chart.tsx` 走的是字面色值，见 §3。
> 这 5 个 token 不是多余，而是**该用没用**——归位见 §3.2 第 13 组。

### 2.2 C 层：`@theme` 的 104 个颜色 token

按用途分九类。**"谁可以用"** 一列是本清单的执行价值所在：

| 类别 | 前缀 / 示例 | 个数 | 用途 | 谁可以用 |
| --- | --- | --- | --- | --- |
| **文本层级** | `text-primary` `text-secondary` `text-tertiary` `text-quaternary` `text-accent` `text-accent-secondary` `text-destructive` `text-success(-secondary)` `text-warning(-secondary)` `text-disabled` `text-inverted` | 13 | 文字色。四档层级是**唯一**允许表达文字轻重的通道 | 所有组件 |
| **底色** | `background-body` `background-default(-hover/-subtle/-dimmed/-dodge)` | 6 | 页面级底色台阶 | 所有组件 |
| **交互态** | `state-base-hover(-alt)` `state-base-active` `state-base-handle(-hover)` `state-accent-solid(-hover/-active)` `state-success-solid` `state-warning-solid(-hover)` `state-destructive-solid(-hover)` | 13 | hover / active / 手柄（滑块、拖拽） | 所有组件 |
| **工作流节点** | `workflow-block-bg` `-bg-hover` `-bg-transparent` `-border` `-border-highlight` `-parma-bg` | 6 | 画布上的节点卡面与端口 | **仅 `pages/router`** |
| **工作流连线** | `workflow-link-line-{normal,normal-transparent,active,handle,success-active,success-handle,failure-active,failure-handle,failure-button-bg,error-active,error-handle}` | 11 | 连线与端点的运行状态 | **仅 `pages/router`** |
| **工作流画布** | `workflow-canvas-workflow-bg` `workflow-canvas-workflow-dot-color` | 2 | 画布底与网格点 | **仅 `pages/router`** |
| **组件级** | `components-*`（button 17 / input 9 / option-card 6 / panel 3 / actionbar 2 / tooltip-bg 1 / `module-border` 1） | 39 | **组件自己的状态档位**。契约见 [`design-system-components.md`](./design-system-components.md) §5 | 只有对应组件 |
| **图标色块** | `util-colors-{blue-brand-blue-brand,indigo-indigo,blue-blue,cyan-cyan,green-green,warning-warning,violet-violet,yellow-yellow,pink-pink}-500` | 9 | 节点图标色块专用 | **仅节点图标**，见 §3.3 |
| **热力图** | `heat-0` … `heat-4` | 5 | 用量分布热力色阶 | **仅 `usage-heat-grid`** |

**合计 104 个**（13+6+13+6+11+2+39+9+5）。

### 2.3 三个非颜色 token

| token | 值 | 位置 |
| --- | --- | --- |
| `--font-sans` | `'Geist Variable', sans-serif` | `index.css:64` |
| `--font-mono` | `"Source Code Pro", "SF Mono", "Fira Code", ui-monospace, …` | `index.css:66` |
| `--font-heading` | `var(--font-sans)`（复用，不另立字体） | `index.css:119` |
| `--text-2xs` | `0.6875rem`（11px，字号下限） | `index.css:141` |
| `--radius` + 6 档派生 + `--button-radius` | 见 §5 | `index.css:70-73,117-126` |

---

## 3. 字面色值：44 处逐条归位

### 3.1 计数口径（可复现）

```bash
cd packages/console/source
rg -o --no-filename '#[0-9a-fA-F]{3,8}\b' --glob '*.tsx' --glob '*.ts' . | wc -l   # 30
rg -o --no-filename 'rgba?\([^)]*\)'         --glob '*.tsx' --glob '*.ts' . | wc -l   # 14
```

**= 44 处**（含测试夹具 1 处）。口径**只统计十六进制与 `rgb()/rgba()`**：

- **不含** `hsl(var(--x))`——那是对 token 的引用，是正确的写法。
- **不含** `oklch(from var(--primary) …)`——这是**相对颜色语法**，从 `--primary` 派生，
  同样会随明暗自动切换。它出现在 `components/ui/bubble.tsx:29`（4 处，`tinted` 变体），
  属于**合法但未登记**：建议登记为 `components-bubble-tinted-*` 系列 token，
  但在登记前它不构成本节要归位的问题。

### 3.2 逐条归位表

**"处置"分三类**：`→ token`（该改，有现成落点）、`→ 例外`（该留，理由成立）、`→ 缺陷`（该改，且现在就有问题）。

| # | 出处 | 值 | 实际用途 | 处置 | 归位到 |
| --- | --- | --- | --- | --- | --- |
| 1 | `components/layout.tsx:69` | `rgb(0_0_0/0.06)` | 主内容卡片 `shadow-[0_1px_3px_…]` | **→ 缺陷** | 与 [`design-token-mapping.md`](./design-token-mapping.md) §5.3「保持无阴影、层级由明度台阶承担」**冲突**。该卡片已有 `bg-card` + `border-components-panel-border`，删掉投影即可；若要保留，就应登记 `--shadow-*` 并同时给 `.dark` 覆盖 |
| 2 | `components/ui/chart.tsx:68` | `#ccc`×3 `#fff`×2 | **属性选择器**里的匹配串：`[&_.recharts-cartesian-grid_line[stroke='#ccc']]` | **→ 例外（合法）** | 这些选择器要匹配 Recharts 自己生成的 `stroke` 属性值，换成 token 就匹配不上。**不可 token 化**，保持原样 |
| 3 | `components/ui/checkbox.tsx:16,17,21` | `#292929` `#1f1f1f` `rgb(16 24 40/0.5)` `rgb(200 206 218/0.5)` | **全部在块注释里**（第 15-28 行），解释"为什么描边用 `text-quaternary` 而不是 `border-input`" | **→ 不是使用** | 这 4 处是**文档**，不是字面色值。计数口径会把注释里的色值一起算进来——这是这个口径的已知偏差，**不应据此判缺陷** |
| 4 | `pages/model-management/components/provider-icon.tsx:45-48` | `#FFE066` `#FF9500` `#F0297C` `#7C3AED` | 品牌标志 `BrandMark` 的 SVG 渐变 4 个 stop | **→ 例外（品牌资产）** | 商标色不是 UI 语义色，任何 token 都表达不了"这是 logo 的第 2 个渐变锚点"。保持原样；与 `apps/docs/clarify.ts` 的 `theme.tokens.primary/accent` 同源 |
| 5 | `pages/overview/components/bill-content.tsx:92` | `#e23f35`×2 | 账单上那枚**印章**的边框色与文字色 | **→ token** | `border-destructive` + `text-destructive`。同一行还有 `text-zinc-900`（视觉命名，见 §4）→ `text-text-primary` |
| 6 | `pages/overview/components/bill-export-scene.tsx:54` | `rgba(13,18,26,0.74)` `rgba(24,32,45,0.62)` `rgba(9,13,19,0.78)` | **导出图**底板的深色半透明渐变 | **→ 例外（导出场景）** | 该层的契约是"导出 PNG 保留 alpha，贴到任何底色上都能融"（文件内注释原文）。它是一张**图片的背景**，不是应用 UI 的一层，且必须固定为深色——跟随主题会让导出的图在亮色系统上变样。保持原样 |
| 7 | `bill-export-scene.tsx:76` | `rgba(120,160,255,0.16)` | 导出底板的左上角冷光 | **→ 例外（导出场景）** | 同上 |
| 8 | `bill-export-scene.tsx:77` | `rgba(0,0,0,0.4)` | 导出底板的底部压暗 | **→ 例外（导出场景）** | 同上 |
| 9 | `pages/overview/components/receipt-controls.tsx:79,124` | `#0b0f16`×2 | 打印机预览场景的机身暗部 | **→ 例外（插图）** | 见 §3.3「插图场景」 |
| 10 | `receipt-printer-preview/decorations.tsx:25,33,34` | `#0a0c10` `rgba(16,24,40,0.24)` `#0f141c` | 出纸口暗边、纸条投影与台面阴影 | **→ 例外（插图）** | 同上 |
| 11 | `receipt-printer-preview/easter-egg.tsx:14` | `#20252f` | 彩蛋场景底色 | **→ 例外（插图）** | 同上 |
| 12 | `receipt-printer-preview/machine.tsx:22,23,36,70` | `#3ddc84`×2 `rgba(255,255,255,0.1)` `#0a0c10` | 机身状态灯辉光、机身渐变、描边 | **→ 例外（插图）** | 同上。注意 `#3ddc84` 在此**故意**不同于 `--state-success-solid`：它是"设备上的 LED"，不是应用的成功状态 |
| 13 | `receipt-printer-preview/paper.tsx:9,23` | `#20252f` `#fffefc` `rgba(16,24,40,0.04)` `rgba(16,24,40,0.35)` | 纸张底色、纸纹与投影 | **→ 例外（插图）** | 同上 |
| 14 | `pages/overview/components/trend-chart.tsx:15-18` | `#0891b2` `#64748b` `#14b8a6` `#f59e0b` | 趋势图 4 条系列的**系列色** | **→ token** | `chart-2` / `chart-3` / `chart-4` / `chart-5`（`chart-1..5` 已存在且**零使用**）。注意同文件 `:14` 的 `inputTokens` 写的是 `hsl(var(--success))`——**同一次映射里混用了两种写法**，归位时一并统一到 `chart-1` |
| 15 | `pages/overview/page.tsx:105` | `#20252f` `#fffefc` | 二维码的 `color: { dark, light }` 参数 | **→ 例外（二维码）** | 二维码必须是**二值高对比位图**，且作为 PNG 走 `toDataURL` 生成。跟随主题会让扫码率随主题变化，是功能缺陷而非风格问题 |
| 16 | `pages/tray/page.tsx:88` | `rgb(0_0_0/0.12)` `rgb(0_0_0/0.06)` | 托盘面板的窗口投影 `shadow-[0_8px_24px_…]` | **→ 例外（窗口层）** | 托盘是**无边框 + 透明的原生窗口**，窗口阴影只能由 CSS 画在内容卡片上（同文件注释原文：留白不够会被窗口边界裁掉一条边）。它与 §5.3「应用内不投影」不在同一层——**这条例外恰好解释了为什么托盘有阴影而页面内没有** |
| 17 | `pages/model-management/hooks/use-provider-dialog.test.tsx:67` | `#000000` | 测试夹具里的期望值 | **→ 不是使用** | 测试数据，不计入 |

**汇总**：

| 处置 | 处数 |
| --- | --- |
| 该归位到 token（#5、#14） | **6**（`bill-content` 2 + `trend-chart` 4） |
| 该删或该登记（#1） | **1** |
| 合法例外（#2、#4、#6-#8、#9-#13、#15、#16） | **33** |
| 不是使用（注释 #3、测试 #17） | **4** |
| **合计** | **44** |

> **结论（关键）**：44 处里**只有 6 处是真的该改**。其余 38 处要么是合法例外、
> 要么根本不是使用。这与 [`design-token-mapping.md`](./design-token-mapping.md) §1.1
> 对"78 处任意像素"的处置结论同向：**真正的缺口比计数看起来小得多**，
> 计数只用来定位，落点必须逐条看。

### 3.3 四类合法例外（写进规则，不要每次重新争）

| 例外类 | 判据 | 涉及 |
| --- | --- | --- |
| **导出场景层** | 该颜色是**导出产物（PNG）的一部分**，不随应用主题变化 | `bill-export-scene.tsx` 底板/冷光/压暗 |
| **插图场景** | 画的是**一个物件**（打印机、纸张、机身、LED），颜色属于该物件的材质，不属于应用语义 | `receipt-printer-preview/*`、`receipt-controls.tsx` |
| **品牌资产** | 商标 / logo 的固有颜色，且**没有对应的 UI 语义** | `provider-icon.tsx` 的渐变 stop |
| **库内部约定** | 值出现在**属性选择器**里，用于匹配第三方库生成的 DOM 属性 | `chart.tsx` 的 `[stroke='#ccc']` |

**这四类不构成缺陷，但必须在代码里留一行注释说明属于哪一类**——否则下一个人
（尤其是 AI 生成器）会把它当成"可以照抄的先例"。

### 3.4 新发现：视觉命名类名 34 处（不在上面 44 处口径内）

上面 §3.1 的口径**只统计十六进制与 `rgb()`**，它**漏掉了 Tailwind 调色板类名**——
而后者违反的是同一条第 1 号铁律（语义命名）。

```bash
cd packages/console/source
rg -o --no-filename '\b(text|bg|border|ring|from|to|via|fill|stroke)-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' --glob '*.tsx' --glob '*.ts' . | wc -l
# 34（其中生产代码 29 处 / 7 个文件，测试文件 5 处）
```

| 出处 | 处数 | 性质 | 处置 |
| --- | --- | --- | --- |
| `pages/overview/lib/format.ts:85-94` | 8 | `PROVIDER_COLORS` 数组：`bg-emerald-500` `bg-orange-500` `bg-indigo-500` `bg-zinc-700` `bg-rose-500` `bg-sky-500` `bg-amber-500` `bg-teal-500`，由 `getProviderColor(index)` 取模使用 | **→ token**：这是**分类色板**，与 `util-colors-*`（9 个，已存在）职责完全重叠。应改走 `util-colors-*`，或登记一组 `--color-categorical-1..8` |
| `pages/overview/components/failure-reasons.tsx:15-24` | 8 | `ERROR_COLORS` 数组，同上模式 | **→ token**：同上。注意这 8 色**没有语义**（不是"越红越严重"），所以不能映射到 `state-destructive-*`，只能进分类色板 |
| `pages/router/components/workflow-node.tsx` | 6 | 便签节点的 `bg-amber-50/80` `border-amber-300/70` `bg-amber-400/10` 等（**且全部写成 `dark:` 变体**，见 [`design-system-theming.md`](./design-system-theming.md) §2.4） | **→ token**：便签是**一个真实 UI 状态**（不是插图），应登记 `workflow-node-note-*` 一组 |
| `pages/request-logs/components/request-contents-stage.tsx` | 4 | `bg-amber-300/70` + `dark:bg-amber-400/25`（`:121`）、`bg-amber-300/70` + `dark:bg-amber-400/30`（`:145`） | **→ token**：同一组"搜索命中高亮"的明暗两态，正是 [`design-system-theming.md`](./design-system-theming.md) §2.4 说的"token 表达不了才用 `dark:`" 的反面——**它完全可以用一组 token 表达** |
| `pages/router/node-meta.ts:140` | 1 | `note` 节点的 `tone: 'bg-amber-500'` | **→ token**：同文件 `:146` 已用 `bg-util-colors-warning-warning-500`——**同一个文件里两种写法并存**。注释还解释了为什么便签要避开 `util-colors-yellow`，说明这是有意区分，但用了错的通道 |
| `pages/router/nodes/note-node.tsx:100` | 1 | `border-amber-500` | **→ token**：同上 |
| `pages/overview/components/bill-content.tsx:92` | 1 | `text-zinc-900`（账单合计数字） | **→ token**：`text-text-primary`（同属 §3.3 的「导出场景」例外，但视觉命名本身仍违规——例外免的是"不用 token"，不是"用视觉命名"） |
| 测试文件（`failure-reasons.test.tsx` 4 处、`node-meta.test.ts` 1 处） | 5 | 断言里的期望值 | **→ 不是使用** |

**这一条是本次新增的缺口**：原 [`design-token-mapping.md`](./design-token-mapping.md) §1.1
的"78 处任意像素"与本文 §3.1 的"44 处字面色值"**都没有覆盖调色板类名**。
四者相加才是"越出设计系统的写法"的完整口径：

| 口径 | 处数 | 命令（均在 `packages/console/source` 下执行） |
| --- | --- | --- |
| 任意像素 `[Npx]` | 78（**口径见右**） | 归属 [`design-token-mapping.md`](./design-token-mapping.md) §1.1，**该数字的计算口径没有记录在案**；本文以更宽的 glob 复测得 104 处（见 [`design-system-typography.md`](./design-system-typography.md) §9 未核实项）。**本文不改动 §1.1 的 78**，两者是口径差异不是矛盾 |
| 任意 rem/em `[N rem]` | 15 | `rg -o '\[[0-9.]+(rem\|em)\]'`（**新增口径**，见 §3.5） |
| 字面色值（hex/rgb） | 44 | `rg -o '#[0-9a-fA-F]{3,8}\|rgba?\([^)]*\)'` |
| 调色板类名 | **34** | `rg -o '\b(text\|bg\|border\|…)-(zinc\|red\|amber\|…)-[0-9]{2,3}\b'` |

### 3.5 另一个新增口径：任意 rem / em

`design-token-mapping.md` 的 78 处只统计 `[Npx]`，**漏掉了 `rem` / `em` 写法**（10 + 5 = 15 处）：

| 值 | 处数 | 性质 |
| --- | --- | --- |
| `[0.625rem]` | 4 | 10px，**小于 11px 下限**（`index.css:141` 写明"11px 是这套界面的字号下限，不要再往下压"）→ 其中 3 处在账单（导出场景例外），**1 处是真缺陷** |
| `[0.8rem]` | 3 | 12.8px，非刻度值 |
| `[2.3rem]` `[0.7rem]` `[0.5rem]` | 各 1 | 账单印章上的艺术字（插图例外） |
| `[0.2em]` `[0.22em]` `[0.18em]` `[0.16em]` `[0.08em]` | 各 1 | 字距，见 [`design-system-typography.md`](./design-system-typography.md) §5 |

> `[0.625rem]`(10px) 出现在 4 处，是**唯一突破了字号下限**的写法。逐处定位与处置见
> [`design-system-typography.md`](./design-system-typography.md) §2.1——
> 结论是 **3 处属于导出场景例外（`bill-content.tsx`），只有 1 处是界面里的真缺陷**
> （`components/ui/questionnaire.tsx:138` 的快捷键徽标）。

---

## 4. 圆角体系

### 4.1 现状：单一基准派生七档

`index.css:70-73` 与 `:117-126`：

| token | 定义 | 实际值 | 对应 Tailwind 类 |
| --- | --- | --- | --- |
| `--radius` | `0.375rem`（基准） | **6px** | — |
| `--radius-sm` | `calc(var(--radius) - 4px)` | **2px** | `rounded-sm` |
| `--radius-md` | `calc(var(--radius) - 2px)` | **4px** | `rounded-md` |
| `--radius-lg` | `var(--radius)` | **6px** | `rounded-lg` |
| `--radius-xl` | `calc(var(--radius) + 4px)` | **10px** | `rounded-xl` |
| `--radius-2xl` | `calc(var(--radius) * 1.8)` | **10.8px** | `rounded-2xl` |
| `--radius-3xl` | `calc(var(--radius) * 2.2)` | **13.2px** | `rounded-3xl` |
| `--radius-4xl` | `calc(var(--radius) * 2.6)` | **15.6px** | `rounded-4xl` |
| `--button-radius` | `0.375rem` | **6px** | `button { border-radius }`（`index.css:681`） |

**这是对的**：lg/md/xl 由单一 `--radius` 加减派生（对应
[`design-token-mapping.md`](./design-token-mapping.md) §7.5「不新增圆角刻度」的结论），
改 `--radius` 一处即可整体调整手感。

**两处不一致，需要知道**：

1. **`--button-radius` 是第二个基准**，值恰好等于 `--radius` 但**不联动**。改 `--radius`
   不会改按钮圆角。`[未核实]`：无法确定这是有意留出的独立旋钮，还是历史残留。
2. **`2xl/3xl/4xl` 用乘法而不是加减**，且 **非整数**（10.8 / 13.2 / 15.6）。小数点会让
   同一档在不同缩放下的像素取整不一致（10.8px 在 1x 屏上可能渲成 10 或 11px）。
   下游若要精确值，用 `calc` 而不是期望一个整数。

### 4.2 作用域还原：`workflow-ui-surface`

`index.css:818-841` 定义了一个作用域类，在它内部**把 Tailwind 默认圆角刻度还原回来**：

| 类（在 `workflow-ui-surface` 内） | 还原值 | 默认（本仓） |
| --- | --- | --- |
| `rounded-md` | 6px | 4px |
| `rounded-lg` | 8px | 6px |
| `rounded-xl` | 12px | 10px |
| `rounded-2xl` | 16px | 10.8px |

**为什么存在**：工作流画布与面板是逐字移植的上游组件，上游按 Tailwind 默认刻度写，
而本仓把 `--radius-*` 整体调小了（`index.css:812-817` 注释原文）。作用域类由
**节点画布、节点面板、测试抽屉各自携带**，且**必须挂在浮层元素自己身上**——
浮层被 portal 到 `body`，脱离画布作用域。

**读表时的含义**：看到 `pages/router/**` 里的 `rounded-md/lg/xl/2xl`，**要先去确认
它是否在该作用域内**，否则算出来的像素是错的。这是本文最容易踩的坑。

### 4.3 17 处任意圆角逐条归位

口径（与 [`design-token-mapping.md`](./design-token-mapping.md) §1.1 的 17 处一致）：

```bash
cd packages/console/source
rg -o --no-filename 'rounded[a-z-]*\[[0-9]+px\]' --glob '*.tsx' --glob '*.ts' . | wc -l   # 17
```

> 另有 **8 处** `rounded-[min(...)]` / `rounded-[calc(...)]` / `rounded-[inherit]`
> （`rounded-[min(var(--radius-md),10px)]`×2 等）。它们是**计算值或继承**，
> 不是离散刻度越界，**不在本表**。

| # | 出处 | 值 | 处置 | 归位到 |
| --- | --- | --- | --- | --- |
| 1 | `components/info-hint.tsx:31` | 4px | **→ token** | `rounded-md`（恰好 4px） |
| 2 | `components/model-test-panel.tsx:189` | 5px | **→ token** | `rounded-md`(4px)。5px 不在任何一档 |
| 3 | `components/ui/chart.tsx:225` | 2px | **→ token** | `rounded-sm`（恰好 2px） |
| 4 | `components/ui/chart.tsx:316` | 2px | **→ token** | `rounded-sm` |
| 5 | `components/ui/checkbox.tsx:27` | 4px | **→ token** | `rounded-md`。16px 的小方块上 4px 是合适的档 |
| 6 | `components/ui/questionnaire.tsx:122` | 4px | **→ token** | `rounded-md` |
| 7 | `components/ui/tooltip.tsx:51` | 2px | **→ token** | `rounded-sm`。Tooltip 的箭头/内衬用最小档是合理的 |
| 8 | `pages/overview/components/usage-heat-grid.tsx:114` | 2px | **→ token** | `rounded-sm` |
| 9 | `pages/overview/components/usage-heat-grid.tsx:124` | 2px | **→ token** | `rounded-sm` |
| 10 | `pages/overview/page.tsx:252` | 2px | **→ token** | `rounded-sm` |
| 11 | `pages/router/components/block-icon.tsx:16` | 5px | **→ token** | `rounded-md`(4px)。注意同文件 `:17` 的 `sm` 档用的就是 `rounded-md`——**同一个 map 里两种写法**，改掉即可自洽 |
| 12 | `pages/router/components/workflow-node.tsx:21` | 15px | **→ 保留，登记理由** | 见 §4.4「共心圆角」 |
| 13 | `pages/router/components/workflow-node.tsx:63` | 15px | **→ 保留，登记理由** | 同上 |
| 14 | `pages/router/nodes/note-node.tsx:100` | `rounded-br-[3px]` | **→ token** | `rounded-br-sm`(2px)。3px 不在任何一档；这是单角，注意不要改成四角 |
| 15 | `pages/router/rules/landing-editor.tsx:204` | 5px | **→ token** | `rounded-md`(4px) |
| 16 | `pages/tray/page.tsx:91` | 7px | **→ token** | `rounded-lg`(6px)。7px 不在任何一档 |
| 17 | `pages/overview/components/bill-export-scene.tsx:48` | 24px | **→ 例外（导出场景）** | 导出图的画布圆角是**固定产物尺寸**（`SCENE_WIDTH = 520` 同层），跟随主题刻度会让导出的图在不同版本间不一致。保持原样并注释 |

**汇总**：13 处归位到 `rounded-sm` / `rounded-md` / `rounded-lg`（**全部有现成档，不需要新增圆角 token**）；
2 处登记为例外（共心圆角）；1 处为导出场景例外；1 处为单角归位。

### 4.4 共心圆角规则（为什么 15px 是对的）

`workflow-node.tsx:20-22` 的注释写明了结构：**外层容器 `rounded-2xl` + 1px 边框，
内层 `rounded-[15px]`**。

外层在 `workflow-ui-surface` 作用域内，`rounded-2xl` 还原为 **16px**；内层 15px。
**16 − 1 = 15**：内层比外层小一个边框宽度，两条弧才**共心**，边框粗细看起来才是均匀的。
这是一个正确实现，不是刻度越界。

**把它写成规则**：

| 场景 | 做法 |
| --- | --- |
| 有边框的嵌套圆角 | 内层 = 外层 − 边框宽度。**必须留注释写出这个减法**，否则看起来像魔数 |
| 无边框的嵌套 | 内层取同一档或相邻档，不要做减法 |

**为什么不直接改成 `rounded-4xl`(15.6px)**：15.6 与 16 的差是 0.4px，共心关系会破掉，
边框在四个角上粗细不均。**这是"归位"不该机械执行的反例**——归位的目标是消除即兴值，
不是消灭所有不是 token 的数字。

---

## 5. `components-*` 与组件的关系

`components-*` 是**组件自己的状态档位**，不是通用色板。它的边界规则：

| 规则 | 说明 |
| --- | --- |
| **一个前缀只服务一个组件** | `components-button-*` 只允许 `components/ui/button.tsx` 用；别的组件要用按钮的外观，就渲染一个 `<Button>` |
| **通道命名固定** | `-bg` / `-bg-hover` / `-text` / `-border` / `-border-hover`。新增通道必须沿用这五个后缀之一 |
| **变体名进前缀** | `components-button-{primary,secondary,tertiary,ghost,destructive-ghost}-*`——变体名是 token 名的一部分 |
| **形状类语义** | `components-option-card-option-{bg,border}-{hover,selected}-…` 用**交互态**做后缀，不用颜色词 |
| **不许跨组件借用** | 需要"和某个组件一样"时，要么用该组件，要么走 `state-*` / `text-*` 这类通用层 |

`components-*` 的现状、缺口与新增流程见
[`design-system-components.md`](./design-system-components.md) §5。

---

## 6. 什么时候才允许新增 token

**门槛（四条全过才新增）**：

| # | 条件 | 反例（不满足） |
| --- | --- | --- |
| 1 | **现有 token 里没有任何一个能表达同一语义** | "我想要一个比 `text-tertiary` 稍淡的" → 用 `text-quaternary` |
| 2 | **它是语义的，不是视觉的** | `gray-400` ❌ / `text-quaternary` ✅ / `module-border` ✅ |
| 3 | **它会在两个以上位置被用到**（或它属于一个已存在的 token 族，如 `components-*` 的补格） | 单点使用 → 就地写类名 |
| 4 | **明暗两套都能给出值**（颜色 token）；若是品牌层，值只能写在 `@theme` 与 `.dark` | 给不出暗色值 → 说明它不该是 token |

**附加约束**：

- **不允许**为了消除一个任意像素而新增刻度。任意值的正确处置是**归位到现有档**（§4.3 的 17 处里 13 处都是这么处理的），
  只有当**同一档在 3 处以上被即兴写出**时才考虑补格——这正是 `design-token-mapping.md`
  §7.1 为 `--text-compact`(13px) 立论的方式（25 处任意值 + 整套 `system-sm-*`）。
- **不允许**新增视觉命名色。要表达"红色"就用 `destructive` / `text-destructive`。
- 新增后必须同步：`@theme` → `.dark` 覆盖 → 本文 §2 的清单 → 使用处。

### 现已登记的候选（等实施决定，不在本文执行）

来源：[`design-token-mapping.md`](./design-token-mapping.md) §7。本文只登记，不重复论证。

| 候选 | 处数依据 | 可行性判断 |
| --- | --- | --- |
| `--text-compact`(13px) | 25 处 `text-[13px]` + 整套 `system-sm-*` | **过门槛**：高频、语义明确（紧凑控件文本）、只缺这一格 |
| `--blur-panel`(5px) | 11 处 `backdrop-blur-[5px]` | **过门槛 3**（≥2 处），且是本仓唯一浮层分离手段 |
| `--z-*` 六个语义层 | `z-10/20/30/40/50/70` 混用 | **过门槛**：对照 Primer `zIndex.*`，见映射文档 §7.3 |
| `components-button-*-{bg,text,border}-disabled` 等三组 | 状态矩阵缺口 23 格 | 见 [`design-system-components.md`](./design-system-components.md) §5.3 |
| 分类色板（8~9 色） | §3.4 的 16 处调色板类名 | **新增候选**：`util-colors-*` 已有 9 个，优先复用而非新建 |
| `components-bubble-tinted-*` | `oklch(from var(--primary) …)` 4 处 | **新增候选**：目前是合法但未登记的派生值 |
| `workflow-node-note-*` | §3.4 的便签 8 处 | **新增候选**：真实 UI 状态走错了通道 |

---

## 7. 明暗覆盖的机械核算

本文只给**核算结果**用于判断 token 是否"双全"；机制与 checklist 在
[`design-system-theming.md`](./design-system-theming.md)。

| 核算 | 结果 |
| --- | --- |
| B 层 `:root` 与 `.dark` 的 key 集合 | **各 39 个，完全一致**（`diff` 无差异）→ A 层 39 个 token 自动双全 |
| C 层 `@theme` 颜色 token | 104 个 |
| D 层 `.dark` 覆盖 | 82 个 |
| **未覆盖** | **22 个**：13 个派生自 `--primary`（B 层已切，无需覆盖）+ 9 个 `util-colors-*`（注释写明"明暗共用同一组值"） |

**22 个未覆盖全部有正当理由**，即当前覆盖是完整的。复现命令见 §8。

---

## 8. 证据来源与复现命令

| 来源 | 路径 / 命令 | 用于 |
| --- | --- | --- |
| 本仓 token 定义 | `packages/console/source/styles/index.css:63-127,137-287,291-386,541-641` | §1、§2 全部清单与计数 |
| 任意像素 | `rg -o '\[[0-9]+px\]'`（在 `packages/console/source`） | §4.3 |
| 任意 rem/em | `rg -o '\[[0-9.]+(rem\|em)\]'` | §3.5 |
| 字面色值 | `rg -o '#[0-9a-fA-F]{3,8}\|rgba?\([^)]*\)'` | §3.1 |
| 调色板类名 | 见 §3.4 命令 | §3.4 |
| `chart-1..5` 使用 | `rg 'chart-[1-5]' packages/console/source` → 无命中 | §2.1 |
| 明暗覆盖核算 | 见下方三条命令 | §7 |

```bash
cd packages/console/source/styles
# C 层 token（@theme）
sed -n '137,287p' index.css | rg -o '^\s+--[a-z0-9-]+' | tr -d ' ' | sort > /tmp/theme.txt
# D 层覆盖（.dark）
sed -n '291,386p'  index.css | rg -o '^\s+--[a-z0-9-]+' | tr -d ' ' | sort > /tmp/dark.txt
# 只在 C 层、未在 D 层覆盖的
comm -23 /tmp/theme.txt /tmp/dark.txt
# B 层两套 key 是否一致（无输出即一致）
diff <(sed -n '542,595p' index.css | rg -o '^\s+--[a-z0-9-]+' | tr -d ' ' | sort) \
     <(sed -n '597,641p' index.css | rg -o '^\s+--[a-z0-9-]+' | tr -d ' ' | sort)
```

---

## 9. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **`--button-radius` 是否是有意与 `--radius` 解耦** | `[未核实]` | `index.css:117-118` 两行相邻且值相同，仓库里没有注释说明为何要两个变量。无法从代码判定是"独立旋钮"还是"历史残留" |
| **`pages/request-logs/components/request-contents-stage.tsx` 的 `bg-amber-400` / `bg-amber-300` 用途** | `[未核实]` | 只看到类名，未读该组件的语义上下文；无法判定它属于"报文高亮"（该有 token）还是"插图/标记"（可以是例外）。**未当作结论** |
| **`2xl/3xl/4xl` 非整数圆角是否存在像素取整问题** | `[未核实]` | 需要在实际 1x / 1.25x / 1.5x 缩放下测量渲染结果。仓库里没有相关记录，本文只陈述"值是非整数"这一事实 |
| **`util-colors-*` 的 9 个色值是否有上游依据** | `[未核实]` | `index.css:265` 注释只写"节点图标色块专用，明暗共用同一组值"，未标上游来源；`design-token-mapping.md` §8 也没有登记它们的出处 |
| **44 处计数中注释占比** | 已核实 4 处 | 已逐条确认 `checkbox.tsx` 的 4 处在注释内；其余 40 处均为真实代码或测试夹具。**无法机械区分注释与代码**，需人工逐条看——这是这个口径的已知局限 |
