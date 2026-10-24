# 设计系统总纲

> 这份文档回答两个问题：
> 1. **哪些东西用现成的，哪些必须是我们自己的**——为什么这么定。
> 2. **遇到具体问题时该翻哪一份**——文档地图与权威边界。
>
> 它是这一套文档的**入口**，不是全部内容。各层的**执行细节**在分册里，本文只保留
> 取舍原则与索引，不重复分册的正文（同 [`README.md`](../README.md) 的「一个主题只在一处展开」）。

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

---

## 文档地图

一份文档只在一个主题上是权威。写别的文档时提到同一主题，**只写一句结论加链接**。

| # | 文档 | 权威范围（它说了算的部分） |
| --- | --- | --- |
| 1 | **本文** | 三层取舍原则、红线、文档地图、全局铁律 |
| 2 | [`design-token-mapping.md`](./design-token-mapping.md) | Carbon / Fluent 2 / Primer → osw 的**刻度映射**与证据来源；间距 / 字号 / 密度 / elevation / 状态矩阵的上游对照 |
| 3 | [`design-system-tokens.md`](./design-system-tokens.md) | **语义 token 全清单**、字面色值归位规则、**圆角体系**、新增 token 的门槛 |
| 4 | [`design-system-components.md`](./design-system-components.md) | **组件 API 约定**：variant vs 组合、props 命名、`components-*` 与组件的关系、新增组件的门槛 |
| 5 | [`design-system-accessibility.md`](./design-system-accessibility.md) | **无障碍基线**：对比度 / 触控目标 / 焦点可见 / 键盘完整性 / 动效降级 / IME / RTL / 播报 |
| 6 | [`design-system-typography.md`](./design-system-typography.md) | **排版规范**：字重 / 行高 / 字距 / 数字与等宽 / 截断与换行 |
| 7 | [`design-system-icons.md`](./design-system-icons.md) | **图标规范**：尺寸档 / 描边 / 基线与文字对齐 |
| 8 | [`design-system-data-display.md`](./design-system-data-display.md) | **表单与数据表格**：行高与密度 / 批量操作 / 空态、加载、错误态 |
| 9 | [`design-system-copy.md`](./design-system-copy.md) | **用语规范**：中英文案语气与长度、出错文案写法 |
| 10 | [`design-system-theming.md`](./design-system-theming.md) | **明暗两套的验证机制与 checklist** |
| 11 | [`design-system-ai-constraints.md`](./design-system-ai-constraints.md) | **AI 生成器约束**：允许 / 禁止 / 正确做法 |
| 12 | [`design-system-colors.md`](./design-system-colors.md) | **颜色体系**：12 步「角色骨架」与色值清单、每个色的来源与用量、实测到的色值冲突、新增颜色 token 的门槛 |
| — | [`i18n.md`](../data/i18n.md) | **语言分层与目录契约**（哪一层可切换语言、错误码契约）。本文档第 9 份只补「语气与长度」，不重复它 |

**读法**：

- 想知道「某个数字为什么是这个值」→ 第 2 份（映射与证据）。
- 想知道「我这段代码该写哪个 token」→ 第 3 份（归位规则）。
- 想知道「某个颜色值站第几步、为什么是这个色」→ 第 12 份（角色骨架与色值清单）。
- 想知道「这个 PR 会被打回吗」→ 第 5、10、11 份的清单。
- 想知道「上游到底怎么写的」→ 第 2 份 §8 的证据来源表，那里是**唯一**登记上游版本与路径的地方。

---

## 全局铁律

这四条对**所有**文档与所有 PR 生效：

| # | 铁律 | 判定方式 |
| --- | --- | --- |
| 1 | **语义命名**，禁止视觉命名 | `text-quaternary` ✅ / `gray-400`、`text-zinc-900`、`bg-red-500` ❌ |
| 2 | **品牌层只允许存在于 `styles/index.css` 的 `@theme` 与 `.dark`** | 组件里出现字面色值或任意像素，那条规则就已经不在设计系统里了 |
| 3 | **上游数值必须标来源** | 每个引用带 `[源码]` / `[文档]` / `[未核实]` 标签，规则见 [`design-token-mapping.md`](./design-token-mapping.md) §0 |
| 4 | **核不到就写「未核实」，不许当结论用** | 每份分册都有「未核实」节；未核实项不进结论、不写成规则 |

---

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

### 补充判据：先用真元素，再谈原语

Radix 不提供"把任意容器变成按钮"的原语。实测仓库里存在 `role="button"` + `tabIndex={0}`
+ 手写 `Enter`/`Space` 的容器（清单见
[`design-system-accessibility.md`](./design-system-accessibility.md) §4.3）。

**这类代码的正确修法不是"改用 Radix"，而是换回真元素**（`<button>` / `<a>`），
焦点、`Enter`/`Space` 的角色差异、`:focus-visible`、`disabled` 语义全部由浏览器给出，
一行键盘逻辑都不需要写。

**规则**：`role="button"` 只允许出现在**无法改成真元素**的场合，且必须同时具备
`tabIndex` + `Enter`/`Space` + `:focus-visible` 三件套。三者缺一即为缺陷。

---

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

> 完整清单、每个 token 的用途与归位规则见
> [`design-system-tokens.md`](./design-system-tokens.md)；每个色值的**来源、用量与它站在
> 12 步骨架的第几步**见 [`design-system-colors.md`](./design-system-colors.md)。
> 本文不重复列举。

---

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

---

## 什么时候才允许改这一层

只在下面三种情况下动：

1. **成熟系统给了新证据**——比如 Carbon 把密度刻度扩了一档，且我们确实缺那一档
2. **真实的可访问性缺陷**——有具体复现，不是"感觉对比度不够"
3. **品牌层整体换血**——这是产品决策，不属于日常改动

**其他情况一律不改。** 设计系统的价值来自稳定，改动它的成本从来不是改动本身，而是
所有已经依赖它的地方要重新验证一遍。

具体的**新增 token 门槛**见 [`design-system-tokens.md`](./design-system-tokens.md)；
**新增组件的门槛**见 [`design-system-components.md`](./design-system-components.md)。

---

## 评审入口清单

PR 涉及界面改动时，先用这张**入口清单**筛一遍；每条都指向出细则的分册。

- [ ] 有没有手写焦点陷阱 / `Esc` 逻辑 / 键盘导航？（→ 打回，改用 Radix）——
      [`accessibility`](./design-system-accessibility.md) §5
- [ ] 有没有字面色值、任意像素、`!important` 覆盖 token？（→ 打回）——
      [`tokens`](./design-system-tokens.md) §3、§4
- [ ] 新增的颜色是否落在 [`colors`](./design-system-colors.md) 的 12 步骨架里，
      且过了该文 §6 的门槛？（不是"看着好看"就能加）——
      [`colors`](./design-system-colors.md) §6
- [ ] 新增状态是否复用了 `components-*` 的既有档位？——
      [`components`](./design-system-components.md) §5
- [ ] 明暗两套是否都验证过？（`.dark` 覆盖是否补齐）——
      [`theming`](./design-system-theming.md) §3
- [ ] `prefers-reduced-motion` 下动效是否降级？——
      [`accessibility`](./design-system-accessibility.md) §5
- [ ] 触控目标是否 ≥ 24px（主操作 ≥ 44px）、正文对比度是否 ≥ 4.5:1？——
      [`accessibility`](./design-system-accessibility.md) §2、§1
- [ ] 用户可见文案是否按 [`copy`](./design-system-copy.md) 写、且进了 i18n 目录？
- [ ] 如果是 AI 生成的界面，是否满足
      [`ai-constraints`](./design-system-ai-constraints.md) 的允许清单？

---

## 与成熟系统对照速查

| 我们有的 | 对应成熟系统里的 | 备注 |
| --- | --- | --- |
| `components-button-{primary,secondary,tertiary}` | Primer 的 button 变体 / Carbon 的 `button--primary` | 三档，每档含 hover |
| `text-{primary..quaternary}` | Carbon 的 `text-primary/secondary/helper/placeholder` | 四档语义层级 |
| `--radius` 派生四档 | Fluent 2 的 `borderRadius*` | 单一基准派生，不是独立取值 |
| `chart-1..5` | Carbon 的 categorical palette | 5 色，够用不加 |
| `module-border` / `panel-border` | Carbon 的 `border-subtle` / `border-strong` | 结构分隔 vs 容器边界 |

---

## 未核实项

**本文没有独立的上游数值引用**——所有上游数值都在
[`design-token-mapping.md`](./design-token-mapping.md) §8（证据来源）与 §9（未核实项），
以及各分册自己的「未核实」节。

本文的三层取舍属于**我们的产品决策**，不依赖外部来源；其中"红牌来自 Radix"一句的
行为清单，依据是 `components/ui/*` 的实际实现（`rg` 可复现），不是上游文档。
