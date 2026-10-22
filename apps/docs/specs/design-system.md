# 设计系统采用决策

> 这份文档回答一个问题：**哪些东西用现成的，哪些必须是我们自己的。**
>
> 它不描述"我们的设计系统长什么样"，而是描述"我们凭什么这么定"——因为后者才是团队里
> 最容易各说各话、也最容易被 AI 生成器无视的那一层。

## 结论先行

设计系统不是一整块，而是三层，**三层的取舍逻辑完全不同**：

| 层 | 内容 | 归谁 | 为什么不自己写 |
| --- | --- | --- | --- |
| **行为层** | 焦点、键盘、浮层、无障碍、动效降级 | **Radix（现成）** | 自研等于把几十人几年的 issue 重踩一遍 |
| **刻度与状态层** | 间距刻度、字号阶梯、层级、状态档位 | **采用成熟系统的数值** | 自己定 4px 还是 6px，没有收益，只有不一致 |
| **品牌层** | 主色、圆角手感、密度、语气 | **osw 自己** | 这层任何成熟系统都给不了，也不该给 |

一句话：**底层全盘采用，顶层只定品牌。**

反过来说，**"自己独立设计一套设计系统"是错的**——不是因为它难，而是因为它把本来
已经被验证过的部分重新变成未知数。

## 第一层：行为层 —— Radix，且是红线

osw 的交互原语已经建立在 **Radix** 上（`packages/console/source/components/ui/*`），
它提供的是**无样式但行为完整**的能力：焦点陷阱、`Esc` 逐层关闭、`aria-*` 标注、
键盘导航、滚动锁、RTL、指针与触摸事件归一。

**以下这些东西，任何 PR 都不允许手写：**

- 焦点陷阱与焦点归还（Dialog / Popover / Dropdown / Command 打开与关闭时）
- `Esc` 关闭的**逐层**语义（嵌套浮层时只关最上面一层）
- 键盘导航（`Tab` 顺序、方向键、`Home`/`End`、`Enter`/`Space` 的角色差异）
- `aria-*` 的完整标注（`aria-expanded` / `aria-controls` / `aria-labelledby` / `aria-live`）
- 滚动锁与 `body` 滚动位置恢复
- `prefers-reduced-motion` 降级
- IME 组合态（中文输入时的 `compositionstart` / `compositionend`）

> 判据很简单：**如果一个交互需要"记住用户在什么状态下按了什么"，它就该来自 Radix。**
> 手写这些的 PR 一律要求改回原语组合。

## 第二层：刻度与状态层 —— 采用成熟系统的数值

这一层是"看起来有没有专业感"的真正来源，也是最容易被自研破坏的一层。它包含：

- **间距刻度**（4 基准还是 8 基准，一共几档）
- **字号与行高阶梯**（几级，级差多少）
- **层级 elevation**（谁有阴影、谁半透明、谁在上）
- **状态档位矩阵**（hover / active / focus-visible / disabled / loading / error 各几档）
- **密度**（行高、内边距、控件高度）

**我们的做法：借数值，不借包。**

| 借谁 | 补什么 |
| --- | --- |
| **IBM Carbon** | 数据密集表格、批量操作、密度刻度（`spacing-01..13` 那套是完整的 13 档体系） |
| **Microsoft Fluent 2** | 桌面浮层、焦点管理、窗口化与最小化、动效时长与缓动 |
| **GitHub Primer** | 开发者工具语义、状态矩阵的完备性（它把每个状态的视觉差写得很死） |

> **为什么不整包引入？**
>
> 对已经跑起来的 osw，整包换一套（Carbon / MUI / Ant）意味着：样式体系冲突、包体暴涨、
> 组件 API 全改、测试全红。**迁移成本远大于收益**。
>
> 正确姿势是：**把它们的刻度映射到我们现有的 `@theme` 上**，取规范，不取依赖。

### 现状：osw 已有的刻度体系

`packages/console/source/styles/index.css`（Tailwind v4，`@theme inline` + `.dark` 同名覆盖）：

- **圆角**：由单一 `--radius` 派生 `--radius-sm|md|lg|xl`（`calc` 加减 2/4px），另有 `2xl/3xl/4xl`
- **字体**：`--font-sans` 走 Geist Variable；`--font-heading` 直接复用 sans
- **语义色**：`background / foreground / card / popover / muted / accent / destructive / border / input / ring`
- **状态色**：`success / warning / info`（各带 `-foreground`）
- **图表色**：`chart-1..5`
- **侧栏专用色**：`sidebar-*` 一整套（背景、前景、accent、border、ring）
- **组件级语义色**：`components-*`（button 的 primary/secondary/tertiary 三档，各含 bg / bg-hover / border / border-hover / text；input 的 hover/active 边框；option-card 的 hover/selected 边框）
- **文本层级**：`text-primary / secondary / tertiary / quaternary`
- **结构色**：`module-border`（模块分隔）、`panel-border`、`inset`、`workflow-block-border`

**这套已经是对的**：全是**语义命名**而不是视觉命名（`text-quaternary` 而不是 `gray-400`）。
这意味着换主题、换明暗、换品牌色都不需要改组件。**新增 token 必须延续这个约定。**

## 第三层：品牌层 —— 只此一处

这一层允许、且必须由我们决定：

- 主色与强调色
- 圆角基准值（`--radius`）
- 整体密度手感（紧凑 / 舒适）
- 动效的性格（克制还是活泼）
- 文案语气

**约束**：品牌变量只允许出现在 `styles/index.css` 的 `@theme` 与 `.dark` 里。
组件代码里**不允许出现任何字面色值**（`#fff`、`rgb(...)`、`text-[13px]`）。
一旦出现，那条规则就已经不在设计系统里了。

## 给 AI 生成器的约束

这条越来越重要：现在产出界面的不只是人，还有 Claude Code、Claude Design 这类生成器。

**它们必须遵守同一份决策**，否则同一次迭代里会长出两套不一致的东西：

1. 交互行为一律来自 Radix 原语，**不许生成手写的焦点/键盘逻辑**
2. 颜色、间距、圆角一律用**现有语义 token**，不许写字面色值或任意像素
3. 新增视觉状态时，先看 `components-*` 里有没有现成的档位，没有再提**新增 token**，而不是在组件里就地写死
4. 品牌层变量**只允许**改 `@theme`，不允许在组件里覆盖

> 如果某个生成器（比如 Claude Design）需要导入"我们的设计系统"，导入的应当是
> **第三层的几个变量 + 第二层的刻度 + 第一层的组件清单**——而不是让它重新猜。

## 评审清单

PR 涉及界面改动时，逐条过：

- [ ] 有没有手写焦点陷阱 / `Esc` 逻辑 / 键盘导航？（→ 打回，改用 Radix）
- [ ] 有没有字面色值、任意像素、`!important` 覆盖 token？（→ 打回）
- [ ] 新增状态是否复用了 `components-*` 的既有档位？
- [ ] 明暗两套是否都验证过？（`.dark` 覆盖是否补齐）
- [ ] `prefers-reduced-motion` 下动效是否降级？
- [ ] 触控目标是否 ≥ 44px、正文对比度是否 ≥ 4.5:1？

## 什么时候才允许改这一层

只在下面三种情况下动：

1. **成熟系统给了新证据**——比如 Carbon 把密度刻度扩了一档，且我们确实缺那一档
2. **真实的可访问性缺陷**——有具体复现，不是"感觉对比度不够"
3. **品牌层整体换血**——这是产品决策，不属于日常改动

**其他情况一律不改。** 设计系统的价值来自稳定，改动它的成本从来不是改动本身，而是
所有已经依赖它的地方要重新验证一遍。

## 与成熟系统对照速查

| 我们有的 | 对应成熟系统里的 | 备注 |
| --- | --- | --- |
| `components-button-{primary,secondary,tertiary}` | Primer 的 button 变体 / Carbon 的 `button--primary` | 三档，每档含 hover |
| `text-{primary..quaternary}` | Carbon 的 `text-primary/secondary/helper/placeholder` | 四档语义层级 |
| `--radius` 派生四档 | Fluent 2 的 `borderRadius*` | 单一基准派生，不是独立取值 |
| `chart-1..5` | Carbon 的 categorical palette | 5 色，够用不加 |
| `module-border` / `panel-border` | Carbon 的 `border-subtle` / `border-strong` | 结构分隔 vs 容器边界 |
