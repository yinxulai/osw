# 图标规范

> 本文是 [`design-system.md`](./design-system.md) 第二层（刻度与状态层）在**图标**上的细则，
> 覆盖 issue #124 的缺口：**图标规范**。
>
> 本文只讲**尺寸、描边、基线与文字对齐**——图标的**无障碍**（`aria-hidden`、纯图标按钮的可访问名）
> 在 [`design-system-accessibility.md`](./design-system-accessibility.md) §8，
> 图标的**颜色**（`util-colors-*` 色块）在 [`design-system-tokens.md`](./design-system-tokens.md) §2.2。
>
> **本文不改代码**：现状一律标注，缺口登记为待办。

## 0. 现状摘要（实测）

图标这件事在 osw **没有规范，只有习惯**——习惯的三条是：

1. **图标库只有 `lucide-react`**（`package.json:78`，`^1.56.0`），22 个文件从它取图标。
2. **默认不写尺寸**：`components/ui/*` 的根类里有 `[&_svg:not([class*='size-'])]:size-4`，
   所以**不写 `size` 也不写类名时，图标就是 16px**。这是本仓库默认值的来源。
3. **要别的尺寸就写 `size={N}`**——但**实测有 14 种不同的 N**。

第 3 条就是缺口：`size={N}` 的取值分布是

| N | 7 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18 | 20 | 21 | 22 | 27 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 处数 | 1 | 3 | 4 | **16** | 13 | **28** | **35** | 5 | 8 | 2 | 3 | 1 | 3 | 1 |

**14 档里没有任何一档是系统给出的**，全是逐处拍的数字。相邻档只差 1px（11/12/13/14/15）
意味着"这个图标比那个大半号"是**无法维护的意图**。

> 复现（`size={2}` 是 React Flow `<Background>` 的点阵尺寸，不是图标，已排除；
> `21` / `27` 是 `ProviderIcon` 的品牌标志画布，见 §5）：

```bash
cd packages/console/source
rg -o --no-filename '\bsize=\{[0-9]+\}' --glob '*.tsx' . | sort | uniq -c | sort -rn
```

---

## 1. 唯一的图标库：lucide-react

| 项 | 事实 |
| --- | --- |
| 依赖 | `lucide-react: ^1.56.0`，声明在**根** `package.json:78`（不是 console 自己的） |
| 引用 | **22 个文件**显式 `import … from "lucide-react"` |
| 类型 | 组件 props 里用 `type LucideIcon`（`table-state.tsx:2`、`empty-state.tsx:2`、`inline-empty-state.tsx:1`、`request-detail-primitives.tsx:2`、`routing/navigation.ts:11`） |
| 其他图标库 | **无**（无 `@heroicons` / `react-icons` / `phosphor` / `@radix-ui/react-icons`） |
| 自带描边 | **2**（lucide 默认 `strokeWidth={2}`） |
| 自带尺寸 | **24**（lucide 默认 `size={24}`）—— 所以**任何不写尺寸的裸图标都是 24px**，见 §2 |

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **只从 `lucide-react` 取图标**。需要 lucide 没有的形状 → 走 §5 的自绘流程，不要引入第二个库 |
| 2 | **不要在同一个界面里混用"填充图标"和"描边图标"**。lucide 全是描边风格，唯一的填充图形是品牌标志（§5） |
| 3 | **图标名保持 lucide 原名**（`ChevronRight`、`TriangleAlert`），不要包一层改名。全仓 22 个文件的直接 import 就是这个约定的体现 |

---

## 2. 尺寸：归一为五档

### 2.1 默认值来自父组件，不来自图标

`components/ui/*` 的根类里普遍带这一段（**17 处** `[&_svg:not([class*='size-'])]` 的变体）：

```
[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4
```

含义：**子元素里的 `<svg>` 若没有自己的尺寸类，就统一 16px**。所以：

| 写法 | 结果 |
| --- | --- |
| `<Search />`（在 Button 里） | **16px**，由父类的 `:size-4` 给出 |
| `<Search size={14} />` | **14px**，`size` 属性会产生 `width`/`height` 属性，**类选择器管不到它** |
| `<Search className="size-3.5" />` | **14px**，因为带了 `size-` 类名，父类的 `:not([class*='size-'])` 主动让路 |

**这是本仓库图标尺寸的完整机制**（三条路径，优先级从下往上）。
理解它之后，"为什么有的图标写了 `size={}` 有的没写"就有答案了：
**默认 16px 服务于按钮/输入框这类容器；离开容器语境（裸用、表格行内）就需要显式给。**

### 2.2 归一后的五档

现在 14 档。按**用途**收敛成 5 档（每一档都有大量现有用法支撑，不是新造的）：

| 档 | 尺寸 | 用途 | 现状里已有多少处 |
| --- | --- | --- | --- |
| `inline` | **12px** | 与 11/12px 文字同行的行内图标、表头排序指示、徽标里的图标 | `size={12}` 13 + `size={11}` 16 + `size={10}` 4 + `size={9}` 3 = **36** |
| `compact` | **14px** | 表格行内操作、紧凑工具条、次级按钮 | `size={14}` 35 + `size={13}` 28 + `size={15}` 5 = **68** |
| `default` | **16px** | 默认值（父类给），按钮/输入框/菜单项 | 由父类给出的全部（`size-4` 类 **96** 处） |
| `display` | **20px** | 空态/错误态插图、卡片角标 | `size={20}` 3 + `size={22}` 3 + `size={18}` 2 = **8** |
| `hero` | **24px** | 大号空态（`empty-state.tsx:30` 的 `size={embedded ? 24 : 30}`） | 少量 |

**⚠️ 归一为"建议"而非"立即执行"**——
[`design-token-mapping.md`](./design-token-mapping.md) 已确立"归位不是一次性重写"的口径，
本文同样只登记方向：

> **新代码的图标尺寸只允许取 12 / 14 / 16 / 20 / 24。**
> 现有代码在**碰到时**归位，不做全局替换（11→12、13→14 会让已调好的对齐位移，
> 必须**逐处看**，不能批量改）。

**11px 档为什么归到 12 而不是保留**：11px 图标（16 处）目前都出现在 11/12px 文字旁边
（`request-logs-table.tsx:107-123` 的 `size={11} className="mr-0.5 inline"`）。
图标高度 11px 配 16px 行高时，**基线下沉**要靠 `mr-0.5` 这类微调补救——
抬到 12px 反而更稳。**这是建议，需要真机对比**（见 §7 未核实）。

---

## 3. 描边：默认 2，例外要写理由

### 3.1 事实

只有 **10 处**显式写了 `strokeWidth`：

| 值 | 处数 | 位置 |
| --- | --- | --- |
| `1.5` | 5 | `inline-empty-state.tsx:17`（20px）、`error-boundary.tsx:126`（18px）、`model-test-panel.tsx:629`（20px）、`table-state.tsx:29`（22px）、`empty-state.tsx:30`（24/30px） |
| `1.75` | 2 | `receipt-controls.tsx:55`（14px）、`receipt-printer-preview/machine.tsx:41`（13px） |
| `2` | 2 | `workflow-connection-line.tsx:27`、`workflow-edge.tsx:95`（**是连线，不是图标**） |
| `34` | 1 | `provider-icon.tsx:58`（品牌标志的笔宽，见 §5） |

其余全部走 lucide 默认的 **2**。

### 3.2 规则

| # | 规则 | 依据 |
| --- | --- | --- |
| 1 | **默认 2**，不写就是 2 | lucide 默认值 |
| 2 | **≥20px 的大图标降到 1.5** | 5 处 `1.5` 全部是 18–30px 的大图标。理由：描边是**绝对宽度**，图标放大后线条相对变粗，观感变"重" |
| 3 | **深色/玻璃底上降到 1.75** | `receipt-controls.tsx:33` 的注释原文：**"图标 14px / 1.75 描边：比默认的 2px 细一档，落在深色玻璃上不会发糊。"** 这是仓库里唯一一处写明描边理由的注释，**应当成为写法范例** |
| 4 | **不要出现 1.25 / 2.5 这类中间值** | 描边在 1x 屏上会被舍入，值越怪越糊。当前只有 1.5 / 1.75 / 2 三种，保持住 |
| 5 | **同一组图标描边一致** | 一排图标里有的 1.5 有的 2，会被看成"有的坏了" |

---

## 4. 基线与文字对齐

### 4.1 事实

| 手段 | 处数 | 说明 |
| --- | --- | --- |
| `items-center`（flex 居中对齐） | 主流 | 绝大多数图标靠 flex 居中对齐，不靠 baseline |
| `shrink-0` | 大量 | 图标不被压缩。`[&_svg]:shrink-0` 是 `components/ui/*` 的标准配置 |
| `translate-y-0.5` | **4** | 2px 下移微调 |
| `translate-y-px` | **1** | 1px 下移微调 |
| `relative top-px` | **1** | 1px 下移微调 |
| `-mt-px` / `-ml-1.5` / `-mb-1.5` | 少量 | 负边距压紧（`protocol-icons.tsx:59`） |

**只有 6 处手工像素微调**——说明"居中对齐"这个策略在 osw 的排版下基本够用。

### 4.2 规则

| # | 规则 | 说明 |
| --- | --- | --- |
| 1 | **默认用 `items-center`**（flex 居中对齐），**不要用 `vertical-align: baseline`** | 图标的"基线"是它的底边，而文字基线在字面中部；靠 baseline 对齐必然要 `translate-y`，不如直接居中。6 处微调全是这么来的 |
| 2 | **图标必须 `shrink-0`** | 否则容器变窄时图标先被压扁 |
| 3 | **图标不参与 `truncate`** | 图标是被截断文本的兄弟节点，不是内容的一部分。截断文字外面必须包一层 `min-w-0`（见 [`design-system-typography.md`](./design-system-typography.md) §7） |
| 4 | **一行的图标与文字字号要匹配**：11/12px 文字配 12px 图标，13/14px 文字配 14px 图标，16px 文字配 16px 图标 | 这是 §2.2 五档的来由——**图标档跟着文字档走**，不独立选 |
| 5 | **像素微调（`translate-y-0.5` 等）要注释** | 每个都是有具体对齐目标的（如 `questionnaire.tsx:138` 的 `translate-y-[--spacing(0.45)]` 配快捷键徽标），不留注释就会被后人当成噪声删掉 |
| 6 | **行内图标与文字之间用 `gap-1` / `gap-1.5`，不要用空格字符** | 空格字符在截断时会变成一个可见的悬挂空白 |

---

## 5. 品牌标志是另一套，不适用上述尺寸

`pages/model-management/components/provider-icon.tsx` 是**自绘 SVG**，不是 lucide：

| 项 | 事实 |
| --- | --- |
| 画布 | `BRAND_MARK_BOX = 256`，与 `packages/console/public/icon.svg` 的 `viewBox` 一致 |
| 供应商图标内框 | `120` 画布里的 `65`（≈54.2%），`provider-icon.tsx:29-33` 有完整注释 |
| 自绘笔宽 | `strokeWidth="34"`（`provider-icon.tsx:58`），是**按 256 画布折算**的，不是图标描边 |
| 调用尺寸 | `size={27}`（`provider-detail-header.tsx:37`）、`size={21}`（`provider-grid.tsx:111`） |

**规则**：

| # | 规则 |
| --- | --- |
| 1 | **品牌标志的尺寸是"盒子尺寸"**，不是图标尺寸。21 / 27 这类值不需要归到 §2.2 的五档——它们是与头像/卡片对齐算出来的 |
| 2 | **品牌标志的几何以 `packages/console/public/icon.svg` 为唯一真源**（`provider-icon.tsx:13` 原话），改形状先改那个文件 |
| 3 | **图标配色只用于"节点图标色块"**：`util-colors-*-500` 的语义见 [`design-system-tokens.md`](./design-system-tokens.md) §2.2，**不要**把 `util-colors-*` 用在普通图标上 |
| 4 | **协议图标走 `PROTOCOL_ICONS` 单一映射**（`components/protocol-icons.tsx:15-19`）：`openai-completions` → `MessageSquareCode`、`openai-responses` → `Sparkles`、`anthropic-messages` → `BotMessageSquare`。该文件注释写明理由——**"同一个协议在哪儿都得长得一样"**。新增协议 → 改这一处，不要就地 import |

---

## 6. 无障碍

完整基线在 [`design-system-accessibility.md`](./design-system-accessibility.md) §8，图标相关的三条：

| # | 规则 |
| --- | --- |
| 1 | **装饰性图标不写 `aria-hidden`**——`lucide-react` 在无 `aria-*` / `role` / `title` 时**自动加** `aria-hidden="true"`（`[源码]`，`lucide-react@1.59.0` 的 `dist/esm/shared/src/build/buildLucideIconNode.mjs:47-49`）。仓库里有些地方手写了 `aria-hidden`（如 `table-state.tsx:29`），**多余但无害**；新代码不必写 |
| 2 | **纯图标按钮必须有 `aria-label`**，且文案来自 i18n 目录（示例：`table-primitives.tsx:43,46` 的翻页按钮） |
| 3 | **图标不能是唯一的信息载体**：状态色块旁要有文字或 `aria-label`（`node-meta.ts:81` 的 `util-colors-*` 色块是纯颜色区分，**这是一种颜色单独承载信息的形态**，需在节点上另有文字标签） |

---

## 7. 落地清单

- [ ] 图标来自 `lucide-react`，没有引入第二个图标库
- [ ] 尺寸取自 **12 / 14 / 16 / 20 / 24** 五档之一
- [ ] 尺寸与同行文字字号匹配（11/12→12、13/14→14、16→16）
- [ ] 描边是 **2**（默认）或按规则降为 **1.5**（≥20px）/ **1.75**（深色玻璃底），且同组一致
- [ ] 同一排图标的描边宽度一致
- [ ] 图标有 `shrink-0`（在 flex 容器里）
- [ ] 容器是 `items-center`，没有额外的像素微调；若有微调则写了注释
- [ ] 纯图标按钮有 `aria-label` 且走 i18n 目录
- [ ] 没有把 `util-colors-*` 用在非节点图标的场合
- [ ] 新增协议图标只改 `protocol-icons.tsx` 的映射

---

## 8. 未核实项

| 项 | 状态 | 为什么 |
| --- | --- | --- |
| **成熟系统的图标尺寸刻度** | `[未核实]` | 本次**没有取到 Carbon `iconSize*` 的实际数值**（`@carbon/layout` 的产物里未定位到该组 token，`@carbon/styles` 的 `scss/` 里也没有 `icon-size` 定义）。因此本文的五档**完全基于仓库现有用法归纳**，没有上游对照。凡引用"Carbon 有 N 档图标尺寸"的说法，本文**不作为依据** |
| **11px 图标归到 12px 是否真的更对齐** | `[未核实]` | 11px 图标（16 处）目前配 `mr-0.5 inline`，12px 图标配什么没实测过。**需要真机对比基线**，本文只给方向 |
| **`size={N}` 属性与 `size-*` 类名混用的实际影响** | `[未核实]` | `size` 属性产生 `width`/`height` 属性（优先级低于类名），`size-*` 类名又被父类的 `:not([class*='size-'])` 让路。三条路径的优先级在**同时出现**时（如 `<Icon size={14} className="size-3" />`）以谁为准，本文按 CSS 优先级推断，**未实测** |
| **lucide 自动 `aria-hidden` 的版本行为** | `[未核实]` | 本文引用的是 `lucide-react@1.59.0` 的构建脚本；而**仓库声明的是 `^1.56.0`**（根 `package.json:78`），实际安装版本未核对。若安装的是 1.56.x，该自动行为是否存在**未验证** |
| **`empty-state.tsx:30` 的 `size={embedded ? 24 : 30}`** | `[未核实]` | 30px 不在 §2.2 的任何一档里，且 `embedded` 语义与尺寸的耦合理由未在代码中说明。**未判定是有意还是临时值** |
