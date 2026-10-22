# 颜色体系：12 步角色骨架与色值清单

> 本文是 [`design-system.md`](./design-system.md) 第二层（刻度与状态层）在**颜色**上的分册。
>
> 它回答三个问题：
> 1. **这些色值从哪来**——为什么一个都不换。
> 2. **每个色值站在哪个「角色」上**——Radix Colors 的 12 步骨架，以及我们缺哪一步。
> 3. **哪些现象已经构成硬伤**——实测出来的，不是感觉出来的。
>
> **分工**：色值的**来源与角色骨架**在本文；语义命名、字面值归位与新增门槛的**清单侧**在
> 两文互链，**不重复正文**（本文 §7.1）；清单侧见
> [`design-system-tokens.md`](./design-system-tokens.md)。
>
> **本文不改代码**：不改 `styles/index.css`、不动组件、不新增依赖、不引入 npm 包。
> 现状一律标注，缺口登记为待办。

## 范围与不做什么

- 本文**只做骨架、清单与登记**：不改任何 token 的值、不碰组件。
- 工作对象是 `packages/console/source/styles/index.css` 与 `packages/console/source/**`。
- **不写入任何未经核实的数值**；核实不到的一律标 `[未核实]` 并列进 §9。
- 本文**不引入二进制资产**（不放色卡 PNG）——所有颜色用**十六进制值 + 可复现命令**表达，
  理由同 [`design-system-tokens.md`](./design-system-tokens.md) §0 的「证据规则」：
  图片不可 diff、不可 grep、会随渲染环境漂移。

## 0. 证据规则

沿用 [`design-token-mapping.md`](./design-token-mapping.md) §0 的三档标签：

| 标签 | 含义 |
| --- | --- |
| `[源码]` | 从本仓库或上游包的文件里读出的**原文** |
| `[文档]` | 上游官网文档页原文 |
| `[未核实]` | 抓不到、或上游已删除的概念——**不作为结论依据** |

**本文的色值全部是 `[源码]`**：逐条抄自 `styles/index.css`，行号标在表内。
从 HSL 通道换算出来的十六进制值标为 `（换算）`，换算方法与复现命令见 §8。

---

## 1. 骨架：Radix Colors 的 12 步「角色」

### 1.1 12 步角色表

Radix Colors 给每个色相（hue）定义 **12 个固定序号**，每个序号是一个**角色**而不是一个深浅：

| 步 | 角色 | 用在哪 |
| --- | --- | --- |
| **1** | 应用底 | 页面最底层背景 |
| **2** | 细微底 | 与 1 同层但需要区分开的条带、侧栏 |
| **3** | 组件底（rest） | 卡片、输入框、按钮的静止底色 |
| **4** | 组件悬停（hover） | 3 的悬停档 |
| **5** | 激活 / 选中（active / selected） | 按下档、选中档 |
| **6** | 细边框 · 分隔 | 最低对比的描边、分隔线 |
| **7** | 边框 · 焦点环 | 默认描边；也是焦点环所在的档 |
| **8** | 悬停边框 | 7 的悬停档，**必须比 7 更深** |
| **9** | 实心填充 | 实心按钮、实心徽标的底色（该色相的"品牌面"） |
| **10** | 悬停实心 | 9 的悬停档 |
| **11** | 低对比文本 | 正文、次级说明（要过 4.5:1） |
| **12** | 高对比文本 | 标题、强调（要过 7:1） |

**这条骨架的价值在于「序号即角色」**：一个色相只要 12 档就够描述一个完整的交互色系统，
而**同一个角色在不同色相上处在同一个序号**——红、绿、蓝的第 6 步是同一件事。
这正是我们缺的东西：我们有 143 个颜色 token（[`design-system-tokens.md`](./design-system-tokens.md) §2），
但**没有一根轴说明"这个 token 站在第几档"**。

> `[未核实]`：**Radix Colors 12 步的官方原文没有留存在本仓库**，
> 仓库内也没有 `@radix-ui/colors` 包（§8 的复现命令可验证）。
> 上表是**我们的转述**，未与上游文档逐条比对。见 §9 第 1 项。

### 1.2 借的是「角色」，不是包、也不是色值

| 借什么 | 借不借 | 为什么 |
| --- | --- | --- |
| **12 步「角色」的分法** | ✅ **借** | 这是"选出来的体系"——它把"一个色相需要哪几档"这件事定义完了 |
| **Radix Colors 的色值** | ❌ 不借 | 我们的色值已经全部落位（§2），换值 = 全站视觉走样 |
| **`@radix-ui/colors` npm 包** | ❌ 不借 | **零依赖**。我们借的是一张**表**，不是一个运行时 |

**零依赖是硬的**（§8 可复现）：`@radix-ui/colors` **不是**本仓库任何 `package.json` 的依赖。
根 `package.json:54-61` 只有 8 个 `@radix-ui/react-*` **行为原语**（dialog / dropdown-menu /
label / select / slot / switch / tabs / tooltip）——它们**只提供行为，不含任何颜色**。

> 这与 [`design-system.md`](./design-system.md) 的「第一层：行为层」是同一个取舍的两个面：
> **行为层借 Radix（带依赖），颜色骨架借 Radix 的角色（不带依赖）。**

### 1.3 为什么色值一个都不换

**一句话：我们缺的是「角色」，不是「颜色」。**

| 论点 | 依据 |
| --- | --- |
| **色值已经是一套完整、自洽的体系** | 11 档中性色**覆盖了从页面底到主文本的全部区间，且没有空档**（§3.1 的逐档落差实测）。这套值来自上游工作流编辑器的设计系统，`index.css:129-135` 注释原文写明「逐字落地」（**更具体的上游出处未证实，见 §9 第 9 项**） |
| **换值 = 全站视觉走样** | 143 个颜色 token 全部在 `.dark` 逐条覆盖（[`design-system-tokens.md`](./design-system-tokens.md) §7 的 82/104 账）。换一套值意味着**每一条覆盖都要重新校验**——这是 82 次判定，不是 1 次 |
| **收益不抵成本** | 我们已有的冷灰在 hue 216–220° 上自洽（§4.1），Radix 的灰在 hue 0 上自洽；两者**没有优劣，只有归属**。换成 Radix 的灰不会让界面更好看，只会让 82 条已有覆盖全部作废 |
| **与既有结论同向** | [`design-token-mapping.md`](./design-token-mapping.md) §7.5 已明确「新的颜色体系：不因这份映射新增任何视觉命名色」。本文延续它，**只补角色，不补色值** |

### 1.4 落选方案与理由

| 落选方案 | 为什么不选 |
| --- | --- |
| **Primer Primitives** | 它的颜色模型是「15+ 个自有色相 × 10 档 **+** 一层 GitHub 专属的功能别名」（`canvas.default` / `fgColor.muted`）。别名描述的是"GitHub 界面的哪一块"，不是"页面底 / 组件悬停 / 悬停边框"这类**可迁移的角色**。借它等于借 GitHub 的信息架构，而我们只要一根档位轴。（它的**控件高度与 z 层**我们已经借了，见 [`design-token-mapping.md`](./design-token-mapping.md) §4、§7.3——那里借的是刻度，不是色相） |
| **IBM Carbon** | Carbon 的颜色靠 **theme zone + layer/field 台阶**分层（`layer-01/02/03`、`field-01/02/03`，[`design-token-mapping.md`](./design-token-mapping.md) §5.1），它**没有"每个色相 12 档角色"这一层**。采用它意味着同时接受 Gray-10/Gray-90/Gray-100 四套主题分区，而我们是**单一明暗两套**。我们与 Carbon 一致的是"用明度台阶分层"这个**结论**，不是它的颜色骨架 |
| **Material 3 动态取色** | 它的角色集（`primary` / `on-primary` / `primary-container`…）是**以强调色为中心的成对模型**，不是中性色 12 档阶梯；且"动态"意味着**色值由运行时从壁纸里算出来**。这与第 3 号铁律直接冲突——品牌层色值**只允许静态声明在 `@theme` 与 `.dark`**（[`design-system.md`](./design-system.md) §全局铁律）。采用它还要引入 HCT 色彩科学的运行时依赖 |
| **Tailwind 出厂色板** | 它是一套**色相 × 深浅的 ramps**（`red-50..950`），本身就是**视觉命名**，用它的唯一写法是 `bg-gray-100`——直接违反第 1 号铁律。实测它正是当前 34 处违规的来源（[`design-system-tokens.md`](./design-system-tokens.md) §3.4）。**这是我们正在清除的选项，不是候选** |

---

## 2. 12 步 → osw 落位表

### 2.1 落位表（亮色值）

| 步 | 角色 | 我们的值（亮色） | 承载它的 token | 行 |
| --- | --- | --- | --- | --- |
| 1 | 应用底 | `#f2f4f7` | `--color-background-body` | `index.css:166` |
| 2 | 细微底 | `#fcfcfd` | `--color-background-default-subtle` | `:169` |
| 3 | 组件底 | `#ffffff` | `--color-background-default` | `:167` |
| 4 | 组件悬停 | `#f9fafb` | `--color-background-default-hover` | `:168` |
| 5 | 激活 / 选中 | `#ebedf0` | `--color-heat-0`（见 §2.2 注 ①） | `:282` |
| 6 | 细边框 · 分隔 | `#e9ebf0` | `--color-background-default-dimmed`、`--color-components-option-card-option-border` | `:170`、`:217` |
| 7 | 边框 · 焦点环 | `#d0d5dc` | `--color-text-disabled`、`--color-workflow-link-line-normal`、`--color-components-input-border-hover` | `:162`、`:199`、`:245` |
| 8 | 悬停边框 | **缺**（见 §2.2） | — | — |
| 9 | 实心填充 | `hsl(var(--primary))` = `#171717`（亮）/ `#fafafa`（暗） | `--color-components-button-primary-bg` | `:247`，`--primary` 在 `:551` / `:606` |
| 10 | 悬停实心 | `hsl(var(--primary) / 0.9)` | `--color-components-button-primary-bg-hover` | `:248` |
| 11 | 低对比文本 | `#676f83` | `--color-text-tertiary` | `:146` |
| 12 | 高对比文本 | `#101828` | `--color-text-primary` | `:144` |

### 2.2 缺口的准确形状

**第 8 步是真缺口，而且它的形状比"少一档"更具体。**

| 缺口 | 事实 | 证据 |
| --- | --- | --- |
| **8 需要比 7 更深的一档，现在没有** | 我们**只有一档边框值** `#d0d5dc`。仓库里唯一比它更深的边框档是 `rgb(16 24 40 / 0.2)`，在白底上合成为 **`#cfd1d4`**——比 `#d0d5dc` 只深 1–8 个通道，**几乎同色**。这一档目前只服务一个点（`components-button-secondary-border-hover`），所以按 §6 的门槛它还不够格升格成 token | `:245`、`:246`、`:219`、`:199` 四处的值都是 `#d0d5dc`；`:256` 是 `.2`。合成算法见 §8 |
| **焦点环的角色填错了档** | 第 7 步的角色列写着"焦点环"，但我们的焦点环**不在第 7 步**：`--ring: 0 0% 9%`（`:563`，换算 `#171717`）——那是**第 9 步**（实心填充）的值。它正是 [`design-system-accessibility.md`](./design-system-accessibility.md) §3.2 实测「颜色五种」的成因之一 | `:563`、`:618`；`ring-state-accent-solid` = `hsl(var(--primary))` = `:179` |
| **第 5 步没有自己的值** | 承载 `#ebedf0` 的**唯一 token 是 `heat-0`**（热力图"没有请求"档，`:282`）。真正的交互档在 `state-base-*` 一族：`--color-state-base-active` = `rgb(200 206 218 / 0.4)`（`:176`），它在白底上合成为 **`#e9ebf0`**——与**第 6 步同值** | `:175`、`:176`、`:238` 三处同为 `rgb(200 206 218 / 0.4)` |
| **第 11 / 12 步不是"少一档"，而是"多两档"** | 骨架给文本 2 个角色，我们有 **4 档**：`text-primary` `#101828`（`:144`）→ `text-secondary` `#354052`（`:145`）→ `text-tertiary` `#676f83`（`:146`）→ `text-quaternary` `rgb(16 24 40 / 0.5)`（`:150`，白底合成 `#888c94`）。**文本端比骨架细，边框端比骨架粗** | `:144`–`:150` |

> **一句话读法**：我们的体系**在文本端过剩（4 档 vs 骨架 2 档）、在边框端不足（1 档 vs 骨架 3 档）**。
> 所谓"补第 8 步"就是把这根轴补齐，而不是把整根轴换成 Radix 的。

### 2.3 这张表的三条读数规则

| # | 规则 |
| --- | --- |
| 1 | **表里的值是亮色值。** 暗色下**每一档的归属会变**——`@theme` 的 6 个底色 token 在亮色下同值、在暗色下分叉（§5.3）。判一个 token 站在第几步，**必须两套都看** |
| 2 | **一个 token 可以横跨多档，这不代表它错了。** `#d0d5dc` 同时是边框、连线、"禁用文本"（§3.1 第 7 行）——它的问题不是复用，是**复用之后没有第 8 步可退** |
| 3 | **第 9 / 10 步在本体系里是无色相的。** `--primary` = `0 0% 9%`（亮）/ `0 0% 98%`（暗）——即**近黑 / 近白**，不含任何品牌色相。所以我们的"实心填充"是中性实心，而 Radix 的第 9 步是**该色相的品牌面**。这是本体系与骨架**最大的一处语义差异**，不是缺陷（我们已有 9 个分类色相承担有色需求，见 §3.4） |

> **第 10 步的保真度注记**：Radix 的第 10 步是**不透明**色；我们写的是 `hsl(var(--primary) / 0.9)`
> （`:248`）——**同一色的 90% alpha**，因此**它的实际观感取决于背后的底色**，无法列成一个十六进制值。
> 在亮色下它叠白后比第 9 步浅、在暗色下叠深底后比第 9 步深，方向随主题自动正确，但它
> **不是一个可枚举的档**。第 9 步同理：`:250` 的 `--color-components-button-primary-border` 是
> `hsl(var(--primary-foreground) / 0.12)`，也是 alpha。

---

## 3. 完整色值清单

> 以下全部为 `[源码]`，逐条抄自 `packages/console/source/styles/index.css`。
> 行号为**亮色**定义处；暗色覆盖另标。**不重测、不换算成别的记法。**

### 3.1 中性 11 档（按明度）

| # | 值 | 现用 token | 亮色行 | 暗色值 | 暗色行 |
| --- | --- | --- | --- | --- | --- |
| 1 | `#ffffff` | `--color-background-default` | `:167` | `#222225` | `:306` |
| 2 | `#fcfcfd` | `--color-background-default-subtle` | `:169` | `#222225` | `:308` |
| 3 | `#f9fafb` | `--color-background-default-hover` | `:168` | `#27272b` | `:307` |
| 4 | `#f2f4f7` | `--color-background-body` | `:166` | `#1d1d20` | `:305` |
| 5 | `#ebedf0` | `--color-heat-0`（见 §2.2 注 ①） | `:282` | `#2c2c32` | `:381` |
| 6 | `#e9ebf0` | `--color-background-default-dimmed` | `:170` | `#27272b` | `:309` |
| 7 | `#d0d5dc` | `--color-text-disabled`、`--color-components-input-border-hover` | `:162`、`:245` | `rgb(200 206 218 / 0.3)` | `:302` |
| 8 | `#98a2b2` | `--color-components-input-text-placeholder` | `:244` | `rgb(200 206 218 / 0.3)` | `:362` |
| 9 | `#676f83` | `--color-text-tertiary` | `:146` | `rgb(200 206 218 / 0.6)` | `:294` |
| 10 | `#354052` | `--color-text-secondary` | `:145` | `#d9d9de` | `:293` |
| 11 | `#101828` | `--color-text-primary` | `:144` | `#fbfbfc` | `:292` |

**注 ①「凹槽」不是一个值，是三个近似值**——见 §5.4。第 5 行写 `heat-0` 是因为
`#ebedf0` 在仓库里**只被 `heat-0` 一个 token 取到**。

**注 ② 这 11 档的「档距」极不均匀**（逐对算最大通道差，命令见 §8）：

| 相邻对 | 最大通道差（/255） |
| --- | --- |
| 1→2 `#ffffff`→`#fcfcfd` | **3** |
| 2→3 `#fcfcfd`→`#f9fafb` | **3** |
| 3→4 `#f9fafb`→`#f2f4f7` | 7 |
| 4→5 `#f2f4f7`→`#ebedf0` | 7 |
| 5→6 `#ebedf0`→`#e9ebf0` | **2** |
| **6→7** `#e9ebf0`→`#d0d5dc` | **25** ← 一道台阶 |
| 7→8 `#d0d5dc`→`#98a2b2` | 56 |
| 8→9 `#98a2b2`→`#676f83` | 51 |
| 9→10 `#676f83`→`#354052` | 50 |
| 10→11 `#354052`→`#101828` | 42 |

**三个区间，不是一条平滑的梯子**：

| 区间 | 覆盖 | 档距 | 承载的骨架角色（§2.1） |
| --- | --- | --- | --- |
| **平顶**（第 1–6 行） | 面与边框 | **2–7** | **第 1–6 步：6 个角色** |
| **台阶**（第 6→7 行） | — | **25** | 第 7 步，以及**第 8 步该在的位置** |
| **陡坡**（第 7–11 行） | 其中 4 个是文本（第 8–11 行） | **42–56** | **第 11–12 步：只有 2 个角色** |

> **这就是 §2.2 那句"文本端过剩、边框端不足"的算术证据**：
> **骨架要在面上分 6 档（第 1–6 步），我们只给了 2–7 的档距；
> 骨架只要在文本上分 2 档（第 11–12 步），我们放了 4 个值、档距 42–56。**
>
> 两处代价都是可指认的：**面上太挤** → 第 8 步无处安放（§2.2）；
> **文本上太空** → 第 1/2/3 行之间（差 3 与 3）与第 5/6 行之间（差 2）在数值上几乎是同一档。
> `[未核实]`：这三对在实际显示上是否可分辨，取决于屏幕与色块面积，仓库里没有实测记录（§9 第 8 项）。

**两条读表须知**：

- 第 1–6 行的 6 个 token **在亮色下互不同值，但在暗色下第 1/2 行同值、第 3/6 行同值**
  （`#222225` 出现两次、`#27272b` 出现两次）。
- 第 6 个 token（`--color-background-default-dodge`，`:171`）**不在本表**：它的亮色值与
  第 1 行**完全相同**（都是 `#ffffff`），暗色才分叉成 `#3a3a40`（`:310`）。即
  **它是"只在暗色下存在"的一档**。

### 3.2 透明档 8 个

口径：**本表列出"边框与交互面"这一类 alpha token**——不含文本类 alpha
（如 `--color-text-quaternary` 的 `rgb(16 24 40 / 0.5)`，那是文本梯队，见 §3.1 注 ② 与 §2.2）。

| 值（亮色） | token | 行 | 暗色值 | 暗色行 |
| --- | --- | --- | --- | --- |
| `rgb(16 24 40 / 0.04)` | `--color-components-actionbar-border` | `:223` | `rgb(200 206 218 / 0.08)` | `:348` |
| `rgb(16 24 40 / 0.08)` | `--color-components-panel-border` | `:226` | `rgb(200 206 218 / 0.14)` | `:351` |
| `rgb(16 24 40 / 0.12)` | `--color-module-border` | `:231` | `rgb(200 206 218 / 0.16)` | `:353` |
| `rgb(16 24 40 / 0.14)` | `--color-components-button-secondary-border` | `:255` | `rgb(255 255 255 / 0.08)` | `:369` |
| `rgb(16 24 40 / 0.2)` | `--color-components-button-secondary-border-hover` | `:256` | `rgb(255 255 255 / 0.12)` | `:370` |
| `rgb(16 24 40 / 0.3)` | `--color-state-base-handle-hover` | `:178` | `rgb(200 206 218 / 0.5)` | `:316` |
| `rgb(200 206 218 / 0.2)` | `--color-state-base-hover` | `:174` | `rgb(200 206 218 / 0.08)` | `:312` |
| `rgb(200 206 218 / 0.4)` | `--color-components-input-bg-normal` | `:238` | `rgb(255 255 255 / 0.12)` | `:356` |

**同一值的其它成员**（不在上面 8 行内，但同值，归位时会被一起看到）：
`rgb(200 206 218 / 0.4)` 另有 `--color-state-base-hover-alt`（`:175`）与
`--color-state-base-active`（`:176`）；`rgb(16 24 40 / 0.2)` 另有
`--color-state-base-handle`（`:177`）。

**这 8 个 token 有 3 种「墨水」，且明暗之间会换墨水**（`[源码]`，逐条比对得出）：

| 亮色墨水 | 暗色墨水 | 涉及 |
| --- | --- | --- |
| `rgb(16 24 40 / …)` 近黑冷灰，**压暗** | `rgb(200 206 218 / …)` 浅冷灰，**提亮** | actionbar-border、panel-border、module-border、state-base-handle-hover |
| `rgb(16 24 40 / …)` 近黑冷灰，**压暗** | `rgb(255 255 255 / …)` **纯白**，**提亮** | button-secondary-border、button-secondary-border-hover |
| `rgb(200 206 218 / …)` 浅冷灰，**提亮** | `rgb(200 206 218 / …)` 或 `rgb(255 255 255 / …)` | state-base-hover、input-bg-normal |

**这是 §4.1「两套灰在打架」在机制层面的第二个来源**：亮色下同时存在"用近黑压暗"
和"用浅灰提亮"两种做法，暗色下又各换成第三种墨水。合成后的等效值见 §8 的复现命令。

### 3.3 语义族：error / warning / success

| 族 | 档 | 值（亮色） | token | 亮色行 | 值（暗色） | 暗色行 |
| --- | --- | --- | --- | --- | --- | --- |
| **error** | 面色（浅） | `#fef3f2` | `--color-state-destructive-hover` | `:185` | `rgb(240 68 56 / 0.14)` | `:320` |
| | 面色（深） | `#fee4e2` | `--color-components-button-destructive-ghost-bg-hover` | `:263` | `rgb(240 68 56 / 0.14)` | `:377` |
| | 实心 | `#f04438` | `--color-state-destructive-solid` | `:184` | `#f97066` | `:319` |
| | 文本 | `#d92d20` | `--color-text-destructive` | `:157` | `#f97066` | `:297` |
| **warning** | 面色 | `#fffaeb` | `--color-state-warning-hover` | `:186` | `rgb(247 144 9 / 0.14)` | `:321` |
| | 实心 | `#f79009` | `--color-state-warning-solid`（`:183`）、`--color-text-warning-secondary`（`:161`） | `:183`、`:161` | **两个 token 在暗色下分开了**：实心 `#f79009`（`:318`）、文本次级 `#fdb022`（`:301`） | `:318`、`:301` |
| | 文本 | `#dc6803` | `--color-text-warning` | `:160` | `#f79009` | `:300` |
| **success** | 实心 | `#17b26a` | `--color-state-success-solid`、`--color-text-success-secondary` | `:182`、`:159` | `#47cd89` | `:317`、`:299` |
| | 文本 | `#079455` | `--color-text-success` | `:158` | `#17b26a` | `:298` |

**档数不齐，且 success 缺一档**——error 4 档 / warning 3 档 / success **2 档**：
**success 没有任何"浅色面"**（error 的对应档是 `#fef3f2`、warning 是 `#fffaeb`，
**success 没有取值**）。详见 §5.5。

### 3.4 分类与强调：9 族，每族只有 500 一档

`index.css:266-274`，注释（`:265`）原文：**"util-colors：节点图标色块专用，明暗共用同一组值"**。

| token | 值 | 行 |
| --- | --- | --- |
| `--color-util-colors-blue-brand-blue-brand-500` | `#085afc` | `:266` |
| `--color-util-colors-indigo-indigo-500` | `#6172f3` | `:267` |
| `--color-util-colors-blue-blue-500` | `#2e90fa` | `:268` |
| `--color-util-colors-cyan-cyan-500` | `#06aed4` | `:269` |
| `--color-util-colors-green-green-500` | `#17b26a` | `:270` |
| `--color-util-colors-warning-warning-500` | `#f79009` | `:271` |
| `--color-util-colors-violet-violet-500` | `#875bf7` | `:272` |
| `--color-util-colors-yellow-yellow-500` | `#eaaa08` | `:273` |
| `--color-util-colors-pink-pink-500` | `#ee46bc` | `:274` |

**三个结构事实**：

1. **每族只有一档**（`-500`）。骨架里的 3–8 步（组件底、悬停、边框）**一档都没有**。
   → 任何一个分类色**无法用作可交互控件**，只能用作色块/圆点/图标底。
2. **`#17b26a` 同时是 6 个 token 的值**：`util-colors-green-green-500`、`text-success-secondary`、
   `state-success-solid`、`heat-4`、`workflow-link-line-success-active`、
   `workflow-link-line-success-handle`（`:270`、`:159`、`:182`、`:286`、`:206`、`:207`）
   ——**一个值服务 6 个语义**。
3. **明暗共用**是 `index.css:265` 注释的明确声明，因此它们在 [`design-system-theming.md`](./design-system-theming.md)
   §1.3 的 22 个「未覆盖」清单里是**合法**的那一组。

> **使用实况**：9 个 token 里 **6 个各被用 1 次**（`blue` / `cyan` / `green` / `warning` /
> `violet` / `pink`），`blue-brand` / `indigo` / `yellow` 三个
> **零使用**。而**有 16 处需要分类色的地方绕开了它们**，改用 Tailwind 调色板类名
> → 见本文 §5.6；那 34 处视觉命名类名的归位见
> [`design-system-tokens.md`](./design-system-tokens.md) §3.4。

### 3.5 热力 0–4

| 档 | 值（亮色） | 亮色行 | 值（暗色） | 暗色行 |
| --- | --- | --- | --- | --- |
| 0（没有请求） | `#ebedf0` | `:282` | `#2c2c32` | `:381` |
| 1 | `#d6f2e6` | `:283` | `#0e4630` | `:382` |
| 2 | `#96dfbe` | `:284` | `#0e7048` | `:383` |
| 3 | `#4cc78d` | `:285` | `#1a9e68` | `:384` |
| 4 | `#17b26a` | `:286` | `#3ed392` | `:385` |

**这条色阶的方向在暗色下反转**（`index.css:279-280` 注释原文：「亮色从近白绿走到品牌绿，
暗色反过来从深绿走到亮绿，两套都是『越深/越亮 = 越多』」）。

> **因此热力色阶不能套用 §2 的 12 步骨架**：骨架假设"序号越大越深/越强调"是**单调**的，
> 而热力在暗色侧是"序号越大越亮"。它是**顺序色阶（sequential scale）**，与中性阶梯是
> 两个不同的数学对象。本文只登记它的值，不把它放进骨架。

### 3.6 实心填充与 `--primary` 派生组

`--primary`（B 层）＝ `0 0% 9%`（`:551`，换算 `#171717`／亮）· `0 0% 98%`（`:606`，换算 `#fafafa`／暗）。

`index.css:151-154` 的注释写明了这条设计决策：**「主题色一族全部改回应用自身的 `--primary`…
本应用是中性色主题（亮色近黑 / 暗色近白）」**。因此下面 13 个 token
**全部不含自己的色值**，只引用 `--primary` / `--primary-foreground`，明暗自动跟随：

| token | 值 | 行 |
| --- | --- | --- |
| `--color-text-accent` | `hsl(var(--primary))` | `:155` |
| `--color-text-accent-secondary` | `hsl(var(--primary) / 0.8)` | `:156` |
| `--color-state-accent-solid` | `hsl(var(--primary))` | `:179` |
| `--color-state-accent-hover` | `hsl(var(--primary) / 0.08)` | `:180` |
| `--color-state-accent-active` | `hsl(var(--primary) / 0.08)` | `:181` |
| `--color-components-button-primary-bg` | `hsl(var(--primary))` | `:247` |
| `--color-components-button-primary-bg-hover` | `hsl(var(--primary) / 0.9)` | `:248` |
| `--color-components-button-primary-text` | `hsl(var(--primary-foreground))` | `:249` |
| `--color-components-button-primary-border` | `hsl(var(--primary-foreground) / 0.12)` | `:250` |
| `--color-components-button-secondary-accent-text` | `hsl(var(--primary))` | `:254` |
| `--color-components-option-card-option-selected-border` | `hsl(var(--primary))` | `:221` |
| `--color-workflow-link-line-active` | `hsl(var(--primary))` | `:201` |
| `--color-workflow-link-line-handle` | `hsl(var(--primary))` | `:202` |

这一组正是 [`design-system-theming.md`](./design-system-theming.md) §1.3 的「`--primary` 派生」
13 个（该处的成员名以 `workflow-block-border-highlight` 计入，`:192`，同为
`hsl(var(--primary) / 0.14)`）。**它们不需要 `.dark` 覆盖，且这是结构性保证而非疏漏。**

---

## 4. 三个实测硬伤

三条都是 `[源码]` 实测 + 可复现命令，不是观感描述。

### 4.1 两套灰在打架

**同一个界面里跑着两套互不相干的中性色**，它们的差别不是深浅，是**色相**：

| 套 | 载体 | 中性色的 HSL 特征 | 证据 |
| --- | --- | --- | --- |
| **纯灰** | shadcn 层（A + B 层，[`design-system-tokens.md`](./design-system-tokens.md) §1） | **hue 0 / 饱和度 0%** | `--background: 0 0% 98%`（`:545`，换算 `#fafafa`）；暗色 `0 0% 7%`（`:600`，换算 `#121212`）；`--border: 0 0% 90%`（`:561`，换算 `#e5e5e5`）；`--inset: 0 0% 92%`（`:585`，换算 `#ebebeb`） |
| **冷灰** | `@theme` 层（C 层） | **hue 210–240°，饱和度 12–24%**（`#101828` 是 hue 220° / 饱和度 43%） | `#f2f4f7` = `hsl(216 24% 95.9%)`（`:166`）；`#101828` = `hsl(220 43% 11%)`（`:144`）；`#354052` = `hsl(217 21% 26.5%)`（`:145`）；`#676f83` = `hsl(223 12% 45.9%)`（`:146`）；`#e9ebf0` = `hsl(223 19% 92.7%)`（`:170`）；`#d0d5dc` = `hsl(215 15% 83.9%)`（`:162`） |

**实测的用法分布：两套不是"谁对谁错"，而是按「角色」各占一块**（逐条计数，命令见 §8）：

| 角色 | 纯灰（A + B 层） | 冷灰（C 层） | 谁占多数 |
| --- | --- | --- | --- |
| **文字** | **81**（`text-primary` 29 / `text-secondary` 1 / `text-destructive` 12 / `text-muted-foreground` 39） | **488**（`text-text-primary` 155 / `text-text-secondary` 92 / `text-text-tertiary` 241） | **冷灰 86%** |
| **边框** | **50**（`border-border`） | **101**（`border-module-border` 81 / `border-components-panel-border` 20） | **冷灰 67%** |
| **底 / 面** | **155**（`bg-background` 27 / `bg-card` 29 / `bg-sidebar` 29 / `bg-inset` 58 / `bg-popover` 12） | **50**（`bg-workflow-block-parma-bg` 34 / `bg-components-panel-bg` 16） | **纯灰 76%** |

**三条后果**：

| # | 后果 | 证据 |
| --- | --- | --- |
| 1 | **同一个组件上会同时出现两套**：一张卡片 = `bg-card`（纯灰 `#ffffff`）+ `border-module-border`（冷灰）+ `text-text-primary`（冷灰）。**分界不在组件边界上，在属性上** | 上表三行 |
| 2 | **页面底色是纯灰，不是我们声明的那一档**：实际的应用底是 `bg-background`（`#fafafa`，27 次），而第 1 步的声明值 `--color-background-body`（`#f2f4f7` 冷灰）**零使用**（§5.2） | 同上 |
| 3 | **"凹槽"有两个值**：`bg-inset`（**纯灰** `#ebebeb`，**58 次**，仓库里**用量最高**的底色类）与冷灰的 `#e9ebf0` / `#ebedf0`（§5.4） | `:585`、`:170`、`:282` |

**类名层**：同一语义有两个类名、两个颜色，**且都在用**——`text-primary`（A 层纯灰 `#171717`，**29 次**）
与 `text-text-primary`（C 层冷灰 `#101828`，**155 次**）。

> ⚠️ **注意 C 层是多数。** 这不是"少数地方写错了"——是**两套体系各自完整、各自被大量使用，
> 且各在不同角色上占多数**。目前没有任何 lint 能发现它：两个名字都是合法 token 类名，
> 都不违反铁律 1（都是语义命名）。
>
> 要收敛必须做一次**有意的归属决定**（哪一套是"页面骨架"、哪一套是"组件内部"）——
> 本文只登记事实与代价，**不在文档里替这个决定投票**。归属决定的落点见 §6 与 §7.1。

### 4.2 两个红——实测是**三个**红，且暗色下有两个重合

| # | 来源 | 亮色值 | 行 | 暗色值 | 暗色行 | 类名 | 用量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A/B 层 shadcn | `--destructive: 6 65% 48%` = `#ca3b2b`（换算） | `:559` | `6 65% 42%` = `#b13325`（换算） | `:614` | `bg-destructive`、`text-destructive` | **31** / **12** |
| 2 | C 层 | `--color-text-destructive: #d92d20` | `:157` | `#f97066` | `:297` | `text-text-destructive` | **49** |
| 3 | C 层 | `--color-state-destructive-solid: #f04438` | `:184` | `#f97066` | `:319` | `bg-state-destructive-solid` 等 | — |

**三个事实**：

1. **1 与 2 不是同一个红**：`#ca3b2b`（hue 6 / 65%）对 `#d92d20`（hue 3.5 / 76%）——
   色相与饱和度都不同，**并排放能看出差异**。
2. **类名层又是一对同名不同色**：`text-destructive`（`#ca3b2b`，**12 次**）与
   `text-text-destructive`（`#d92d20`，**49 次**）——成因同 §4.1，是同一个 shadcn/C 层分裂。
3. **暗色下 2 与 3 合流**：`--color-text-destructive` 与 `--color-state-destructive-solid`
   在暗色里**都是 `#f97066`**（`:297`、`:319`）——即"文本红"与"实心红"在暗色下
   **失去区分**，而在亮色下它们是两个值。**这意味着任何依赖"文本红 ≠ 实心红"的设计，
   在暗色下会静默失效。**

> ⚠️ **附带发现**：[`design-system-ai-constraints.md`](./design-system-ai-constraints.md) §3.3
> 推荐的正确写法是 `bg-destructive/10 text-text-destructive`——
> **它同时取用了第 1 个红（底）与第 2 个红（字）**。这条推荐本身没有错（两边都是语义 token，
> 都过铁律），但它把"三个红"的分裂**写进了官方范例里**。修复顺序应当是**先统一红，再改范例**。

### 4.3 图表色从未被纳入本体系

`--chart-1..5` 的**机制是通的**（A 层 `:94-98` 引用 B 层，两套 key 齐全，明暗会切），
**但两套值都是 shadcn 出厂默认，且互不同源**：

| token | 亮色（`:564-568`） | 换算 | 暗色（`:619-623`） | 换算 |
| --- | --- | --- | --- | --- |
| `--chart-1` | `12 76% 61%` | `#e76e50` | `220 70% 50%` | `#2662d9` |
| `--chart-2` | `173 58% 39%` | `#2a9d90` | `160 60% 45%` | `#2eb88a` |
| `--chart-3` | `197 37% 24%` | `#274754` | `30 80% 55%` | `#e88c30` |
| `--chart-4` | `43 74% 66%` | `#e8c468` | `280 65% 60%` | `#af57db` |
| `--chart-5` | `27 87% 67%` | `#f4a462` | `340 75% 55%` | `#e23670` |

**三条实测结论**：

| # | 结论 | 证据 |
| --- | --- | --- |
| 1 | **亮暗两套之间没有任何色相对应关系**：亮色是"暖橙 / 青绿 / 深蓝 / 土黄 / 橙"，暗色是"蓝 / 绿 / 橙 / 紫 / 粉"。同一条系列在切主题时会**换掉色相**——图例的辨识记忆失效 | 上表逐列对比 |
| 2 | **与本体系完全不搭**：这 10 个值里**没有一个是 §3 清单里的值**，也没有一个落在 §3.4 的 9 个分类色上 | 与 §3 逐值比对 |
| 3 | **它们零使用**。唯一的趋势图 `pages/overview/components/trend-chart.tsx:15-18` 走的是**字面色值** `#0891b2` `#64748b` `#14b8a6` `#f59e0b`，同文件 `:14` 又写 `hsl(var(--success))`——**同一次映射里两种写法混用** | `rg 'chart-[1-5]'` 无命中；[`design-system-tokens.md`](./design-system-tokens.md) §3.2 第 14 组 |

> **准确表述**：不是"图表色没被主题化"，而是**"图表色被主题化到了一套不属于我们的颜色上，
> 而真正画图的地方又绕开了它们。"** 两件事叠在一起，才使得这 5 个 token 既存在又不可信。
>
> ⚠️ **跨文档张力（登记，不在本文修）**：[`design-system.md`](./design-system.md) §与成熟系统对照速查
> 把 `chart-1..5` 记为「对应 Carbon 的 categorical palette」。上表实测表明它们是
> shadcn 出厂默认，**与 Carbon 无对应关系**。本文不改那张表，只登记此处不一致（见 §9 第 2 项）。

---

## 5. 新登记：本次实测另外发现的六处色值问题

以下六条**不在** §4 的三条硬伤内，是本文新增登记的。按"能判定、可复现"排列。

### 5.1 同名不同色的类名对（4 对，全部在用）

**成因**：A 层（shadcn）与 C 层（`@theme`）各有一套"语义色"命名，**两套名字撞车但值不同**。
写的人以为在写同一个语义，实际取到的是另一层的色值。

| A 层类名（值） | C 层类名（值） | 用量（A / C） | 后果 |
| --- | --- | --- | --- |
| `text-primary` `#171717` 纯灰 | `text-text-primary` `#101828` 冷灰 | **29 / 155** | 两个"主文本色" |
| `text-secondary` `#262626` 纯灰 | `text-text-secondary` `#354052` 冷灰 | **1 / 92** | 两个"次文本色" |
| `text-destructive` `#ca3b2b` | `text-text-destructive` `#d92d20` | **12 / 49** | 两个"危险红"（§4.2） |
| `text-muted-foreground` `#666666` 纯灰 | `text-text-tertiary` `#676f83` 冷灰 | **39 / 241** | 两个"弱文本色"，见下注 ② |

> **注 ① 撞名的根源是两层对"面"与"字"的命名方式相反**：
> A 层用 `x` 表示**面**、`x-foreground` 表示**面上的字**（于是 `text-secondary` 取的是
> `--secondary-foreground: 0 0% 15%`，`:554`，换算 `#262626`——**不是** `--secondary` 的
> `0 0% 96%`）；C 层用 `background-x` 表示面、`text-x` 表示字。
> **于是 `text-x` 在两层里指两个不同的东西。**
>
> **注 ② `text-muted-foreground` 与 `text-text-tertiary` 是最隐蔽的一对**：
> `#666666` 对 `#676f83`——**明度几乎相同**（相差 1/255），只有色相差
> （hue 0 vs hue 223）。**肉眼扫过去是"同一个灰"，实际来自两个体系。**
> 排查时这一对最难被发现，也最难解释"为什么两处灰不一样"。

**判定规则（新增）**：

| # | 规则 |
| --- | --- |
| 1 | 写文本色时，**优先 C 层**（`text-text-*`），因为 §3.1 的 11 档梯队全在 C 层 |
| 2 | 写文本色时**不允许**用 `text-{primary,secondary,muted-foreground,destructive}`（A 层），除非确实要 A 层的值——此时**必须写注释说明** |
| 3 | 这条收敛是一次独立迁移：共 **81 处**（29 + 1 + 12 + 39），**与 [`design-system-theming.md`](./design-system-theming.md) §1.4 的 56 处 `dark:` 同量级**。**不应夹在别的工作里做** |
| 4 | **它是最该优先定的一件事**：成因（两套语义色并存）与 [`design-system-theming.md`](./design-system-theming.md) §1.4 的 56 处 `dark:` **同源**——都是"同一语义有两条表达路径"。先定归属，这 81 处与那 56 处会一起有解（本文 §7.2）。该文 §1.4 记录的是 56 处的分布 |

### 5.2 中性 6 个底色 token 零使用

| token | 亮色值 | 行 | 用量 |
| --- | --- | --- | --- |
| `--color-background-body` | `#f2f4f7` | `:166` | **0** |
| `--color-background-default` | `#ffffff` | `:167` | **0** |
| `--color-background-default-hover` | `#f9fafb` | `:168` | **0** |
| `--color-background-default-subtle` | `#fcfcfd` | `:169` | **0** |
| `--color-background-default-dimmed` | `#e9ebf0` | `:170` | **0** |
| `--color-background-default-dodge` | `#ffffff` | `:171` | **0** |

**6 个 token × 2 套明暗 = 12 条定义，全部零使用**（§8 命令可复现；对比
`bg-background` 27 次、`bg-card` 29 次、`bg-inset` 58 次）。

**含义**：§2 落位表的**第 1–5 步目前没有实际承载者**——表里那 5 行是
"**声明了、但没有任何界面在用的值**"。这不否定落位表（它描述的是角色归属，不是用量），
但它把 §4.1 的账算实了：**我们真正在用的页面底色是 A 层的纯灰，不是 C 层的冷灰。**

> **这一条修正了 [`design-system-tokens.md`](./design-system-tokens.md) §2.2 的一个读法**：
> 该表把「底色」一族的"谁可以用"写成「所有组件」。**"可以用"成立，但"在用"是 0**。
> 两处不矛盾，只是前者容易被读成后者。

### 5.3 亮色下大量 token 同值、暗色下分叉（20 组）

**这是"12 步骨架必须两套都看"（§2.3 规则 1）的实证。** 亮色下 C 层有 **20 组**
"不同 token、同一个值"，其中 **14 组在暗色下会分开**（另 6 组两套同值）。
下表只列**承载角色最多或性质特殊**的 **9 组**；另 11 组的完整输出见 §8 命令：

| 亮色同值 | 成员数 | 亮色 | 暗色下是否分叉 |
| --- | --- | --- | --- |
| `#ffffff` | **8** | `background-default`、`background-default-dodge`、`workflow-block-border`、`workflow-block-bg-hover`、`option-card-option-bg-hover`、`option-card-option-selected-bg`、`panel-bg`、`button-secondary-bg` | **分叉**（`#222225` / `#3a3a40` / `rgb(255 255 255 / .08)` / `#303035` / `rgb(200 206 218 / .14)` / `rgb(255 255 255 / .05)` / `#222225` / `rgb(255 255 255 / .12)`） |
| `rgb(200 206 218 / 0.4)` | 3 | `state-base-hover-alt`、`state-base-active`、`input-bg-normal` | **分叉**（`.14` / `.2` / `rgb(255 255 255 / .12)`） |
| `rgb(255 255 255 / 0.95)` | 3 | `actionbar-bg`、`panel-bg-blur`、`tooltip-bg` | **分叉**（`#222225` / `rgb(44 44 48 / .95)` / `rgb(24 24 27 / .95)`） |
| `#f2f4f7` | 4 | `background-body`、`workflow-block-parma-bg`、`workflow-canvas-workflow-bg`、`button-tertiary-bg` | **分叉**（`#1d1d20` / `rgb(255 255 255 / .05)` / `#1d1d20` / `rgb(255 255 255 / .08)`） |
| `#fcfcfd` | 3 | `background-default-subtle`、`workflow-block-bg`、`option-card-option-bg` | **分叉**（`#222225` / `#27272b` / `rgb(200 206 218 / .04)`） |
| `#f9fafb` | 3 | `background-default-hover`、`input-bg-active`、`button-secondary-bg-hover` | **分叉**（`#27272b` / `rgb(255 255 255 / .16)` / `rgb(255 255 255 / .2)`） |
| `#e9ebf0` | 3 | `background-default-dimmed`、`option-card-option-border`、`button-tertiary-bg-hover` | **分叉**（`#27272b` / `rgb(200 206 218 / .2)` / `rgb(255 255 255 / .12)`） |
| `hsl(var(--primary) / 0.08)` | 2 | `state-accent-hover`、`state-accent-active` | **不分叉**（两者在暗色下同值） |
| `hsl(var(--primary))` | 7 | `text-accent`、`state-accent-solid`、`workflow-link-line-active/-handle`、`option-card-option-selected-border`、`button-primary-bg`、`button-secondary-accent-text` | **不分叉**（全部跟随 `--primary`，这是 §3.6 的有意设计） |

**读法**：

| # | 规则 |
| --- | --- |
| 1 | **`#ffffff` 一档 8 个 token**——第 3 步（组件底）是**过载最严重的一档**。这 8 个值在暗色下分成 **7 种**不同结果（只有 `background-default` 与 `panel-bg` 仍同值），说明亮色下"它们是一回事"只是**没有暴露出来** |
| 2 | **`hover-alt` 与 `active` 在亮色下不可区分**（都是 `rgb(200 206 218 / 0.4)`）。暗色下才差 0.06 alpha。**任何"悬停与选中视觉要不同"的需求，在亮色下当前无法用这两个 token 表达** |
| 3 | `hsl(var(--primary))` 一组的"同值"是**设计意图**（§3.6），与上面几组性质不同——**同值不等于重复**，判定时要区分"有意收敛"与"碰巧撞车" |
| 4 | 复现命令见 §8。**每次改 C 层后建议复跑一次**，看同值组是否变化——它是"两套灰"压力的一个可量化指标 |

### 5.4 「凹槽」有三个近似值，且注释里的等值断言不成立

`index.css:276-281` 的注释为 `heat-0` 写明：

> **"0 档是「没有请求」，不是色阶的一档，所以刻意用中性色：它在亮色下与凹槽同色（`#ebedf0`）"**

**实测：这句话里的等值关系不成立。** 仓库里有**三个**"凹槽感的浅灰"：

| 值 | HSL（换算） | token | 行 | 谁说的 |
| --- | --- | --- | --- | --- |
| `#ebebeb` | `hsl(0 0% 92.2%)` | `--inset`（`--color-inset`） | `:585`（A 层 `:106`） | **这才是"凹槽"token**，亮 92% / 暗 5%（`:631`）。`index.css:576-584` 的长注释专门为它写了「一条嵌套链里只允许出现一层凹槽」的规则 |
| `#ebedf0` | `hsl(216 14% 93.1%)` | `--color-heat-0` | `:282` | 注释声称它与"凹槽"同色 |
| `#e9ebf0` | `hsl(223 19% 92.7%)` | `--color-background-default-dimmed` | `:170` | 又一个浅冷灰 |

**`#ebebeb` 是纯灰（hue 0），`#ebedf0` 与 `#e9ebf0` 是冷灰（hue 216 / 223）。**
`#ebebeb` 与 `#ebedf0` 相差 3–5 个通道——**在 1x 屏上肉眼不可分，在注释里却被断言为"同色"**。

**这条不是小事**：

| # | 含义 |
| --- | --- |
| 1 | `--inset` 是**唯一纯灰的"凹槽"**（它在 A/B 层，不在 C 层），而 C 层里有两个近似值的冷灰。它属于 §4.1 的"纯灰在打架"——**"凹槽"这个语义同时落在两套灰上** |
| 2 | 注释里的等值断言**当前为假**。任何按该注释推理的人（尤其是 AI 生成器）会得到错的结论 |
| 3 | 修复有两条路，**必须择一并写下来**：① 把 `heat-0` 改成 `--inset` 的实际值（承认"与凹槽同色"是意图）；② 改注释（承认两者本就不同）。**本文不替这个决定投票** |

> `--inset` 的量级：`bg-inset` **58 次**，是仓库里**用量最高**的底色类
> （高于 `bg-workflow-block-parma-bg` 34、`bg-card` 29、`bg-sidebar` 29、`bg-background` 27）——
> 这条比 `heat-0`（4 次）重要得多。

### 5.5 语义族档数不齐：error 4 / warning 3 / success 2

| 族 | 面色（浅） | 面色（深） | 实心 | 文本 | 合计 |
| --- | --- | --- | --- | --- | --- |
| **error** | ✅ `#fef3f2` | ✅ `#fee4e2`（**但是 `components-button-*`，不是族内 token**） | ✅ `#f04438` | ✅ `#d92d20` | **4** |
| **warning** | ✅ `#fffaeb` | ❌ | ✅ `#f79009` | ✅ `#dc6803` | **3** |
| **success** | ❌ | ❌ | ✅ `#17b26a` | ✅ `#079455` | **2** |

**success 没有任何浅色面**——即"成功提示条"的背景色**在体系里不存在**。
[`design-system-data-display.md`](./design-system-data-display.md) §5 的三态行
（空 / 加载 / 错误）若出现成功态，**体系里没有可用的值**，只能就地写一个即兴字面值
——而那正是 [`design-system-tokens.md`](./design-system-tokens.md) §3 要归位的那类写法。

**另外：error 的"面色"被命名成 `hover`**（`--color-state-destructive-hover: #fef3f2`，`:185`；
`--color-state-warning-hover: #fffaeb`，`:186`）。
`state-*` 后缀在 [`design-system-tokens.md`](./design-system-tokens.md) §5 的约定里是**交互态**，
而这两个值的实际用途是**浅色面（banner 底）**——**名字说的是第 4 步（悬停），值是第 1–2 步（浅底）**。
这是 §2.1 落位表之外的一处**角色错位**：它不影响使用，但会让"这个 token 站第几步"这个问题
永远答不准。

### 5.6 分类色板 9 个 token 只用了 6 次，而 16 处该用它的地方绕开了

| 事实 | 数字 | 证据 |
| --- | --- | --- |
| `util-colors-*` 定义 | **9** | `index.css:266-274` |
| 有使用的 | **6 个，各 1 次**（`blue` / `cyan` / `green` / `warning` / `violet` / `pink`） | §8 命令 |
| **零使用** | **3 个**：`blue-brand-blue-brand-500`（`#085afc`，**品牌蓝**）、`indigo-indigo-500`、`yellow-yellow-500` | 同上 |
| **需要分类色但绕开它** | **16 处**（`PROVIDER_COLORS` 8 + `ERROR_COLORS` 8） | [`design-system-tokens.md`](./design-system-tokens.md) §3.4 |

**两条新含义**：

| # | 含义 |
| --- | --- |
| 1 | **品牌蓝 `#085afc`（`:266`）零使用**，而 `--primary` 是中性近黑（§2.3 规则 3）。**本体系里"品牌色"是一个已声明但从未出现的值**——这与 [`design-system.md`](./design-system.md) 的「第三层：品牌层」对不上：**我们决定了，但没落地** |
| 2 | **16 处需要"任意区分色"的场景 vs 9 个专用 token（6 次使用）**——供需倒挂。按 [`design-system-tokens.md`](./design-system-tokens.md) §6 的候选清单，正确的动作是**复用 `util-colors-*`**（它的 9 个值里已有 6 个正被用着，说明它就是这个用途），而不是新增一组 `categorical-*` |

---

## 6. 新增颜色 token 的门槛

[`design-system-tokens.md`](./design-system-tokens.md) §6 已立了 4 条**通用**门槛
（表达力 / 语义性 / ≥2 调用点 / 明暗双全），[`design-system-ai-constraints.md`](./design-system-ai-constraints.md) §4.4
把它们写成了操作步骤。**本节只补颜色特有的 5 条，不重复那 4 条——两处是叠加关系。**

### 6.1 允许的情况

| # | 条件 | 例 |
| --- | --- | --- |
| 1 | **它落进 §1.1 的 12 步里的一档，且该档当前为空** | 补第 8 步（悬停边框）——§2.2 证明它当前**完全没有值** |
| 2 | **它是某个已存在语义族的缺格**，且该族已有 ≥2 档在用 | 补 success 的浅色面（§5.5）；补 `components-button-*-bg-active`（[`design-token-mapping.md`](./design-token-mapping.md) §7.4） |
| 3 | **同一个即兴值在 ≥3 处被写出**，且它表达同一个语义 | 收敛 `dark:bg-input/30`（7 处，[`design-system-theming.md`](./design-system-theming.md) §2.3 规则 3） |
| 4 | **它是已有派生族的补格**（族已在仓库里成立） | `components-button-*-{bg,text,border}-disabled`（[`design-token-mapping.md`](./design-token-mapping.md) §7.4） |
| 5 | **它替换掉一处字面色值/调色板类名**，且替换后调用点 ≥2 | 便签节点 `workflow-node-note-*`（[`design-system-tokens.md`](./design-system-tokens.md) §3.4） |

### 6.2 不允许的情况

| # | 禁止 | 理由 |
| --- | --- | --- |
| 1 | **为一次性视觉调整加 token** | 单点使用就地写类名（[`design-system-tokens.md`](./design-system-tokens.md) §6 条件 3）。**"某处看起来差一点点"不是语义** |
| 2 | **新色不先落进 12 步角色里的一档** | 落不进去 = 它的角色说不清 = 它会在下一次改版时第一个失控。**这是本文新增的硬条件** |
| 3 | **视觉命名**（`gray-400` / `bg-red-500` / `red-brand`） | 第 1 号铁律（[`design-system.md`](./design-system.md) §全局铁律）；现存 34 处正是这么来的 |
| 4 | **品牌层变量出现在 `@theme` 与 `.dark` 之外** | 第 2 号铁律。组件里出现字面色值，那条规则就已经不在设计系统里了 |
| 5 | **一个 token 只服务一个组件文件**（该组件已有 `components-*` 前缀时例外） | `components-*` 的边界规则见 [`design-system-components.md`](./design-system-components.md) §5 |
| 6 | **给分类色新增 3–8 步的交互档** | §3.4 的 9 族**每族一档是有意的**：它们只作色块/圆点。要做可交互控件，用 `state-*` / `components-*`，**不要**把 `util-colors-*` 扩成 12 步 |
| 7 | **为热力色阶套用 12 步骨架** | §3.5：它是顺序色阶，方向在暗色下反转 |

### 6.3 新增后必须同步的位置

1. `@theme` 写值 → 2. `.dark` 给覆盖（走 [`design-system-theming.md`](./design-system-theming.md) §3.2 的三分支流程）
→ 3. [`design-system-tokens.md`](./design-system-tokens.md) §2 的清单 → 4. **本文 §3 对应的那张表**
→ 5. 使用处。

> 新增 `util-colors-*` 若确实明暗共用，**必须照 `index.css:265` 的写法写注释**——
> 否则 [`design-system-theming.md`](./design-system-theming.md) §3.1 的检查 ② 会把它判为漏覆盖。

---

## 7. 与其它分册的分工

### 7.1 与 [`design-system-tokens.md`](./design-system-tokens.md)

**这是最需要划清的一对，因为两者都以"颜色"为题。**

| 文档 | 权威范围 | 回答的问题 |
| --- | --- | --- |
| **[`design-system-tokens.md`](./design-system-tokens.md)** | **语义命名与归位规则**（清单侧） | 「**我手上这个字面值该归到哪个 token**」（44 处逐条）、「**哪些 token 存在**」（143 个全清单）、「**圆角**」 |
| **本文** | **色值来源与角色骨架**（价值侧） | 「**这个色值从哪来、为什么是这个值**」、「**它站在 12 步的第几档**」、「**两套值体系为什么会打架**」 |

| 交界处 | 归谁 | 说明 |
| --- | --- | --- |
| 143 个 token 的全清单 | **tokens §2** | 本文 §3 **不重列**。本文列的是**按色值组织**的 6 张表（中性 / 透明 / 语义族 / 分类 / 热力 / `--primary` 派生），目的是让"这个值站在第几档"可判 |
| 新增 token 的 4 条通用门槛 | **tokens §6** | 本文 §6 只补颜色特有的 5 条，**叠加不替代** |
| 字面值归位 | **tokens §3** | 本文不重复归位表 |
| 12 步角色骨架 | **本文** | tokens 文档**没有**这根轴——它的清单按"用途"分类（文本层级 / 底色 / 交互态…），不按"档位" |
| 「凹槽」的三个近似值 | **本文 §5.4** | tokens 文档 §1/§2 只登记 `--inset` 属于 A 层、`heat-0` 属于热力图，**未指出两者近似且注释断言不成立** |

### 7.2 与 [`design-system-theming.md`](./design-system-theming.md)

那篇文档发现的「**56 处 `dark:` 跨 22 文件，与 `.dark` token 覆盖并行且从未被记录**」
（§1.4）与本文的调色板缺口**同源**：两者都是"**同一个语义存在两条表达路径**"。

| 路径 | 载体 | 记录处 |
| --- | --- | --- |
| token 覆盖 | `styles/index.css` 的 `.dark` 块 | tokens §7 的 82/104 账 |
| `dark:` 变体 | 22 个组件文件里的 56 处 | theming §1.4、§2.2 |
| **A 层 / C 层两套语义色** | **同一份 CSS 的两个 `@theme` 块** | **本文 §4.1、§5.1** |

**三条机制在同一个病根上**：语义没有单一归属。本文的 §5.1（4 对同名不同色类名，共 **81 处**）
与那 56 处 `dark:` **体量同量级**，但它**比那 56 处更难被发现**：
两条路径**在同一个文件里**，不像 `dark:` 那样散在 22 个组件里可以逐个点开看，
而且两个类名**都是合法的语义命名**，静态检查与铁律 1 都拦不住。

### 7.3 与 [`design-token-mapping.md`](./design-token-mapping.md) 的字号节

本文 §5.1 的同名撞车（`text-primary` vs `text-text-primary`）与
[`design-token-mapping.md`](./design-token-mapping.md) §3.3 记录的字号撞车
（`system-sm-*` 是 **13px**，而 Tailwind 的 `text-sm` 是 **14px**）**是同一类缺陷的两种表现**：

| 维度 | 撞车对 | 两侧的值 | 出处 |
| --- | --- | --- | --- |
| **字号** | `system-sm-*` / `text-sm` | 13px / 14px | [`design-token-mapping.md`](./design-token-mapping.md) §3.3、[`design-system-typography.md`](./design-system-typography.md) §1.1 |
| **颜色** | `text-primary` / `text-text-primary` | `#171717` / `#101828` | 本文 §5.1 |

**共同的形态**：**前缀相同、后缀相同、语义相同，值不同**——因为两套体系各自命名了一次。
字号侧的处置（补 `--text-compact`，**不重定义 Tailwind 已有的名字**，见映射文档 §3.3 的
「备选方案（不推荐，登记备查）」）**就是颜色侧该照抄的做法**：
**让名字继续存在，把值收敛到一处，而不是改掉 385 个调用点。**

### 7.4 与其余分册

| 分册 | 本文与它的交界 |
| --- | --- |
| [`design-system-accessibility.md`](./design-system-accessibility.md) | **焦点环的颜色**：§3.2 实测「宽度四种、颜色五种」，其成因是焦点环当前取的是第 9 步（实心）而不是骨架的第 7/8 步（本文 §2.2）。对比度的**判据与规则**（该文 §1）不在本文，本文只提供"哪些值配成对" |
| [`design-system-components.md`](./design-system-components.md) | `components-*` 的**状态矩阵缺口**（§5.3）就是本文 §2.2「第 8 步为空」在组件侧的表现：没有第 8 步，按钮的 `border-hover` 只能取一个与默认边框几乎同色的值 |
| [`design-system-ai-constraints.md`](./design-system-ai-constraints.md) | 该文 §3.3 的"状态色"范例当前**混用了两个红**（本文 §4.2 附带发现）。该文 §4.4 的 4 条流程是本文 §6 的前置，两者叠加使用 |
| [`design-system-icons.md`](./design-system-icons.md) | 品牌标志的固有配色（§5）与 `util-colors-*` **是两回事**：前者是商标资产，后者是 UI 分类色。`#085afc` 零使用（本文 §5.6）指的是后者 |
| [`design-system-data-display.md`](./design-system-data-display.md) | 三态行（§5）里"成功态"缺底色，是本文 §5.5 的下游后果 |

---

## 8. 证据来源与复现命令

| 来源 | 路径 / 命令 | 用于 |
| --- | --- | --- |
| 本仓颜色 token 定义 | `packages/console/source/styles/index.css:63-127`（A 层）、`:137-287`（C 层）、`:291-386`（D 层）、`:541-595`（B 层亮）、`:597-641`（B 层暗） | §2、§3 全部数值 |
| Radix 行为原语依赖 | 根 `package.json:54-61` | §1.2「零依赖」 |
| `util-colors-*` 使用 | `rg -o --no-filename 'util-colors-[a-z-]+-500' --glob '*.tsx' . \| sort \| uniq -c` | §3.4、§5.6 |
| C 层底色用量 | `rg -n 'background-body\|background-default' .` | §5.2 |
| 同名不同色类名用量 | 见下方命令块（**必须用 `(^\|[^-\w])` 边界**，否则 `text-text-primary` 会被算进 `text-primary`） | §4.1、§5.1 |
| 各角色的层归属（面 / 边框 / 文字） | 同上命令块 | §4.1 |
| `dark:` 计数 | `rg -o --no-filename '\bdark:' --glob '*.tsx' . \| wc -l`（= **56**） | §7.2 |
| `chart-1..5` 使用 | `rg 'chart-[1-5]' --glob '*.tsx' --glob '*.ts' .`（**无命中**） | §4.3 |

**类名计数**（§4.1、§5.1 的全部数字）：

```bash
cd packages/console/source

# 边界必须是 (^|[^-\w])：Tailwind 的 `-` 是非单词字符，
# 所以 `\btext-primary\b` 会命中 `text-text-primary` 里的后半段，把两层算成一层。
count() { rg -o --no-filename "(^|[^-\w])$1\b" --glob '*.tsx' . | wc -l; }

# 文字：纯灰（A 层）对 冷灰（C 层）
for c in text-primary text-secondary text-destructive text-muted-foreground; do echo "$(count $c)  $c"; done   # 29 1 12 39
for c in text-text-primary text-text-secondary text-text-tertiary; do echo "$(count $c)  $c"; done              # 155 92 241

# 边框
echo "$(count border-border)  border-border"                                   # 50
echo "$(count border-module-border)  border-module-border"                     # 81
echo "$(count border-components-panel-border)  …panel-border"                  # 20

# 底 / 面
for c in bg-background bg-card bg-sidebar bg-inset bg-popover; do echo "$(count $c)  $c"; done                  # 27 29 29 58 12
for c in bg-workflow-block-parma-bg bg-components-panel-bg; do echo "$(count $c)  $c"; done                     # 34 16
```

**HSL → 十六进制的换算方法**（本文所有标 `换算` 的值都由此得出，可复现）：

```bash
python3 -I -c "
import colorsys
def hx(h,s,l):
    r,g,b=colorsys.hls_to_rgb(h/360,l/100,s/100)
    return '#%02x%02x%02x'%(round(r*255),round(g*255),round(b*255))
print(hx(6,65,48), hx(0,0,98), hx(0,0,9), hx(12,76,61))   # #ca3b2b #fafafa #171717 #e76e50
"
```

**alpha 叠色的等效值**（§2.2、§3.2 用到的合成）：

```bash
python3 -I -c "
def comp(fg,a,bg): return '#%02x%02x%02x'%tuple(round(f*a+b*(1-a)) for f,b in zip(fg,bg))
print('rgb(16 24 40 / .2) on #fff  =', comp((16,24,40),.2,(255,255,255)))   # #cfd1d4
print('rgb(200 206 218 / .4) on #fff =', comp((200,206,218),.4,(255,255,255)))  # #e9ebf0
print('rgb(16 24 40 / .5) on #fff =', comp((16,24,40),.5,(255,255,255)))   # #888c94
"
```

> **换算的边界**：alpha 值的等效十六进制**只在指定底色上成立**（上例均为白底）。
> 同一个 alpha 叠在 `#f2f4f7` 上会得到不同的值——**这正是 §2.3 规则 1「暗色下归属会变」
> 的算术来源**，也是为什么 alpha 档不能直接当作 12 步里的一格。

**中性 11 档的档距**（§3.1 注 ②）：

```bash
python3 -I -c "
v=['ffffff','fcfcfd','f9fafb','f2f4f7','ebedf0','e9ebf0','d0d5dc','98a2b2','676f83','354052','101828']
d=lambda h: tuple(int(h[i:i+2],16) for i in (0,2,4))
for a,b in zip(v,v[1:]):
    print(max(abs(x-y) for x,y in zip(d(a),d(b))), '#'+a,'->','#'+b)
"
# 3 3 7 7 2 25 56 51 50 42
```

**C 层同值组**（§5.3）：

```bash
cd packages/console/source/styles
python3 -I -c "
import re,collections
src=open('index.css').read().split('\n')
g=collections.defaultdict(list)
for i in range(136,287):
    m=re.match(r'\s*(--[a-z0-9-]+):\s*(.+?);',src[i])
    if m: g[m.group(2).strip()].append(m.group(1))
print(sum(1 for v,k in g.items() if len(k)>1), '组同值')
for v,k in g.items():
    if len(k)>1: print(v,'<-',len(k))
"
```

---

## 9. 未核实项

| # | 项 | 状态 | 为什么 |
| --- | --- | --- | --- |
| 1 | **Radix Colors 12 步角色的官方原文** | `[未核实]` | 仓库内**没有** `@radix-ui/colors` 包，也没有任何 Radix 颜色文档的快照；本文 §1.1 的角色表是**我们的转述**，**未与上游逐条比对**（含"第 7 步还是第 8 步是焦点环"这一条） |
| 2 | **`design-system.md` §与成熟系统对照速查 里 `chart-1..5` ≈ Carbon categorical palette 的依据** | `[未核实]` | 该表未标来源；本文 §4.3 实测这 10 个值是 shadcn 出厂默认。**两处不一致，且本文无法判定哪个是"对"的**——需要原作者补依据或改表 |
| 3 | **A 层与 C 层哪一套是"有意的页面骨架"** | `[未核实]` | 两套都完整、都在用（§4.1）。从代码判定不出"哪一套是后来加的"：`index.css:130-135` 的注释说明 C 层是"逐字落地上游"的移植层，`@theme inline` 的 A 层是 shadcn 惯例——**都是有意引入的，冲突是无意的**。归属决定需要产品判断，不是代码考古 |
| 4 | **`--color-background-default-dodge` 的语义** | `[未核实]` | 亮色值等于 `background-default`（`#ffffff`），暗色是 `#3a3a40`（比卡面 `#222225` 更亮）。"dodge"（避让）指什么、亮色下为什么与 default 同值，仓库里**没有注释**，本文未当结论 |
| 5 | **`--inset` 与 `heat-0` 的注释断言该按哪一边修** | `[未核实]` | §5.4 已证明注释的等值断言为假，但**无法判定作者的意图是"让它们同色"还是"顺手写了个近似值"**。两条修法已登记，选哪条是产品决定 |
| 6 | **`state-*-hover` 命名成"hover"是历史遗留还是有意** | `[未核实]` | `--color-state-destructive-hover`（`:185`）与 `--color-state-warning-hover`（`:186`）的**值是浅色面**（§5.5），名字却是交互态。`index.css` 无注释，上游也无从比对（同第 1 项） |
| 7 | **9 个 `util-colors-*` 的色值是否有上游依据** | `[未核实]` | 同 [`design-system-tokens.md`](./design-system-tokens.md) §9 已登记的同一条（该文已判定核不到）。本文 §5.6 只补了**用量**这一面（6/9 使用、品牌蓝零使用），**不重复论证色值出处** |
| 8 | **§3.1 里相邻差 ≤3/255 的三对，在实际显示上是否可分辨** | `[未核实]` | 数值差是实测的（§8 命令），但**"3 个量化级在大色块上是否可见"取决于屏幕、缩放与色块面积**。`index.css` 的相关注释只解释了"为什么某些值必须拉开"（`:576-584` 的凹槽、`:233-237` 的输入域），**没有对第 1/2/3 行与第 5/6 行给过理由**。本文只陈述数值差，**不宣称它们"看不见"** |
| 9 | **C 层色值的上游出处是不是 Untitled UI 的公开色板** | `[未核实]` | `index.css:129-135` 只写到「取自上游工作流编辑器的设计系统，逐字落地」，色板指向 `themes/light.css`、`dark.css`——**这两个文件不在本仓库里**，全仓 `grep -ri untitled` **零命中**。据项目侧说明，这套色值与 Untitled UI 的公开色板**高度吻合**，但本文**未与任何上游文档逐条比对**（无网络），故按 `[未核实]` 记录：**只能写「吻合，出处未证实」，禁止写成「采用 Untitled UI」**——后者是本文没有证据支持的结论 |

---

## 附：给评审用的速查

| 问题 | 结论 |
| --- | --- |
| 颜色骨架换成 Radix Colors 了吗 | **只借 12 步的「角色」，零依赖、零改值**（§1.2、§1.3） |
| 12 步缺哪一步 | **缺第 8 步（悬停边框）**；且第 7 步兼了焦点环的角色，实际焦点环取的是第 9 步的值（§2.2） |
| 文本端也缺档吗 | **不缺，是过多**——4 档文本 vs 骨架 2 档（§2.2） |
| 色值要动吗 | **不动**。缺的是角色，不是颜色（§1.3） |
| 最该先**定**的是什么 | **§4.1 的归属**（两套灰哪一套是"页面骨架"）。§5.1 / §5.2 / §5.4 都是它的下游 |
| 最该先**改**的代码是什么 | **§4.2 的红色合流**——暗色下"文本红"与"实心红"是同一个值 `#f97066`，**这是功能缺陷，不只是观感** |
| 两套灰怎么收敛 | 见 §4.1。本文只登记事实与代价，**归属决定不在文档里做**（§9 第 3 项） |
| 能加新颜色 token 吗 | 过 §6.1 五条 + [`design-system-tokens.md`](./design-system-tokens.md) §6 四条，**叠加**才成立（§6） |
